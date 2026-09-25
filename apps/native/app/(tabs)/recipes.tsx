import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { useApp } from '../../src/app-state';
import { SLOTS, SLOT_LABELS } from '../../src/logic';
import type { MealSlot } from '../../src/types';
import { Body, Button, Card, Choice, Field, Screen, Status, Title } from '../../src/ui';

export default function Recipes() {
  const { bootstrap, loading, error, refresh } = useApp();
  const [query, setQuery] = useState('');
  const [slot, setSlot] = useState<MealSlot | null>(null);
  const recipes = useMemo(() => (bootstrap?.recipes ?? []).filter(item => (!slot || item.mealSlots.includes(slot)) && item.title.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))), [bootstrap, slot, query]);
  return <Screen><Title subtitle="Проверенный каталог Mise">Рецепты</Title>
    <Field label="Поиск блюда" value={query} onChangeText={setQuery} placeholder="Название рецепта" />
    <Card><Choice title="Все" selected={!slot} onPress={() => setSlot(null)} />{SLOTS.map(item => <Choice key={item} title={SLOT_LABELS[item]} selected={slot === item} onPress={() => setSlot(item)} />)}</Card>
    {loading || error && !bootstrap ? <Status loading={loading} error={error} retry={refresh} /> : !recipes.length ? <Status empty="Подходящих рецептов пока нет." /> : recipes.map(recipe => <Card key={recipe.id}>
      <Body>{recipe.title}</Body><Body muted>{recipe.kcal ? `Около ${recipe.kcal} ккал на базовую порцию · ` : ''}{recipe.storageDays ? `${recipe.storageDays} дн. в холодильнике` : 'Условия хранения в карточке'}</Body>
      <Button title="Открыть" secondary onPress={() => router.push(`/recipe/${recipe.id}`)} /></Card>)}
  </Screen>;
}
