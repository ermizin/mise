/** A timer duration parsed from a recipe instruction. All values are whole seconds. */
export type UnknownCookingDuration = { kind: "unknown" };
export type ExactCookingDuration = { kind: "exact"; seconds: number };
export type RangeCookingDuration = {
  kind: "range";
  minSeconds: number;
  maxSeconds: number;
};
export type CookingDurationOption = ExactCookingDuration | RangeCookingDuration;
export type MultipleCookingDuration = {
  kind: "multiple";
  options: CookingDurationOption[];
};

export type CookingDuration =
  | UnknownCookingDuration
  | CookingDurationOption
  | MultipleCookingDuration;

type TimePart = {
  start: number;
  end: number;
  rank: number;
  minSeconds: number;
  maxSeconds: number;
};

const TIME_PART = /(\d+(?:[.,]\d+)?)(?:\s*[-–—]\s*(\d+(?:[.,]\d+)?))?\s*(час(?:а|ов)?\.?|ч\.?|мин(?:ут(?:а|ы)?)?\.?|сек(?:унд(?:а|ы)?)?\.?|с)(?![а-яё])/giu;

function secondsFor(value: number, unit: string) {
  if (unit.startsWith("ч") || unit.startsWith("час")) return value * 3_600;
  if (unit.startsWith("м") || unit.startsWith("мин")) return value * 60;
  return value;
}

function rankFor(unit: string) {
  if (unit.startsWith("ч") || unit.startsWith("час")) return 3;
  if (unit.startsWith("м") || unit.startsWith("мин")) return 2;
  return 1;
}

function timeParts(text: string): TimePart[] {
  const parts: TimePart[] = [];
  for (const match of text.matchAll(TIME_PART)) {
    const first = Number(match[1].replace(",", "."));
    const second = Number((match[2] ?? match[1]).replace(",", "."));
    const unit = match[3].toLocaleLowerCase("ru-RU");
    const minSeconds = Math.round(secondsFor(Math.min(first, second), unit));
    const maxSeconds = Math.round(secondsFor(Math.max(first, second), unit));
    if (!Number.isFinite(minSeconds) || !Number.isFinite(maxSeconds) || minSeconds <= 0) continue;
    parts.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      rank: rankFor(unit),
      minSeconds,
      maxSeconds,
    });
  }
  return parts;
}

function isCompoundConnector(textBetweenParts: string) {
  return /^\s*(?:и\s*)?$/iu.test(textBetweenParts);
}

function option(minSeconds: number, maxSeconds: number): CookingDurationOption {
  return minSeconds === maxSeconds
    ? { kind: "exact", seconds: minSeconds }
    : { kind: "range", minSeconds, maxSeconds };
}

/**
 * Extracts explicit Russian timer expressions. Adjacent descending units form one
 * compound duration ("1 час 30 мин"); explicitly sequential expressions remain
 * individual choices so callers never accidentally start a summed timer.
 */
export function parseCookingDuration(text: string | null | undefined): CookingDuration {
  if (!text?.trim()) return { kind: "unknown" };
  const parts = timeParts(text);
  if (!parts.length) return { kind: "unknown" };

  const options: CookingDurationOption[] = [];
  let minSeconds = parts[0].minSeconds;
  let maxSeconds = parts[0].maxSeconds;
  let previous = parts[0];

  const finish = () => options.push(option(minSeconds, maxSeconds));
  for (const part of parts.slice(1)) {
    const between = text.slice(previous.end, part.start);
    const compound = isCompoundConnector(between) && part.rank < previous.rank;
    if (compound) {
      minSeconds += part.minSeconds;
      maxSeconds += part.maxSeconds;
    } else {
      finish();
      minSeconds = part.minSeconds;
      maxSeconds = part.maxSeconds;
    }
    previous = part;
  }
  finish();

  return options.length === 1 ? options[0] : { kind: "multiple", options };
}

function formatSeconds(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const remainder = whole % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} ч`);
  if (minutes) parts.push(`${minutes} мин`);
  if (remainder || !parts.length) parts.push(`${remainder} сек`);
  return parts.join(" ");
}

export function formatCookingDuration(duration: CookingDuration): string {
  if (duration.kind === "unknown") return "";
  if (duration.kind === "exact") return formatSeconds(duration.seconds);
  if (duration.kind === "multiple") {
    return duration.options.map(formatCookingDuration).join(" / ");
  }
  const unit = duration.minSeconds % 3_600 === 0 && duration.maxSeconds % 3_600 === 0
    ? [3_600, "ч"] as const
    : duration.minSeconds % 60 === 0 && duration.maxSeconds % 60 === 0
      ? [60, "мин"] as const
      : [1, "сек"] as const;
  return `${duration.minSeconds / unit[0]}–${duration.maxSeconds / unit[0]} ${unit[1]}`;
}
