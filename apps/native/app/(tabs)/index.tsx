import { useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useApp } from '../../src/app-state';
import { localDate, plusDays, SLOT_LABELS } from '../../src/logic';
import type { MealSlot } from '../../src/types';
import { Body, Button, Card, Choice, Screen, Status, Title } from '../../src/ui';

export default function Week() {
  const { loading, error, refresh, plan, bootstrap, updatePlan, sync } = useApp();
  const [day, setDay] = useState(localDate());
  const [personId, setPersonId] = useState<string | null>(null);
  if (loading || error && !plan) return <Screen><Status loading={loading} error={error} retry={refresh} /></Screen>;
  if (!plan) return <Screen><Title subtitle="Ваш план питания">Неделя пока свободна</Title><Card><Body>Составьте меню, закупитесь и готовьте партиями в удобном ритме.</Body></Card><Button title="Составить план" onPress={() => router.push('/plan')} /></Screen>;
  const selectedDay = day < plan.start ? plan.start : day > plan.end ? plan.end : day;
  const person = plan.people.find(item => item.id === personId) ?? plan.people[0];
  const batch = plan.batches.find(item => selectedDay >= item.start && selectedDay <= item.end);
  const eaten = new Set(plan.mealExecution?.eaten ?? []);
  const toggleEaten = (slot: MealSlot) => {
    const key = `${person.id}:${selectedDay}:${slot}`;
    void updatePlan(current => {
      const eaten = new Set(current.mealExecution?.eaten ?? []);
      if (eaten.has(key)) eaten.delete(key); else eaten.add(key);
      return { ...current, mealExecution: { eaten: [...eaten] } };
    }).catch(() => Alert.alert('Не удалось сохранить', 'Повторите попытку.'));
  };
  const toggleCooked = () => {
    if (!batch) return;
    void updatePlan(current => {
      const cooked = new Set(current.cookedBatchIds ?? []);
      if (cooked.has(batch.id)) cooked.delete(batch.id); else cooked.add(batch.id);
      return { ...current, cookedBatchIds: [...cooked] };
    }).catch(() => Alert.alert('Не удалось сохранить', 'Повторите попытку.'));
  };
  return <Screen><Title subtitle={`${plan.start} — ${plan.end}`}>Ваша неделя</Title>
    {localDate() > plan.end ? <Card><Body>Период завершён. Можно составить следующий план, сохранив привычный ритм готовки.</Body><Button title="Новый план" onPress={() => router.push('/plan')} /></Card> : null}
    <Body muted>{sync === 'pending' ? 'Изменения на устройстве · синхронизируем при подключении' : sync === 'error' ? 'Не удалось связаться с сервером' : 'План синхронизирован'}</Body>
    <Card><Body>{selectedDay === localDate() ? 'Сегодня' : selectedDay}</Body><Button title="← Предыдущий день" secondary disabled={selectedDay <= plan.start} onPress={() => setDay(plusDays(selectedDay, -1))} />
      <Button title="Следующий день →" secondary disabled={selectedDay >= plan.end} onPress={() => setDay(plusDays(selectedDay, 1))} /></Card>
    {plan.people.length > 1 ? <Card>{plan.people.map(item => <Choice key={item.id} title={item.name} selected={person.id === item.id} onPress={() => setPersonId(item.id)} />)}</Card> : null}
    {batch?.start === selectedDay ? <Card><Body>Сегодня готовим партию {batch.index + 1} на {batch.days} дн.</Body>
      <Button title="Открыть готовку и раскладку" onPress={() => router.push(`/cook/${batch.id}`)} />
      <Choice title="Партия приготовлена" selected={(plan.cookedBatchIds ?? []).includes(batch.id)} onPress={toggleCooked} /></Card> : null}
    {batch && person.includedSlots.map(slot => {
      const key = `${batch.id}:${slot}`;
      const assignment = plan.selectionAssignments?.[key]?.find(item => item.personIds.includes(person.id));
      const recipeId = assignment?.recipeId ?? plan.selections[key];
      const recipe = bootstrap?.recipes.find(item => item.id === recipeId);
      const occurrence = `${person.id}:${selectedDay}:${slot}`;
      return <Card key={slot}><Body>{SLOT_LABELS[slot]}</Body><Body>{recipe?.title ?? 'Блюдо сохранено в плане'}</Body>
        {recipe ? <Button title="Открыть рецепт" secondary onPress={() => router.push(`/recipe/${recipe.id}`)} /> : null}
        <Choice title="Съедено" selected={eaten.has(occurrence)} onPress={() => toggleEaten(slot)} /></Card>;
    })}
    {selectedDay === plan.end ? <Button title="Составить следующий план" onPress={() => router.push('/plan')} /> : null}
  </Screen>;
}
