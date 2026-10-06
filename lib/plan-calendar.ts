/* Календарь плана — напоминания без установки приложения и без разрешений.

   Web Push на iPhone работает только из приложения на домашнем экране, поэтому
   большинство людей его не включает. Обычный календарь телефона есть у всех:
   файл .ics добавляет готовки, вечера разморозки и событие «собрать следующий
   план» со ссылкой обратно в Mise. В адресе только даты и время — без блюд,
   людей, целей и исключений — и ключ устройства, на котором собран план.

   Ключ нужен потому, что календарь открывает ссылку в системном браузере, а
   план часто собран во встроенном браузере Пикабу, vc или Telegram: там своё
   хранилище, и без ключа человек увидел бы пустое приложение вместо своего
   плана. В событиях ключ стоит во фрагменте адреса (#plan=…), поэтому при
   открытии ссылки он не уходит на сервер и в чужие referrer. */

export type PlanCalendarInput = {
  /** Дни готовок — начало каждой партии. */
  cook: string[];
  /** Дни, когда понадобятся замороженные порции; напоминание — накануне. */
  frozen: string[];
  /** Последний день плана. */
  end: string;
  /** Ключ устройства с планом — чтобы ссылка открыла тот же план. */
  device?: string;
};

export type PlanCalendarSource = {
  end: string;
  batches: { start: string }[];
  frozenUseDates: string[];
};

const COOK_TIME = "18:00";
const THAW_TIME = "21:00";
const NEXT_PLAN_TIME = "19:00";
const MAX_DATES = 14;
const MAX_PLAN_SPAN_DAYS = 15;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const devicePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validDate(value: string) {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function dateList(value: string | null) {
  if (!value) return [];
  return [...new Set(value.split(",").filter(Boolean))].sort();
}

export function planCalendarPath(plan: PlanCalendarSource, device?: string) {
  const params = new URLSearchParams();
  params.set("end", plan.end);
  params.set("cook", [...new Set(plan.batches.map((batch) => batch.start))].join(","));
  const frozen = [...new Set(plan.frozenUseDates)];
  if (frozen.length) params.set("frozen", frozen.join(","));
  if (device && devicePattern.test(device)) params.set("device", device);
  return `/api/calendar?${params.toString()}`;
}

export function parsePlanCalendarQuery(
  params: URLSearchParams,
): { input: PlanCalendarInput } | { error: string } {
  const end = params.get("end") ?? "";
  if (!validDate(end)) return { error: "end must be a date" };
  const cook = dateList(params.get("cook"));
  const frozen = dateList(params.get("frozen"));
  if (cook.length === 0) return { error: "cook dates are required" };
  if (cook.length > MAX_DATES || frozen.length > MAX_DATES)
    return { error: "too many dates" };
  for (const date of [...cook, ...frozen]) {
    if (!validDate(date)) return { error: "dates must be YYYY-MM-DD" };
    const offset = daysBetween(date, end);
    if (offset < 0 || offset > MAX_PLAN_SPAN_DAYS)
      return { error: "dates must belong to the plan period" };
  }
  const device = params.get("device");
  if (device !== null && !devicePattern.test(device))
    return { error: "device must be a UUID" };
  return {
    input: { cook, frozen, end, ...(device ? { device: device.toLowerCase() } : {}) },
  };
}

function escapeText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

/* RFC 5545: строки длиннее 75 октетов переносятся, продолжение начинается с
   пробела. Кириллица занимает два байта, поэтому считаем байты, а не символы. */
function fold(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + width > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += character;
    size += width;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function localStamp(date: string, time: string) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function utcStamp(now: number) {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

type CalendarEvent = {
  uid: string;
  date: string;
  time: string;
  duration: string;
  alarm: string;
  summary: string;
  description: string;
  url: string;
};

export function buildPlanCalendar(
  input: PlanCalendarInput,
  options: { origin: string; now: number },
) {
  const resume = input.device ? `#plan=${input.device}` : "";
  const appUrl = `${options.origin}/${resume}`;
  const nextPlanUrl = `${options.origin}/?utm_source=calendar${resume}`;
  const events: CalendarEvent[] = input.cook.map((date, index) => ({
    uid: `mise-cook-${date}-${input.end}`,
    date,
    time: COOK_TIME,
    duration: "PT1H30M",
    alarm: "-PT30M",
    summary:
      input.cook.length === 1
        ? "Mise: готовка"
        : `Mise: готовка ${index + 1} из ${input.cook.length}`,
    description: `Рецепты, покупки и раскладка порций — в Mise: ${appUrl}`,
    url: appUrl,
  }));
  for (const date of input.frozen) {
    const evening = shiftDate(date, -1);
    events.push({
      uid: `mise-thaw-${date}-${input.end}`,
      date: evening,
      time: THAW_TIME,
      duration: "PT15M",
      alarm: "PT0M",
      summary: "Mise: переложить порции в холодильник",
      description: `Завтра понадобятся замороженные порции. Какие — в Mise: ${appUrl}`,
      url: appUrl,
    });
  }
  events.push({
    uid: `mise-next-plan-${input.end}`,
    date: input.end,
    time: NEXT_PLAN_TIME,
    duration: "PT15M",
    alarm: "PT0M",
    summary: "Mise: собрать следующий план",
    description: `Сегодня последний день плана. Люди, цели и техника уже сохранены — новый план займёт пару минут: ${nextPlanUrl}`,
    url: nextPlanUrl,
  });
  events.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  const stamp = utcStamp(options.now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mise//Meal plan//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Mise",
  ];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}@mise.ermizinm.ru`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${localStamp(event.date, event.time)}`,
      `DURATION:${event.duration}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      `URL:${event.url}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.summary)}`,
      `TRIGGER:${event.alarm}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
