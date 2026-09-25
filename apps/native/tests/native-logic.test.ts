import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateMobilePlan } from '@mise/domain/plan-generator';
import { normalizeBootstrap } from '../src/api';
import { buildBatches, initialDraft, mergeServerPlan, plusDays, validateDraft } from '../src/logic';
import { commitFetchedPlan, commitSyncedPlan, createExclusiveWriteQueue, type PlanSyncTransaction, updateQueuedPlan } from '../src/repository-sync';
import type { Plan } from '../src/types';
import bundled from '../assets/mobile-bootstrap.json';


test('bundled catalog is compatible with offline planner and exposes detailed recipes', () => {
  const bootstrap = normalizeBootstrap(bundled);
  assert.equal(bootstrap.raw.schemaVersion, 2);
  assert.ok(bootstrap.recipes.length >= 200);
  assert.ok(bootstrap.recipes.every(recipe => recipe.ingredients.length > 0 && recipe.instructions?.length && recipe.storage));
  assert.ok(bootstrap.raw.recipes.every(recipe => recipe.solver));
});

test('offline plan uses bundled solver and includes cooking and shopping', () => {
  const bootstrap = normalizeBootstrap(bundled);
  const draft = initialDraft('person-1');
  draft.periodDays = 1;
  draft.cookEveryDays = 1;
  draft.mealSlots = ['lunch'];
  draft.people[0].includedSlots = ['lunch'];
  const plan = generateMobilePlan(bootstrap.raw, { ...draft, id: 'plan-offline', createdAt: '2026-09-25T00:00:00.000Z' });
  assert.equal(plan.batches.length, 1);
  assert.ok(plan.selections['batch-0:lunch']);
  assert.ok(plan.cooking.length > 0);
  assert.ok(plan.shopping.length > 0);
  assert.ok(plan.cooking[0].portions[0].viable);
});

test('milk exclusion never selects a recipe containing milk allergen', () => {
  const bootstrap = normalizeBootstrap(bundled);
  const draft = initialDraft('person-1');
  draft.periodDays = 1; draft.cookEveryDays = 1; draft.mealSlots = ['lunch'];
  draft.people[0].includedSlots = ['lunch']; draft.people[0].hardExclusions = ['milk'];
  const plan = generateMobilePlan(bootstrap.raw, { ...draft, id: 'milk-exclusion', createdAt: '2026-09-25T00:00:00.000Z' });
  for (const session of plan.cooking) {
    const recipe = bootstrap.raw.recipes.find(item => item.id === session.recipeId);
    assert.ok(recipe);
    assert.equal(recipe.ingredients.some(ingredient => ingredient.allergens.includes('milk')), false);
  }
});

test('draft rejects inconsistent nutrition before generation', () => {
  const draft = initialDraft('person-1');
  draft.people[0].daily.kcal = 100;
  assert.match(validateDraft(draft) ?? '', /КБЖУ/);
});

test('batch dates include a short final cooking batch', () => {
  assert.equal(plusDays('2026-12-31', 1), '2027-01-01');
  assert.deepEqual(buildBatches('2026-09-25', 7, 3).map(batch => batch.days), [3, 3, 1]);
});

test('pending local changes cannot be replaced by older server response', () => {
  const local = { id: 'local' } as Plan;
  const remote = { id: 'remote' } as Plan;
  assert.equal(mergeServerPlan(local, remote, true)?.id, 'local');
  assert.equal(mergeServerPlan(local, remote, false)?.id, 'remote');
});

test('unknown bootstrap schema fails visibly', () => {
  assert.throws(() => normalizeBootstrap({ ...bundled, schemaVersion: 99 }), /Версия каталога/);
});

test('catalog update without bundled offline assets is rejected', () => {
  assert.throws(() => normalizeBootstrap({ ...bundled, recipes: [{ ...bundled.recipes[0], id: 'new-recipe-without-image' }] }), /обновления приложения/);
});

test('partial server catalog is rejected to preserve full offline coverage', () => {
  assert.throws(() => normalizeBootstrap({ ...bundled, recipes: bundled.recipes.slice(0, -1) }), /Каталог неполный/);
});

test('a delayed remote response preserves a plan saved while the request was pending', async () => {
  let localPlan = { id: 'old-local' } as Plan;
  let queued = 0;
  let revision = 0;
  const tx: PlanSyncTransaction = {
    async getFirstAsync<T>(query: string, key?: unknown) {
      if (query.startsWith('SELECT value') && key === 'plan') return (localPlan ? { value: JSON.stringify(localPlan) } : null) as T | null;
      if (query.startsWith('SELECT value') && key === 'plan_revision') return { value: JSON.stringify(revision) } as T;
      return { count: queued } as T;
    },
    async runAsync(query, ...params) {
      if (query.includes("key,value") && params[0] === 'plan') localPlan = JSON.parse(String(params[1])) as Plan;
    },
  };
  let resolveFetch!: (plan: Plan) => void;
  const remoteFetch = new Promise<Plan>(resolve => { resolveFetch = resolve; });
  const refresh = remoteFetch.then(remote => commitFetchedPlan(tx, remote, 0));
  localPlan = { id: 'new-local' } as Plan;
  revision = 1;
  queued = 1;
  resolveFetch({ id: 'server-old' } as Plan);
  const result = await refresh;
  assert.equal(result.plan?.id, 'new-local');
  assert.equal(localPlan.id, 'new-local');
  assert.equal(result.hasPending, true);
});

