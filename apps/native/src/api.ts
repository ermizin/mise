import type { Bootstrap, MealSlot, Plan, Recipe } from './types';
import {
  MOBILE_BOOTSTRAP_SCHEMA_VERSION,
  MOBILE_CATALOG_SCHEMA_VERSION,
  type MobileBootstrap,
} from '@mise/domain/mobile';
import { parseIngredient } from './logic';
import bundledCatalog from '../assets/mobile-bootstrap.json';

const baseUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'https://mise.ermizinm.ru').replace(/\/$/, '');
export const apiOrigin = baseUrl;

class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function request(path: string, clientId: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'X-Mise-Client': clientId, ...(init?.headers ?? {}) }, signal: controller.signal });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = body && typeof body === 'object' && 'error' in body ? String(body.error) : `Ошибка сервера (${response.status})`;
      throw new ApiError(error, response.status);
    }
    return body;
  } finally { clearTimeout(timer); }
}

export function normalizeBootstrap(value: unknown): Bootstrap {
  if (!value || typeof value !== 'object') throw new Error('Неверный ответ каталога.');
  const body = value as MobileBootstrap;
  if (body.schemaVersion !== MOBILE_BOOTSTRAP_SCHEMA_VERSION || body.catalogSchemaVersion !== MOBILE_CATALOG_SCHEMA_VERSION || !Array.isArray(body.recipes)) throw new Error('Версия каталога не поддерживается.');
  const bundledIds = new Set(bundledCatalog.recipes.map(item => item.id));
  if (!body.capabilities?.offlinePlanGeneration || body.recipes.some(item => !item.solver || !bundledIds.has(item.id))) {
    throw new Error('Каталог требует обновления приложения для работы без сети.');
  }
  const slots: MealSlot[] = ['breakfast', 'snack1', 'lunch', 'snack2', 'dinner'];
  const recipes: Recipe[] = body.recipes.flatMap(item => {
    if (!item.id || !item.title || !item.slot || !slots.includes(item.slot)) return [];
    const ingredients = (item.ingredients ?? []).map(raw => parseIngredient({ id: raw.id, name: raw.name, amount: raw.baseAmount, unit: raw.unit })).filter((part): part is NonNullable<typeof part> => part !== null);
    return [{ id: item.id, title: item.title, mealSlots: [item.slot], ingredients,
      allergens: [...new Set((item.ingredients ?? []).flatMap(raw => raw.allergens ?? []))],
      storageDays: item.storage?.refrigeratorDays, canFreeze: item.storage?.freezable,
      instructions: item.instructions?.map(step => step.text) ?? item.steps, imageUrl: item.photo?.path ? `${baseUrl}${item.photo.path}` : undefined, photoOrigin: item.photo?.origin,
      kcal: item.macros?.kcal, menuTags: item.menuTags ?? [], costTier: item.costTier?.value,
      storage: item.storage, effort: item.effort, packing: item.packing, equipmentOptions: item.equipmentOptions ?? [] }];
  });
  const normalizedIds = new Set(recipes.map(recipe => recipe.id));
  if (recipes.length !== bundledIds.size || normalizedIds.size !== bundledIds.size || [...bundledIds].some(id => !normalizedIds.has(id))) {
    throw new Error('Каталог неполный. Используйте встроенный каталог и повторите загрузку позже.');
  }
  return { recipes, raw: body };
}

export async function fetchBootstrap(clientId: string): Promise<Bootstrap> { return normalizeBootstrap(await request('/api/mobile/bootstrap', clientId)); }
export async function fetchPlan(clientId: string): Promise<Plan | null> {
  const body = await request('/api/plans', clientId) as { plan?: Plan | null };
  return body.plan ?? null;
}
export async function postPlan(clientId: string, plan: Plan): Promise<Plan> {
  const body = await request('/api/plans', clientId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) }) as { plan?: Plan };
  if (!body.plan) throw new Error('Сервер не подтвердил сохранение плана.');
  return body.plan;
}
export async function deletePlan(clientId: string): Promise<void> { await request('/api/plans', clientId, { method: 'DELETE' }); }
export function isApiError(error: unknown): error is ApiError { return error instanceof ApiError; }
