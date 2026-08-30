import { readFile } from "node:fs/promises";

export async function loadMealPrepReleasePolicy() {
  const policy = JSON.parse(await readFile(new URL("../data/mealprep-release-policy.json", import.meta.url), "utf8"));
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.labelProfiles?.canonicalIds) || !policy.servingAdaptations) throw new Error("Invalid Meal Prep release policy");
  return { ...policy, labelProfiles: { ...policy.labelProfiles, canonicalIds: new Set(policy.labelProfiles.canonicalIds) } };
}

export function hasDocumentedLocalization(candidate) {
  const localization = candidate.localization ?? {};
  return typeof localization.reviewNote === "string" && localization.reviewNote.trim().length >= 12
    && (localization.excludeSuggested === false || typeof localization.miseAvailabilityDecision === "string");
}
