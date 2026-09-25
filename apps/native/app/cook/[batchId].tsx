import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { allocateMixedDish } from '@mise/domain/portion-allocation';
import { useApp } from '../../src/app-state';
import { SLOT_LABELS } from '../../src/logic';
import { Body, Button, Card, Field, Screen, Status, Title } from '../../src/ui';

export default function Cooking() {
  const { batchId } = useLocalSearchParams<{ batchId: string }>();
  const { plan, bootstrap, updatePlan } = useApp();
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [weightDraft, setWeightDraft] = useState<Record<string, string>>({});
  const batch = plan?.batches.find(item => item.id === batchId);
  if (!plan || !batch) return <Screen><Status empty="Партия не найдена в сохранённом плане." /><Button title="Назад" onPress={() => router.back()} /></Screen>;
  const dishes = [...new Set(plan.mealSlots.flatMap(slot => {
    const key = `${batch.id}:${slot}`;
    return (plan.selectionAssignments?.[key] ?? [{ recipeId: plan.selections[key], personIds: plan.people.filter(item => item.includedSlots.includes(slot)).map(item => item.id) }])
      .filter(item => item.recipeId).map(item => `${slot}:${item.recipeId}`);
  }))].map(value => { const [slot, recipeId] = value.split(':'); return { slot, recipeId, recipe: bootstrap?.recipes.find(item => item.id === recipeId) }; });
  const saveWeight = async (key: string, value: string) => {
    const total = Number(value.replace(/[^0-9]/g, '')) || 0;
    if (total <= 0) return setProblem('Введите фактический вес больше нуля.');
    try { await updatePlan(current => ({ ...current, cookedWeights: { ...current.cookedWeights, [key]: { total } } })); setMessage('Вес сохранён на устройстве.'); setProblem(null); }
    catch { setProblem('Не удалось сохранить вес. Повторите попытку.'); }
  };
  const finish = async () => {
    try { await updatePlan(current => ({ ...current, cookedBatchIds: [...new Set([...(current.cookedBatchIds ?? []), batch.id])] })); setMessage('Партия отмечена как приготовленная.'); }
    catch { setProblem('Не удалось сохранить отметку.'); }
  };
  return <Screen><Button title="← Неделя" secondary onPress={() => router.back()} />
    <Title subtitle={`${batch.start} — ${batch.end} · ${batch.days} дн.`}>Готовка партии {batch.index + 1}</Title>
    <Card><Body>Сначала подготовьте продукты и контейнеры. Затем следуйте инструкциям каждого блюда. После готовки один раз взвесьте фактический выход, чтобы разложить порции.</Body></Card>
    {dishes.map(({ slot, recipeId, recipe }) => {
      const key = `${batch.id}:${slot}:${recipeId}`;
      const total = plan.cookedWeights?.[key]?.total ?? 0;
      const session = plan.cooking?.find(item => item.key === `${batch.id}:${slot}` && item.recipeId === recipeId);
      const personIds = plan.selectionAssignments?.[`${batch.id}:${slot}`]?.find(item => item.recipeId === recipeId)?.personIds ?? plan.people.filter(item => item.includedSlots.includes(slot as typeof plan.mealSlots[number])).map(item => item.id);
      const people = plan.people.filter(item => personIds.includes(item.id));
      const allocations = total > 0 && session?.portions.length ? allocateMixedDish(total, session.portions.map(portion => ({ personId: portion.personId, label: people.find(person => person.id === portion.personId)?.name ?? portion.personId, portionCount: batch.days, nutritionShare: portion.actual.kcal }))) : null;
      return <Card key={key}><Body>{SLOT_LABELS[slot as typeof plan.mealSlots[number]]} · {recipe?.title ?? recipeId}</Body>
        {recipe ? <><Body muted>{recipe.storageDays ? `В холодильнике около ${recipe.storageDays} дн.` : 'Проверьте срок хранения'}{recipe.canFreeze ? ' · можно заморозить' : ''}</Body>
          {session ? <><Body>Продукты на всю готовку</Body>{recipe.ingredients.map(ingredient => <Body key={ingredient.id ?? ingredient.name}>{ingredient.name}: {Math.round((session.amounts[ingredient.id ?? ''] ?? 0) * 10) / 10} {ingredient.unit}</Body>)}</> : null}
          {recipe.instructions?.map((instruction, index) => <Body key={index}>{index + 1}. {instruction}</Body>)}
          <Button title="Полная карточка" secondary onPress={() => router.push(`/recipe/${recipeId}`)} /></> : null}
        <Field label="Фактический выход блюда, г" value={weightDraft[key] ?? (total ? String(total) : '')} keyboardType="numeric" onChangeText={value => setWeightDraft(current => ({ ...current, [key]: value }))} placeholder="Например, 1400" />
        <Button title="Сохранить вес и рассчитать контейнеры" secondary onPress={() => void saveWeight(key, weightDraft[key] ?? String(total))} />
        {allocations ? <><Body>Раскладка по контейнерам</Body>{allocations.allocations.map(item => <Body key={item.personId}>{item.label}: {item.perContainerG.length} × {item.perContainerG.join(' / ')} г</Body>)}
          <Body muted>Масса распределена по рассчитанным порциям этого блюда. Фактические КБЖУ зависят от выхода блюда.</Body></> : null}
      </Card>;
    })}
    {message ? <Body>{message}</Body> : null}
    {problem ? <Status error={problem} /> : null}
    <Button title="Партия приготовлена" onPress={() => void finish()} />
  </Screen>;
}
