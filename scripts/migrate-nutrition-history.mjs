import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LEGACY_HEAD = "34cef6ba35d81b991c1c582adeb3501ce5aebb20";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseOccurrence(key) {
  const match = /^([^:]+):(\d{4}-\d{2}-\d{2}):(breakfast|snack1|lunch|snack2|dinner)$/u.exec(key);
  if (!match) return null;
  const [year, month, day] = match[2].split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? { personId: match[1], date: match[2], slot: match[3] }
    : null;
}

function assignmentGroups(plan, batch, slot) {
  const people = Array.isArray(plan.people) ? plan.people : [];
  const eligible = new Set(people
    .filter((person) => isRecord(person) && typeof person.id === "string" && Array.isArray(person.includedSlots) && person.includedSlots.includes(slot))
    .map((person) => person.id));
  const key = `${batch.id}:${slot}`;
  const normalize = (raw) => {
    const assigned = new Set();
    return (Array.isArray(raw) ? raw : []).flatMap((group) => {
      if (!isRecord(group) || typeof group.recipeId !== "string") return [];
      const personIds = (Array.isArray(group.personIds) ? group.personIds : []).filter((id) =>
        typeof id === "string" && eligible.has(id) && !assigned.has(id) && (assigned.add(id), true));
      return personIds.length ? [{ recipeId: group.recipeId, personIds }] : [];
    });
  };
  const explicitRaw = isRecord(plan.selectionAssignments) ? plan.selectionAssignments[key] : undefined;
  const hasExplicitAssignments = Array.isArray(explicitRaw);
  const explicit = normalize(explicitRaw);
  const explicitCovered = new Set(explicit.flatMap((group) => group.personIds)).size === eligible.size;
  const legacyRecipeId = isRecord(plan.selections) ? plan.selections[key] : undefined;
  const legacy = typeof legacyRecipeId === "string"
    ? normalize([{ recipeId: legacyRecipeId, personIds: [...eligible] }])
    : [];
  return hasExplicitAssignments && explicitCovered ? explicit : legacy.length ? legacy : explicit;
}

function sourceForOccurrence(plan, key) {
  const occurrence = parseOccurrence(key);
  if (!occurrence || !isRecord(plan) || !Array.isArray(plan.people) || !Array.isArray(plan.batches)) return null;
  const person = plan.people.find((item) => isRecord(item) && item.id === occurrence.personId);
  if (!person || !Array.isArray(person.includedSlots) || !person.includedSlots.includes(occurrence.slot)) return null;
  const batch = plan.batches.find((item) => isRecord(item) && typeof item.id === "string" && typeof item.start === "string" && typeof item.end === "string" && item.start <= occurrence.date && occurrence.date <= item.end);
  if (!batch || !finiteNonnegative(batch.days) || batch.days < 1) return null;
  const assignment = assignmentGroups(plan, batch, occurrence.slot).find((group) => group.personIds.includes(occurrence.personId));
  return assignment ? { plan, ...occurrence, batch, person, recipeId: assignment.recipeId } : null;
}

function snapshotFor(source, evaluator, capturedAt) {
  const actual = evaluator(source);
  if (!isRecord(actual) || !finiteNonnegative(actual.kcal) || !finiteNonnegative(actual.protein) || !finiteNonnegative(actual.fat) || !finiteNonnegative(actual.carbs)) {
    throw new Error("legacy evaluator returned invalid nutrition");
  }
  return {
    recipeId: source.recipeId,
    actual: { kcal: actual.kcal, protein: actual.protein, fat: actual.fat, carbs: actual.carbs },
    capturedAt,
    calculationVersion: 2,
  };
}

function validSnapshot(snapshot, source, expectedActual) {
  return isRecord(snapshot) && snapshot.recipeId === source.recipeId && snapshot.calculationVersion === 2 &&
    isRecord(snapshot.actual) && ["kcal", "protein", "fat", "carbs"].every((field) => snapshot.actual[field] === expectedActual[field]);
}

/**
 * Pure, injectable SQLite migration core. The evaluator must calculate one
 * occurrence using the frozen legacy catalog; tests provide a small substitute.
 */
