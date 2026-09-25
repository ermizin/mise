import * as Notifications from 'expo-notifications';
import type { Plan } from './types';
import { plusDays } from './logic';

export type ReminderSettings = { cooking: boolean; thaw: boolean; expiry: boolean; hour: number };
export const defaultReminders: ReminderSettings = { cooking: true, thaw: true, expiry: false, hour: 18 };
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
function triggerDate(day: string, hour: number) { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, hour, 0); }
export function reminderPreview(plan: Plan, settings: ReminderSettings) {
  const reminders = plan.batches.flatMap(batch => [
    ...(settings.cooking ? [{ key: `cook:${batch.id}`, date: triggerDate(batch.start, settings.hour), title: 'Сегодня готовим', body: `Партия ${batch.index + 1}: откройте план готовки.` }] : []),
    ...(settings.thaw ? (plan.cooking ?? []).filter(session => session.key.startsWith(`${batch.id}:`) && session.frozenDays > 0).map(session => ({ key: `thaw:${batch.id}:${session.recipeId}`, date: triggerDate(plusDays(batch.start, batch.days - session.frozenDays - 1), 21), title: 'Достать из морозилки', body: 'Переложите нужные порции в холодильник на завтра.' })) : []),
    ...(settings.expiry ? [{ key: `expiry:${batch.id}`, date: triggerDate(plusDays(batch.end, -1), 19), title: 'Проверьте срок хранения', body: 'Проверьте оставшиеся порции партии.' }] : []),
  ]).filter(item => item.date.getTime() > Date.now()).sort((a, b) => a.date.getTime() - b.date.getTime());
  return reminders.filter((item, index) => item.key.startsWith('thaw:') ? reminders.findIndex(other => other.key.startsWith('thaw:') && other.date.getTime() === item.date.getTime()) === index : true);
}
export async function enableReminders(plan: Plan, settings: ReminderSettings) {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Разрешение на уведомления не получено. Его можно включить в настройках iPhone.');
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const item of reminderPreview(plan, settings)) {
    await Notifications.scheduleNotificationAsync({ content: { title: item.title, body: item.body, data: { planId: plan.id, key: item.key } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: item.date } });
  }
}
export async function disableReminders() { await Notifications.cancelAllScheduledNotificationsAsync(); }
