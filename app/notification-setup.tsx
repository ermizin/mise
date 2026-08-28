"use client";

import { useEffect, useMemo, useState } from "react";

export type NotificationPlan = {
  id: string;
  end: string;
  batches: { id: string; index: number; start: string }[];
  frozenUseDates: string[];
};

type ReminderKind = "shopping" | "cooking" | "thaw" | "next-plan";
type ReminderToggles = Record<ReminderKind, boolean>;
type StoredPreferences = {
  toggles: ReminderToggles;
  cookTimes: Record<string, string>;
  thawTime: string;
};

type ScheduledJob = {
  kind: ReminderKind;
  title: string;
  body: string;
  url: string;
  dueAt: number;
};

const defaultToggles: ReminderToggles = { shopping: true, cooking: true, thaw: true, "next-plan": true };

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, amount: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return isoDate(date);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(parseDate(value)).replace(".", "");
}

function atLocalTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).getTime();
}

function applicationServerKey(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function buildJobs(plan: NotificationPlan, preferences: StoredPreferences) {
  const jobs: ScheduledJob[] = [];
  const firstCookTime = preferences.cookTimes[plan.batches[0]?.id] ?? "18:00";
  for (const batch of plan.batches) {
    const cookTime = preferences.cookTimes[batch.id] ?? firstCookTime;
    if (preferences.toggles.shopping) jobs.push({
      kind: "shopping",
      title: "Проверьте покупки",
      body: `Завтра готовка ${batch.index + 1}. Всё нужное уже куплено?`,
      url: "/?tab=shopping",
      dueAt: atLocalTime(addDays(batch.start, -1), cookTime),
    });
    if (preferences.toggles.cooking) jobs.push({
      kind: "cooking",
      title: `Пора готовить партию ${batch.index + 1}`,
      body: `Откройте рецепты и раскладку порций на ${formatDate(batch.start)}.`,
      url: "/",
      dueAt: atLocalTime(batch.start, cookTime),
    });
  }
  if (preferences.toggles.thaw) for (const date of [...new Set(plan.frozenUseDates)]) jobs.push({
    kind: "thaw",
    title: "Переложите порции в холодильник",
    body: `Завтра, ${formatDate(date)}, понадобятся замороженные порции.`,
    url: "/",
    dueAt: atLocalTime(addDays(date, -1), preferences.thawTime),
  });
  if (preferences.toggles["next-plan"]) jobs.push({
    kind: "next-plan",
    title: "Пора составить следующий план",
    body: "До конца текущего плана осталось два дня.",
    url: "/?new-plan=1",
    dueAt: atLocalTime(addDays(plan.end, -2), firstCookTime),
  });
  return jobs.filter((job) => job.dueAt > Date.now() + 30_000);
}

export function NotificationSetupPanel({ plan, clientId, deviceId, onDone, onCancel }: { plan: NotificationPlan; clientId: string; deviceId: string; onDone: () => void; onCancel: () => void }) {
  const defaultCookTimes = useMemo(() => Object.fromEntries(plan.batches.map((batch) => [batch.id, "18:00"])), [plan.batches]);
  const [toggles, setToggles] = useState<ReminderToggles>(defaultToggles);
  const [cookTimes, setCookTimes] = useState<Record<string, string>>(defaultCookTimes);
  const [thawTime, setThawTime] = useState("21:00");
  const [enabled, setEnabled] = useState(false);
  const [testDelivered, setTestDelivered] = useState(false);
  const [testState, setTestState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error" | "unavailable" | "denied">("idle");

  useEffect(() => {
    let mounted = true;
    fetch("/api/push", { headers: { "X-Mise-Client": clientId, "X-Mise-Device": deviceId } })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { enabled?: boolean; planId?: string; preferences?: StoredPreferences | null }) => {
        if (!mounted || data.planId !== plan.id || !data.preferences) return;
        setEnabled(Boolean(data.enabled));
        setToggles({ ...defaultToggles, ...data.preferences.toggles });
        setCookTimes({ ...defaultCookTimes, ...data.preferences.cookTimes });
        setThawTime(data.preferences.thawTime || "21:00");
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, [clientId, defaultCookTimes, deviceId, plan.id]);

  const preferences = useMemo<StoredPreferences>(() => ({ toggles, cookTimes, thawTime }), [toggles, cookTimes, thawTime]);
  const jobs = useMemo(() => buildJobs(plan, preferences), [plan, preferences]);

  function toggle(kind: ReminderKind) {
    setToggles((current) => ({ ...current, [kind]: !current[kind] }));
    setStatus("idle");
  }

  async function enable() {
    setStatus("saving");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setStatus("unavailable");
        return;
      }
      const keyResponse = await fetch("/api/push", { headers: { "X-Mise-Client": clientId, "X-Mise-Device": deviceId } });
      const keyData = await keyResponse.json() as { available?: boolean; publicKey?: string | null };
      if (!keyResponse.ok || !keyData.available || !keyData.publicKey) {
        setStatus("unavailable");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(keyData.publicKey) });
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Mise-Client": clientId, "X-Mise-Device": deviceId },
        body: JSON.stringify({ action: "enable", planId: plan.id, subscription: subscription.toJSON(), preferences, jobs }),
      });
      if (!response.ok) throw new Error("save failed");
      const result = await response.json() as { testDelivered?: boolean };
      setEnabled(true);
      setTestDelivered(Boolean(result.testDelivered));
      setTestState(result.testDelivered ? "success" : "error");
      setStatus("success");
      window.dispatchEvent(new Event("mise:reminders-enabled"));
    } catch {
      setStatus("error");
      window.dispatchEvent(new Event("mise:reminder-enable-error"));
    }
  }

  async function disable() {
    setStatus("saving");
    try {
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Mise-Client": clientId, "X-Mise-Device": deviceId },
        body: JSON.stringify({ action: "disable", planId: plan.id }),
      });
      if (!response.ok) throw new Error("disable failed");
      setEnabled(false);
      setTestState("idle");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function sendTest() {
    setTestState("sending");
    try {
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Mise-Client": clientId, "X-Mise-Device": deviceId },
        body: JSON.stringify({ action: "test", planId: plan.id }),
      });
      const result = await response.json() as { testDelivered?: boolean };
      if (!response.ok || !result.testDelivered) throw new Error("test failed");
      setTestDelivered(true);
      setTestState("success");
    } catch {
      setTestDelivered(false);
      setTestState("error");
    }
  }

  const testControl = enabled ? <div className="notification-test-control">
    <button className="secondary-button notification-test-button" disabled={testState === "sending" || status === "saving"} onClick={sendTest}>{testState === "sending" ? "Отправляем тест…" : "Отправить тестовое уведомление"}</button>
    {testState === "success" && <small role="status">✓ Тест отправлен на это устройство.</small>}
    {testState === "error" && <small className="test-error" role="alert">Тест не доставлен. Проверьте системные настройки.</small>}
  </div> : null;

  return <section className="notification-setup" aria-labelledby="notifications-title">
    <div className="notification-heading"><span>🔔</span><div><p className="kicker">По расписанию плана</p><h2 id="notifications-title">Напоминания</h2><p>Сначала проверьте расписание. Системное разрешение появится только после нажатия «Включить».</p></div></div>
    <div className="reminder-list glass-card">
      <ReminderToggle active={toggles.shopping} title="Проверить покупки" note="Накануне каждой готовки, в то же время" onClick={() => toggle("shopping")} />
      <ReminderToggle active={toggles.cooking} title="Приготовить партию" note={`${plan.batches.length} ${plan.batches.length === 1 ? "готовка" : "готовки"}`} onClick={() => toggle("cooking")} />
      {toggles.cooking && <div className="cook-time-list">{plan.batches.map((batch) => <label key={batch.id}><span>Готовка {batch.index + 1} · {formatDate(batch.start)}</span><input type="time" value={cookTimes[batch.id] ?? "18:00"} onChange={(event) => setCookTimes((current) => ({ ...current, [batch.id]: event.target.value }))} /></label>)}</div>}
      <ReminderToggle active={toggles.thaw} title="Разморозить порции" note={plan.frozenUseDates.length ? `${[...new Set(plan.frozenUseDates)].length} вечера` : "В этом плане не понадобится"} disabled={!plan.frozenUseDates.length} onClick={() => toggle("thaw")} />
      {toggles.thaw && plan.frozenUseDates.length > 0 && <label className="single-time"><span>Накануне использования</span><input type="time" value={thawTime} onChange={(event) => setThawTime(event.target.value)} /></label>}
      <ReminderToggle active={toggles["next-plan"]} title="Составить следующий план" note={`За 2 дня до окончания · ${cookTimes[plan.batches[0]?.id] ?? "18:00"}`} onClick={() => toggle("next-plan")} />
    </div>
    <p className="schedule-summary">Будет запланировано: <b>{jobs.length}</b>. Напоминания относятся только к этому плану и этому устройству.</p>
    {status === "success" ? <><div className="notification-success" role="status">✓ {testDelivered ? "Включено. Проверочное уведомление уже отправлено." : "Расписание включено. Проверочное уведомление не доставлено — проверьте системные настройки."}</div>{testControl}<button className="primary-button" onClick={onDone}>Открыть план <span>→</span></button></> : <>
      {status === "unavailable" && <p className="notification-error" role="alert">На этом устройстве Web Push недоступен. На iPhone откройте Mise с экрана Домой.</p>}
      {status === "denied" && <p className="notification-error" role="alert">Разрешение не выдано. План продолжит работать без уведомлений.</p>}
      {status === "error" && <p className="notification-error" role="alert">Не удалось сохранить напоминания. Проверьте соединение и попробуйте снова.</p>}
      <button className="primary-button" disabled={status === "saving" || jobs.length === 0} onClick={enable}>{status === "saving" ? "Включаем…" : enabled ? "Обновить расписание" : "Включить напоминания"}</button>
      {testControl}
      {enabled && <button className="secondary-button" disabled={status === "saving"} onClick={disable}>Выключить для этого плана</button>}
      <button className="text-button" onClick={onCancel}>{enabled ? "Закрыть" : "Продолжить без них"}</button>
    </>}
  </section>;
}

function ReminderToggle({ active, title, note, disabled = false, onClick }: { active: boolean; title: string; note: string; disabled?: boolean; onClick: () => void }) {
  return <button className="reminder-toggle" aria-pressed={active} disabled={disabled} onClick={onClick}><span className={`toggle-control ${active && !disabled ? "active" : ""}`}><i /></span><span><b>{title}</b><small>{note}</small></span></button>;
}
