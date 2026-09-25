import type { Plan } from './types';
import { mergeServerPlan } from './logic';

export type PlanSyncTransaction = {
  getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>;
  runAsync(source: string, ...params: unknown[]): Promise<unknown>;
};

export function createExclusiveWriteQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function nextPlanRevision(value: string | null | undefined) {
  try { return (value ? JSON.parse(value) as number : 0) + 1; } catch { return 1; }
}

export async function updateQueuedPlan(tx: PlanSyncTransaction, update: (current: Plan) => Plan): Promise<Plan> {
  const planRow = await tx.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'plan');
  if (!planRow) throw new Error('Сохранённый план больше недоступен.');
  const current = JSON.parse(planRow.value) as Plan;
  const revisionRow = await tx.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'plan_revision');
  const updated = update(current);
  await tx.runAsync('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'plan', JSON.stringify(updated));
  await tx.runAsync('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'plan_revision', JSON.stringify(nextPlanRevision(revisionRow?.value)));
  await tx.runAsync('INSERT INTO sync_queue(kind,payload,created_at) VALUES(?,?,?)', 'plan', JSON.stringify(updated), Date.now());
  return updated;
}

export async function commitFetchedPlan(tx: PlanSyncTransaction, remote: Plan | null, fetchedAgainstRevision: number): Promise<{ plan: Plan | null; hasPending: boolean }> {
  const localRow = await tx.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'plan');
  const revisionRow = await tx.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', 'plan_revision');
  const queued = await tx.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM sync_queue');
  let localPlan: Plan | null = null;
  try { localPlan = localRow ? JSON.parse(localRow.value) as Plan : null; } catch { /* Ignore a corrupt local snapshot. */ }
  let currentRevision = 0;
  try { currentRevision = revisionRow ? JSON.parse(revisionRow.value) as number : 0; } catch { /* Treat an invalid revision as the initial version. */ }
  const hasPending = (queued?.count ?? 0) > 0;
  const changedSinceFetch = currentRevision !== fetchedAgainstRevision;
  const plan = hasPending || changedSinceFetch ? localPlan : mergeServerPlan(localPlan, remote, false);
  if (!hasPending && !changedSinceFetch && plan) {
    await tx.runAsync('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'plan', JSON.stringify(plan));
  }
  return { plan, hasPending };
}

export async function commitSyncedPlan(tx: PlanSyncTransaction, queueId: number, saved: Plan): Promise<boolean> {
  await tx.runAsync('DELETE FROM sync_queue WHERE id = ?', queueId);
  const queued = await tx.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM sync_queue');
  const hasPending = (queued?.count ?? 0) > 0;
  if (!hasPending) {
    await tx.runAsync('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'plan', JSON.stringify(saved));
  }
  return hasPending;
}