test('a drained sync queue cannot let an older GET overwrite a saved plan or restore a deleted one', async () => {
  for (const current of [{ id: 'saved-and-synced' } as Plan, null]) {
    let localPlan = current;
    const revision = 1;
    let writes = 0;
    const tx: PlanSyncTransaction = {
      async getFirstAsync<T>(_query: string, key?: unknown) {
        if (key === 'plan') return (localPlan ? { value: JSON.stringify(localPlan) } : null) as T | null;
        if (key === 'plan_revision') return { value: JSON.stringify(revision) } as T;
        return { count: 0 } as T;
      },
      async runAsync(_query, ...params) {
        writes += 1;
        if (params[0] === 'plan') localPlan = JSON.parse(String(params[1])) as Plan;
      },
    };
    const result = await commitFetchedPlan(tx, { id: 'stale-server-plan' } as Plan, 0);
    assert.equal(result.hasPending, false);
    assert.equal(result.plan?.id ?? null, current?.id ?? null);
    assert.equal(localPlan?.id ?? null, current?.id ?? null);
    assert.equal(writes, 0);
  }
});

test('a delayed POST response cannot overwrite a newer queued local plan', async () => {
  let localPlan = { id: 'new-local' } as Plan;
  let queued = 2;
  const tx: PlanSyncTransaction = {
    async getFirstAsync<T>() { return { count: queued } as T; },
    async runAsync(query, ...params) {
      if (query.startsWith('DELETE FROM sync_queue')) queued -= 1;
      else if (query.startsWith('INSERT INTO kv')) localPlan = JSON.parse(String(params[1])) as Plan;
    },
  };
  const hasPending = await commitSyncedPlan(tx, 1, { id: 'old-server-ack' } as Plan);
  assert.equal(hasPending, true);
  assert.equal(localPlan.id, 'new-local');
  assert.equal(queued, 1);
});

test('concurrent offline plan actions merge against the latest saved snapshot', async () => {
  let storedPlan = {
    id: 'plan', shopping: [{ key: 'rice', checked: false }, { key: 'beans', checked: false }],
    mealExecution: { eaten: [] }, cookedBatchIds: [], cookedWeights: {},
  } as unknown as Plan;
  let revision = 0;
  const queuedPlans: Plan[] = [];
  const tx: PlanSyncTransaction = {
    async getFirstAsync<T>(_query: string, key?: unknown) {
      if (key === 'plan') return { value: JSON.stringify(storedPlan) } as T;
      if (key === 'plan_revision') return { value: JSON.stringify(revision) } as T;
      return { count: queuedPlans.length } as T;
    },
    async runAsync(query, ...params) {
      if (query.startsWith('INSERT INTO kv') && params[0] === 'plan') storedPlan = JSON.parse(String(params[1])) as Plan;
      if (query.startsWith('INSERT INTO kv') && params[0] === 'plan_revision') revision = Number(params[1]);
      if (query.startsWith('INSERT INTO sync_queue')) queuedPlans.push(JSON.parse(String(params[1])) as Plan);
    },
  };
  const enqueue = createExclusiveWriteQueue();
  const mutate = (update: (current: Plan) => Plan) => enqueue(() => updateQueuedPlan(tx, update));
  await Promise.all([
    mutate(current => ({ ...current, shopping: current.shopping.map(item => item.key === 'rice' ? { ...item, checked: !item.checked } : item) })),
    mutate(current => ({ ...current, shopping: current.shopping.map(item => item.key === 'beans' ? { ...item, checked: !item.checked } : item) })),
    mutate(current => ({ ...current, mealExecution: { eaten: [...(current.mealExecution?.eaten ?? []), 'person:2026-09-25:lunch'] } })),
    mutate(current => ({ ...current, cookedBatchIds: [...(current.cookedBatchIds ?? []), 'batch-0'] })),
    mutate(current => ({ ...current, cookedWeights: { ...current.cookedWeights, 'batch-0:lunch:recipe': { total: 1250 } } })),
  ]);
  assert.deepEqual(storedPlan.shopping.map(item => [item.key, item.checked]), [['rice', true], ['beans', true]]);
  assert.deepEqual(storedPlan.mealExecution?.eaten, ['person:2026-09-25:lunch']);
  assert.deepEqual(storedPlan.cookedBatchIds, ['batch-0']);
  assert.equal(storedPlan.cookedWeights?.['batch-0:lunch:recipe']?.total, 1250);
  assert.equal(queuedPlans.length, 5);
  assert.equal(queuedPlans.at(-1)?.shopping.every(item => item.checked), true);
});
