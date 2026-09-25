import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import type { Bootstrap, Draft, Plan } from './types';
import { deletePlan, fetchBootstrap, fetchPlan, isApiError, postPlan } from './api';
import { commitFetchedPlan, commitSyncedPlan, createExclusiveWriteQueue, nextPlanRevision, updateQueuedPlan } from './repository-sync';
import bundledCatalog from '../assets/mobile-bootstrap.json';
import { normalizeBootstrap } from './api';

const dbPromise = SQLite.openDatabaseAsync('mise-native.db');
const enqueueExclusiveWrite = createExclusiveWriteQueue();
let initialization: Promise<void> | null = null;
async function db() {
  const database = await dbPromise;
  if (!initialization) {
    initialization = database.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sync_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);').catch(error => {
      initialization = null;
      throw error;
    });
  }
  await initialization;
  return database;
}
async function read<T>(key: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  if (!row) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}
async function write(key: string, value: unknown) {
  await enqueueExclusiveWrite(async () => {
    await (await db()).runAsync('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
  });
}
export async function clientId(): Promise<string> {
  const stored = await SecureStore.getItemAsync('mise-client-id');
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync('mise-client-id', created, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return created;
}
export const local = {
  plan: () => read<Plan>('plan'), draft: () => read<Draft>('draft'), bootstrap: () => read<Bootstrap>('bootstrap'),
  onboarding: () => read<boolean>('onboarding'), reminders: () => read<{ cooking: boolean; thaw: boolean; expiry: boolean; hour: number }>('reminders'),
  saveDraft: (draft: Draft) => write('draft', draft), saveBootstrap: (data: Bootstrap) => write('bootstrap', data),
  finishOnboarding: () => write('onboarding', true), saveReminders: (settings: unknown) => write('reminders', settings),
};
export async function savePlanOffline(plan: Plan) {
  await enqueueExclusiveWrite(async () => {
    const database = await db();
    await database.withExclusiveTransactionAsync(async transaction => {
      const revisionRow = await transaction.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'plan_revision');
      await transaction.runAsync('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'plan', JSON.stringify(plan));
      await transaction.runAsync('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'plan_revision', JSON.stringify(nextPlanRevision(revisionRow?.value)));
      await transaction.runAsync('INSERT INTO sync_queue(kind,payload,created_at) VALUES(?,?,?)', 'plan', JSON.stringify(plan), Date.now());
    });
  });
  localPlanMutationRevision += 1;
}
export async function updatePlanOffline(update: (current: Plan) => Plan): Promise<Plan> {
  let updated!: Plan;
  await enqueueExclusiveWrite(async () => {
    const database = await db();
    await database.withExclusiveTransactionAsync(async transaction => {
      updated = await updateQueuedPlan(transaction, update);
    });
  });
  localPlanMutationRevision += 1;
  return updated;
}
export async function deletePlanOffline(freshDraft: Draft) {
  await enqueueExclusiveWrite(async () => {
    const database = await db();
    await database.withExclusiveTransactionAsync(async transaction => {
      const revisionRow = await transaction.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'plan_revision');
      await transaction.runAsync('DELETE FROM kv WHERE key = ?', 'plan');
      await transaction.runAsync('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'plan_revision', JSON.stringify(nextPlanRevision(revisionRow?.value)));
      await transaction.runAsync('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'draft', JSON.stringify(freshDraft));
      await transaction.runAsync('DELETE FROM sync_queue');
      await transaction.runAsync('INSERT INTO sync_queue(kind,payload,created_at) VALUES(?,?,?)', 'delete', '{}', Date.now());
    });
  });
  localPlanMutationRevision += 1;
}
let localPlanMutationRevision = 0;
export function getLocalPlanMutationRevision() { return localPlanMutationRevision; }
export async function pendingCount(): Promise<number> { const row = await (await db()).getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM sync_queue'); return row?.count ?? 0; }
let syncInFlight: Promise<'synced' | 'pending' | 'error'> | null = null;
async function flushPending(id: string): Promise<'synced' | 'pending' | 'error'> {
  const database = await db();
  while (true) {
    const row = await database.getFirstAsync<{ id: number; kind: string; payload: string }>('SELECT id,kind,payload FROM sync_queue ORDER BY id ASC LIMIT 1');
    if (!row) return 'synced';
    try {
      if (row.kind === 'delete') {
        await deletePlan(id);
        await enqueueExclusiveWrite(async () => {
          await database.withExclusiveTransactionAsync(async transaction => {
            await transaction.runAsync('DELETE FROM sync_queue WHERE id = ?', row.id);
          });
        });
        continue;
      }
      const plan = JSON.parse(row.payload) as Plan;
      const saved = await postPlan(id, plan);
      await enqueueExclusiveWrite(async () => {
        await database.withExclusiveTransactionAsync(async transaction => {
          await commitSyncedPlan(transaction, row.id, saved);
        });
      });
    } catch (error) { return isApiError(error) && error.status >= 400 && error.status < 500 ? 'error' : 'pending'; }
  }
}
export function syncPending(id: string): Promise<'synced' | 'pending' | 'error'> {
  if (!syncInFlight) syncInFlight = flushPending(id).finally(() => { syncInFlight = null; });
  return syncInFlight;
}
export async function hydrate(): Promise<{ plan: Plan | null; bootstrap: Bootstrap; sync: 'synced' | 'pending' }> {
  const [cachedPlan, cachedBootstrap] = await Promise.all([local.plan(), local.bootstrap()]);
  let bootstrap = normalizeBootstrap(bundledCatalog);
  if (cachedBootstrap?.raw) {
    try { bootstrap = normalizeBootstrap(cachedBootstrap.raw); } catch { /* Replace old or incomplete cached catalogs with the bundled catalog. */ }
  }
  return { plan: cachedPlan, bootstrap, sync: (await pendingCount()) > 0 ? 'pending' : 'synced' };
}
export async function refreshRemote(id: string): Promise<{ plan: Plan | null; bootstrap: Bootstrap; sync: 'synced' | 'pending' | 'error' }> {
  const fallback = await hydrate();
  let bootstrap = fallback.bootstrap;
  let sync: 'synced' | 'pending' | 'error' = fallback.sync;
  try {
    const fresh = await fetchBootstrap(id);
    bootstrap = fresh;
    await local.saveBootstrap(fresh);
  } catch { /* Bundled catalog keeps planning available without a connection. */ }
  if ((await pendingCount()) > 0) sync = await syncPending(id);
  try {
    const fetchedAgainstRevision = (await read<number>('plan_revision')) ?? 0;
    const remote = await fetchPlan(id);
    const database = await db();
    let resolved: { plan: Plan | null; hasPending: boolean } = { plan: null, hasPending: false };
    await enqueueExclusiveWrite(async () => {
      await database.withExclusiveTransactionAsync(async transaction => {
        resolved = await commitFetchedPlan(transaction, remote, fetchedAgainstRevision);
      });
    });
    if (resolved.hasPending) sync = 'pending';
    return { plan: resolved.plan, bootstrap, sync };
  } catch { sync = (await pendingCount()) > 0 ? 'pending' : 'error'; }
  const plan = await local.plan();
  return { plan, bootstrap, sync };
}