export function migrateNutritionHistory({ db, evaluator, dryRun = false, verify = false, capturedAt = Date.now() }) {
  const counts = { changed: 0, skipped: 0, failed: 0 };
  const rows = db.prepare("SELECT id, payload FROM meal_plans").all();
  const run = () => {
    const update = db.prepare("UPDATE meal_plans SET payload = ? WHERE id = ? AND payload = ?");
    for (const row of rows) {
      let plan;
      try {
        plan = JSON.parse(row.payload);
      } catch {
        counts.failed++;
        continue;
      }
      const eaten = isRecord(plan) && isRecord(plan.mealExecution) && Array.isArray(plan.mealExecution.eaten)
        ? plan.mealExecution.eaten.filter((key) => typeof key === "string")
        : [];
      if (!eaten.length) {
        counts.skipped++;
        continue;
      }
      try {
        const history = isRecord(plan.nutritionHistory) ? { ...plan.nutritionHistory } : {};
        let added = false;
        let verificationFailed = false;
        for (const key of new Set(eaten)) {
          const source = sourceForOccurrence(plan, key);
          if (!source) continue;
          const expected = snapshotFor(source, evaluator, capturedAt);
          if (verify) {
            if (!validSnapshot(history[key], source, expected.actual)) verificationFailed = true;
          } else if (!Object.hasOwn(history, key)) {
            history[key] = expected;
            added = true;
          }
        }
        if (verify) {
          if (verificationFailed) counts.failed++;
          else counts.skipped++;
          continue;
        }
        if (!added) {
          counts.skipped++;
          continue;
        }
        if (dryRun) counts.changed++;
        else {
          const nextPayload = JSON.stringify({ ...plan, nutritionHistory: history });
          if (update.run(nextPayload, row.id, row.payload).changes === 1) counts.changed++;
          else counts.failed++;
        }
      } catch {
        counts.failed++;
      }
    }
  };
  if (dryRun || verify) run();
  else {
    db.exec("BEGIN IMMEDIATE");
    try {
      run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return counts;
}

function assertLegacyRoot(legacyRoot) {
  if (!existsSync(legacyRoot)) throw new Error("legacy root is absent");
  const head = execFileSync("git", ["-C", legacyRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirtyTracked = execFileSync("git", ["-C", legacyRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
  if (head !== LEGACY_HEAD || dirtyTracked) throw new Error("legacy root is not the approved clean baseline");
}

async function legacyEvaluator(legacyRoot) {
  const fixtureUrl = pathToFileURL(resolve(legacyRoot, "tests/recipe-session-fixture.mjs")).href;
  const fixture = await import(fixtureUrl);
  const catalog = await fixture.recipeCatalog();
  const recipesById = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));
  return ({ plan, batch, slot, recipeId, person }) => {
    const recipe = recipesById.get(recipeId);
    const assignment = assignmentGroups(plan, batch, slot).find((group) => group.recipeId === recipeId);
    const eaters = (Array.isArray(plan.people) ? plan.people : []).filter((item) => assignment?.personIds.includes(item.id));
    const session = recipe && catalog.recipeCookingSession(eaters, slot, recipe, batch.days, (eater) =>
      isRecord(plan.tuning) ? plan.tuning[`${batch.id}:${slot}:${eater.id}`] : undefined);
    const portion = session?.portions[eaters.findIndex((eater) => eater.id === person.id)];
    if (!portion) throw new Error("legacy portion is unavailable");
    return portion.actual;
  };
}

function parseArgs(args) {
  const options = { db: null, legacyRoot: null, dryRun: true, verify: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--db") options.db = args[++index] ?? null;
    else if (arg === "--legacy-root") options.legacyRoot = args[++index] ?? null;
    else if (arg === "--apply") options.dryRun = false;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--verify") options.verify = true;
    else throw new Error("invalid argument");
  }
  if (!options.db || !options.legacyRoot || (options.verify && !options.dryRun)) throw new Error("missing or conflicting arguments");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const legacyRoot = resolve(options.legacyRoot);
  assertLegacyRoot(legacyRoot);
  const db = new DatabaseSync(resolve(options.db));
  try {
    const counts = migrateNutritionHistory({ db, evaluator: await legacyEvaluator(legacyRoot), dryRun: options.dryRun, verify: options.verify });
    console.log(`changed=${counts.changed} skipped=${counts.skipped} failed=${counts.failed}`);
    if (counts.failed) process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => { process.exitCode = 1; });
}
