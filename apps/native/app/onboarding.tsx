import { useState } from 'react';
import { router } from 'expo-router';
import { useApp } from '../src/app-state';
import { Body, Button, Card, Screen, Title } from '../src/ui';
const slides = [
  { title: 'Готовим раз — едим всю неделю', body: 'Mise превращает ваши цели по КБЖУ в меню, покупки и порции на несколько дней. Меньше ежедневных решений — больше регулярности.' },
  { title: 'Готовьте партиями', body: 'Вы выбираете дни готовки. Mise подбирает блюда на каждую партию и показывает, что купить, приготовить и разложить по контейнерам.' },
  { title: 'План рядом', body: 'Последний план и список покупок доступны без устойчивой сети. Напоминания можно включить позже, после проверки расписания.' },
];
export default function Onboarding() {
  const [index, setIndex] = useState(0);
  const { finishOnboarding } = useApp();
  const next = async () => { if (index < slides.length - 1) setIndex(index + 1); else { await finishOnboarding(); router.replace('/(tabs)'); } };
  return <Screen><Title subtitle={`${index + 1} из ${slides.length}`}>{slides[index].title}</Title><Card><Body>{slides[index].body}</Body></Card>
    <Button title={index === slides.length - 1 ? 'Начать' : 'Дальше'} onPress={() => void next()} />
    {index > 0 ? <Button title="Назад" onPress={() => setIndex(index - 1)} secondary /> : null}</Screen>;
}
