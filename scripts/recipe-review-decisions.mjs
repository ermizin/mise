import { readFile } from "node:fs/promises";

export const RESOLUTION_VERDICTS = Object.freeze(["ready", "review_required", "blocked", "backlog", "excluded"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function emptyResolutions() {
  return { schemaVersion: 1, sourceExport: {}, exclusions: [], backlog: [], resolvedReasons: [], decisions: [] };
}

export function validateRecipeReviewResolutions(value, cards) {
  if (!isObject(value) || value.schemaVersion !== 1) throw new Error("Recipe review resolutions must use schemaVersion 1");
  for (const key of ["sourceExport", "exclusions", "backlog", "resolvedReasons", "decisions"]) {
    if (!(key in value)) throw new Error(`Recipe review resolutions: missing ${key}`);
  }
  if (!isObject(value.sourceExport) || !Array.isArray(value.exclusions) || !Array.isArray(value.backlog) || !Array.isArray(value.resolvedReasons) || !Array.isArray(value.decisions)) {
    throw new Error("Recipe review resolutions have invalid field types");
  }
  const byId = new Map(cards.map((card) => [card.id, card]));
  const excluded = new Set();
  for (const exclusion of value.exclusions) {
    if (!isObject(exclusion) || typeof exclusion.id !== "string" || !byId.has(exclusion.id)) throw new Error("Recipe review exclusion has an unknown recipe id");
    if (excluded.has(exclusion.id)) throw new Error(`Recipe review exclusion is duplicated: ${exclusion.id}`);
    excluded.add(exclusion.id);
  }
  const backlog = new Set();
  for (const item of value.backlog) {
    if (!isObject(item) || typeof item.id !== "string" || !byId.has(item.id)) throw new Error("Recipe review backlog item has an unknown recipe id");
    if (backlog.has(item.id)) throw new Error(`Recipe review backlog item is duplicated: ${item.id}`);
    if (excluded.has(item.id)) throw new Error(`Recipe review card cannot be both excluded and backlogged: ${item.id}`);
    backlog.add(item.id);
  }
  const resolved = new Set();
  for (const item of value.resolvedReasons) {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.gate !== "string" || typeof item.code !== "string" || typeof item.resolution !== "string" || !byId.has(item.id)) {
      throw new Error("Recipe review resolved reason is invalid");
    }
    const key = `${item.id}:${item.gate}:${item.code}`;
    if (resolved.has(key)) throw new Error(`Recipe review resolved reason is duplicated: ${key}`);
    if (!byId.get(item.id).reasons.some((reason) => reason.gate === item.gate && reason.code === item.code)) {
      throw new Error(`Recipe review resolved reason is not present: ${key}`);
    }
    resolved.add(key);
  }
  return value;
}

export async function loadRecipeReviewResolutions(url = new URL("../data/recipe-review-resolutions.json", import.meta.url)) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyResolutions();
    throw error;
  }
}

export function applyRecipeReviewResolutions(report, resolutions) {
  const validated = validateRecipeReviewResolutions(resolutions, report.cards);
  const excluded = new Map(validated.exclusions.map((item) => [item.id, item]));
  const backlog = new Map(validated.backlog.map((item) => [item.id, item]));
  const resolved = new Map(validated.resolvedReasons.map((item) => [`${item.id}:${item.gate}:${item.code}`, item]));
  const cards = report.cards.map((card) => {
    const resolvedReasons = card.reasons.filter((reason) => resolved.has(`${card.id}:${reason.gate}:${reason.code}`)).map((reason) => ({
      ...reason,
      resolution: resolved.get(`${card.id}:${reason.gate}:${reason.code}`).resolution,
    }));
    const reasons = card.reasons.filter((reason) => !resolved.has(`${card.id}:${reason.gate}:${reason.code}`));
    const verdict = excluded.has(card.id)
      ? "excluded"
      : backlog.has(card.id)
        ? "backlog"
      : reasons.some((reason) => reason.severity === "blocked")
        ? "blocked"
        : reasons.some((reason) => reason.severity === "review_required")
          ? "review_required"
          : "ready";
    return { ...card, verdict, reasons, resolvedReasons, backlog: backlog.get(card.id) ?? null, exclusion: excluded.get(card.id) ?? null };
  });
  const counts = Object.fromEntries(RESOLUTION_VERDICTS.map((verdict) => [verdict, cards.filter((card) => card.verdict === verdict).length]));
  const reasonCounts = Object.fromEntries([...new Set(cards.flatMap((card) => card.reasons.map((reason) => `${reason.gate}:${reason.code}`)))].sort().map((key) => [
    key,
    cards.filter((card) => card.reasons.some((reason) => `${reason.gate}:${reason.code}` === key)).length,
  ]));
  return { ...report, total: cards.length, counts, reasonCounts, cards, resolutions: validated };
}
