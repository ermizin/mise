import { Image } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '../../src/app-state';
import { Body, Button, Card, Screen, Status, Title } from '../../src/ui';
import { recipeAssets } from '../../src/generated/recipe-assets';
export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bootstrap, loading } = useApp();
  const recipe = bootstrap?.recipes.find(item => item.id === id);
  return <Screen><Button title="← Назад" secondary onPress={() => router.back()} />
    {loading ? <Status loading /> : !recipe ? <Status empty="Рецепт не найден в сохранённом каталоге. Обновите данные при подключении к сети." /> : <>
      <Title subtitle={recipe.kcal ? `Около ${recipe.kcal} ккал на базовую порцию` : undefined}>{recipe.title}</Title>
      {recipeAssets[recipe.id] ? <Image source={recipeAssets[recipe.id]} accessibilityLabel={`Фото: ${recipe.title}`} style={{ width: '100%', height: 260, borderRadius: 18 }} resizeMode="cover" /> : null}
      {recipe.photoOrigin === 'generated' ? <Body muted>Изображение создано для Mise и показывает пример подачи.</Body> : null}
      <Card><Body>Хранение</Body><Body muted>{recipe.storage?.refrigerator ?? 'Сверьте условия хранения.'}</Body>
        {recipe.storage?.freezable ? <Body muted>{recipe.storage.freezer} {recipe.storage.thaw}</Body> : null}</Card>
      <Card><Body>Продукты на базовую порцию</Body>{recipe.ingredients.map((item, index) => <Body key={`${item.name}-${index}`}>{item.name} · {item.amount} {item.unit}</Body>)}</Card>
      <Card><Body>Готовка</Body>{recipe.effort ? <Body muted>Активно около {recipe.effort.activeMinutes} мин · процессов параллельно: {recipe.effort.parallelProcesses}</Body> : null}
        {recipe.instructions?.length ? recipe.instructions.map((step, index) => <Body key={index}>{index + 1}. {step}</Body>) : <Body muted>Пошаговая инструкция пока недоступна в локальном каталоге.</Body>}</Card>
      {recipe.packing ? <Card><Body>Разложить</Body><Body>{recipe.packing.portion}</Body><Body muted>{recipe.packing.label}</Body></Card> : null}
      <Body muted>КБЖУ и сроки хранения ориентировочные. После готовки сверяйте фактический выход и условия хранения.</Body>
    </>}
  </Screen>;
}
