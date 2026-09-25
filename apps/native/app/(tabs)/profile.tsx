import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useApp } from '../../src/app-state';
import { local } from '../../src/repository';
import { defaultReminders, disableReminders, enableReminders, reminderPreview, type ReminderSettings } from '../../src/reminders';
import { Body, Button, Card, Choice, Field, Screen, Status, Title } from '../../src/ui';

export default function Profile() {
  const { plan, sync, refresh, clearLocalPlan } = useApp();
  const [settings, setSettings] = useState<ReminderSettings>(defaultReminders);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void local.reminders().then(value => { if (value) setSettings(value); }); }, []);
  useEffect(() => { void Notifications.getAllScheduledNotificationsAsync().then(items => setEnabled(Boolean(plan && items.some(item => item.content.data?.planId === plan.id)))); }, [plan]);
  const change = (next: ReminderSettings) => { setSettings(next); void local.saveReminders(next); if (enabled) { setEnabled(false); void disableReminders(); } };
  const turnOn = async () => {
    if (!plan) return;
    try { await enableReminders(plan, settings); setEnabled(true); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось включить напоминания.'); }
  };
  const remove = () => Alert.alert('Удалить текущий план?', 'План, покупки и отметки исчезнут с этого устройства и после синхронизации с сервера.', [
    { text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => { void disableReminders(); void clearLocalPlan(); } },
  ]);
  return <Screen><Title subtitle="Ваши настройки">Профиль</Title>
    <Card><Body>План и синхронизация</Body><Body muted>{sync === 'synced' ? 'Последние изменения сохранены на сервере.' : sync === 'pending' ? 'Изменения хранятся на iPhone и будут отправлены при подключении.' : 'Сервер пока недоступен. Локальный план сохранён.'}</Body>
      <Button title="Повторить синхронизацию" secondary onPress={() => void refresh()} />
      <Button title={plan ? 'Составить следующий план' : 'Составить план'} onPress={() => router.push('/plan')} />
      {plan ? <Button title="Удалить текущий план" secondary onPress={remove} /> : null}</Card>
    {plan ? <Card><Body>Напоминания на этом iPhone</Body><Body muted>Перед включением проверьте расписание. Разрешение iOS запрашивается только после нажатия кнопки.</Body>
      <Choice title="Сегодня готовим" selected={settings.cooking} onPress={() => change({ ...settings, cooking: !settings.cooking })} />
      <Choice title="Достать из морозилки" selected={settings.thaw} onPress={() => change({ ...settings, thaw: !settings.thaw })} />
      <Choice title="Срок хранения истекает" selected={settings.expiry} onPress={() => change({ ...settings, expiry: !settings.expiry })} />
      <Field label="Во сколько готовить (час, 0–23)" value={String(settings.hour)} keyboardType="numeric" onChangeText={value => change({ ...settings, hour: Math.min(23, Math.max(0, Number(value) || 0)) })} />
      {reminderPreview(plan, settings).slice(0, 8).map(item => <Body key={item.key} muted>{item.date.toLocaleString('ru-RU')}: {item.title}</Body>)}
      <Button title={enabled ? 'Обновить напоминания' : 'Включить напоминания'} onPress={() => void turnOn()} />
      {enabled ? <Button title="Выключить напоминания" secondary onPress={() => { void disableReminders(); setEnabled(false); }} /> : null}
      {error ? <Status error={error} /> : null}</Card> : null}
    <Card><Body>О Mise</Body><Body muted>КБЖУ и сроки хранения — ориентиры. При аллергии проверяйте состав и следы аллергенов на упаковке. Приготовленные порции маркируйте датой и храните по инструкции рецепта.</Body></Card>
  </Screen>;
}
