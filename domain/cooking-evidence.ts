export type BackgroundCandidateCategory = "oven" | "covered_simmer" | "boil" | "cold_wait";

export type BackgroundCandidate = {
  durationSeconds: number;
  durationText: string;
  category: BackgroundCandidateCategory;
};

const duration = /(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?\s*(секунд(?:ы|у)?|сек\.?|минут(?:ы|у|а)?|мин\.?|час(?:а|ов)?|ч\.?)/giu;
const excludedScope = /(?:если|либо|или|по желанию|при необходимости|можно|когда|помешива|взбива|перевер|кажд(?:ые|ую|ый)|через|середин|половин|следя|периодически|пока|лучше|за раз|порци(?:ями|ю)|партия)/iu;
const approximate = /(?:около|примерно|порядка|минимум|не менее)/iu;
const imperative = /(?:^|[^\p{L}])([а-яё]+(?:йте|ите|айте|яйте|уйте|ьте))(?=$|[^\p{L}])/giu;

function hasIndependentImperative(text: string): boolean {
  return [...text.matchAll(imperative)].length > 0;
}

/**
 * A timer may follow only the physical act of loading/covering the appliance.
 * Ingredient preparation belongs to a separate manual action, even when the
 * source splitter kept both clauses together.
 */
function isOnlyPhysicalStart(text: string, category: BackgroundCandidateCategory): boolean {
  const verbs = [...text.matchAll(imperative)].map((match) => match[1].toLocaleLowerCase("ru-RU"));
  const allowed = category === "oven"
    ? new Set(["поставьте", "поместите", "выложите", "отправьте", "переложите"])
    : category === "covered_simmer"
      ? new Set(["накройте"])
      : category === "boil"
        ? new Set(["положите", "опустите", "поместите", "добавьте"])
        : new Set(["поставьте", "уберите", "оставьте", "поместите"]);
  return verbs.every((verb) => allowed.has(verb));
}

function durationSeconds(value: string, unit: string): number | null {
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const multiplier = /^(?:секунд|сек\.)/iu.test(unit)
    ? 1
    : /^(?:минут|мин\.)/iu.test(unit)
      ? 60
      : /^(?:час|ч\.)/iu.test(unit)
        ? 3600
        : 0;
  return multiplier ? Math.round(amount * multiplier) : null;
}

/**
 * Returns only a source-explicit timer candidate. It never asserts that an
 * appliance is safe to leave unattended; the caller must request confirmation.
 */
export function backgroundCandidateForAction(text: string, requiredEquipment: string[], sourceSentence = text): BackgroundCandidate | undefined {
  const matches = [...text.matchAll(duration)];
  if (
    matches.length !== 1 ||
    [...sourceSentence.matchAll(duration)].length !== 1 ||
    excludedScope.test(text) ||
    excludedScope.test(sourceSentence) ||
    approximate.test(text) ||
    approximate.test(sourceSentence)
  ) return undefined;
  const match = matches[0];
  const seconds = durationSeconds(match[1], match[3]);
  if (!seconds) return undefined;

  let category: BackgroundCandidateCategory | undefined;
  if (/(?:запекайте|запеките|выпекайте|пеките)/iu.test(text) && requiredEquipment.includes("oven")) category = "oven";
  else if (/(?:накройте|под крышкой)/iu.test(text) && /(?:томите|тушите|готовьте)/iu.test(text)) category = "covered_simmer";
  else if (/(?:варите|сварите|отварите)/iu.test(text) && requiredEquipment.includes("pot") && requiredEquipment.includes("stove")) category = "boil";
  else if (/(?:холодильник|в холодильнике)/iu.test(text) && /(?:оставьте|охладите|охлаждайте|маринуйте)/iu.test(text)) category = "cold_wait";
  if (!category) return undefined;
  const thermalMatch = category === "oven"
    ? /(?:запекайте|запеките|выпекайте|пеките)/iu.exec(text)
    : category === "covered_simmer"
      ? /(?:томите|тушите|готовьте)/iu.exec(text)
      : category === "boil"
        ? /(?:варите|сварите|отварите)/iu.exec(text)
        : /(?:оставьте|охладите|охлаждайте|маринуйте)/iu.exec(text);
  if (!thermalMatch) return undefined;
  const beforeHeat = text.slice(0, thermalMatch.index);
  const afterTimer = text.slice((match.index ?? 0) + match[0].length);
  if (!isOnlyPhysicalStart(beforeHeat, category) || hasIndependentImperative(afterTimer)) return undefined;
  return { durationSeconds: seconds, durationText: match[0], category };
}
