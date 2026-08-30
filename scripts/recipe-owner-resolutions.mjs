import { readFile } from "node:fs/promises";

export async function loadOwnerRecipeResolutions() {
  const value = JSON.parse(
    await readFile(new URL("../data/recipe-owner-resolutions.json", import.meta.url), "utf8"),
  );
  if (value.schemaVersion !== 1 || !Array.isArray(value.resolutions)) {
    throw new Error("Owner recipe resolutions use an unsupported schema");
  }
  const keys = new Set();
  for (const resolution of value.resolutions) {
    if (!resolution?.id || !resolution.gate || !resolution.code || !resolution.resolution) {
      throw new Error("Owner recipe resolution is incomplete");
    }
    const key = `${resolution.id}:${resolution.gate}:${resolution.code}`;
    if (keys.has(key)) throw new Error(`Duplicate owner recipe resolution: ${key}`);
    keys.add(key);
  }
  return value;
}

export function applyOwnerRecipeResolutions(report, registry) {
  const byKey = new Map(
    registry.resolutions.map((item) => [`${item.id}:${item.gate}:${item.code}`, item]),
  );
  const cards = report.cards.map((card) => {
    const resolvedReasons = card.reasons
      .filter((reason) => byKey.has(`${card.id}:${reason.gate}:${reason.code}`))
      .map((reason) => ({ ...reason, resolution: byKey.get(`${card.id}:${reason.gate}:${reason.code}`).resolution }));
    const reasons = card.reasons.filter((reason) => !byKey.has(`${card.id}:${reason.gate}:${reason.code}`));
    const verdict = reasons.some((reason) => reason.severity === "blocked")
      ? "blocked"
      : reasons.some((reason) => reason.severity === "review_required")
        ? "review_required"
        : "ready";
    return { ...card, verdict, reasons, resolvedReasons };
  });
  const counts = Object.fromEntries(
    ["ready", "review_required", "blocked"].map((verdict) => [verdict, cards.filter((card) => card.verdict === verdict).length]),
  );
  return { ...report, counts, cards, ownerResolutions: registry };
}
