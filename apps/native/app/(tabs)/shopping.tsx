import { router } from 'expo-router';
import { Alert } from 'react-native';
import { useApp } from '../../src/app-state';
import { Body, Button, Card, Choice, Screen, Status, Title } from '../../src/ui';
export default function Shopping() {
  const { plan, loading, error, refresh, updatePlan, sync } = useApp();
  if (loading || error && !plan) return <Screen><Status loading={loading} error={error} retry={refresh} /></Screen>;
  if (!plan) return <Screen><Title>Покупки</Title><Status empty="Сначала составьте план — список появится здесь." /><Button title="Составить план" onPress={() => router.push('/plan')} /></Screen>;
  const done = plan.shopping.filter(item => item.checked).length;
  return <Screen><Title subtitle={`${done} из ${plan.shopping.length} отмечено`}>Покупки</Title>
    <Body muted>{sync === 'pending' ? 'Отметки сохранены на устройстве' : 'Обновляется вместе с планом'}</Body>
    {plan.shopping.length ? <Card>{plan.shopping.map(item => <Choice key={item.key} title={item.name} detail={`${Math.round(item.quantity * 10) / 10} ${item.unit}`} selected={item.checked} onPress={() => void updatePlan(current => ({ ...current, shopping: current.shopping.map(part => part.key === item.key ? { ...part, checked: !part.checked } : part) })).catch(() => Alert.alert('Не удалось сохранить', 'Повторите попытку.'))} />)}</Card>
      : <Status empty="Для этого плана список продуктов пуст. Проверьте меню и повторите загрузку каталога." />}
  </Screen>;
}
