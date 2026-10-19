/* Снимок оценки усилий и общего времени ready-карточек до разбиения шагов.

   node scripts/build-recipe-effort-baseline.mjs --ref f314660 --output data/recipe-effort-baseline.json

   Берёт data/recipe-runtime-catalog.json из указанного коммита (по умолчанию
   main f314660 — последний выпуск до вычитки шагов 2026-10-19) и записывает
   для каждой карточки `recipes[]` уровень и оценку усилий (`effort` без
   `parallelProcesses`) и `timeMinutes`. КБЖУ и состав не сохраняются: их
   после выпуска меняли другие правки. Снимок читает
   tests/recipe-step-structure.test.mjs: разбиение шагов не должно менять
   оценку, а время — только там, где отличие объяснено в тесте. */
import { execFileSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const EFFORT_BASELINE_FIELDS = Object.freeze([
  "level",
  "activeMinutes",
  "knifeActions",
  "activeActions",
  "cookware",
  "difficulty",
]);

function option(argv, flag, fallback) {
  const position = argv.indexOf(flag);
  if (position < 0) return fallback;
  const value = argv[position + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
  return value;
}

export function buildRecipeEffortBaseline({ ref = "f314660", cwd = process.cwd() } = {}) {
  const commit = execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd, encoding: "utf8" }).trim();
  const catalog = JSON.parse(execFileSync("git", ["show", `${commit}:data/recipe-runtime-catalog.json`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }));
  return {
    schemaVersion: 1,
    about: [
      "Оценка усилий и общее время ready-карточек runtime до разбиения шагов 2026-10-19 (вычитка рецептов).",
      "Сгенерирован scripts/build-recipe-effort-baseline.mjs из data/recipe-runtime-catalog.json указанного коммита; руками не правится.",
      "tests/recipe-step-structure.test.mjs сравнивает с ним текущий runtime: effort совпадает (activeMinutes ±1), timeMinutes — кроме перечисленных в тесте карточек с объяснением.",
    ],
    source: {
      commit,
      path: "data/recipe-runtime-catalog.json",
      command: `node scripts/build-recipe-effort-baseline.mjs --ref ${ref} --output data/recipe-effort-baseline.json`,
    },
    fields: ["timeMinutes", ...EFFORT_BASELINE_FIELDS.map((field) => `effort.${field}`)],
    recipes: catalog.recipes.map((recipe) => ({
      id: recipe.id,
      timeMinutes: recipe.timeMinutes,
      effort: Object.fromEntries(EFFORT_BASELINE_FIELDS.map((field) => [field, recipe.effort[field]])),
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const ref = option(process.argv, "--ref", "f314660");
  const output = option(process.argv, "--output", null);
  const baseline = buildRecipeEffortBaseline({ ref });
  const text = `${JSON.stringify(baseline, null, 2)}\n`;
  if (output) {
    const target = resolve(output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.tmp`, text, "utf8");
    await rename(`${target}.tmp`, target);
  } else {
    process.stdout.write(text);
  }
  process.stderr.write(`${baseline.recipes.length} recipes from ${baseline.source.commit}\n`);
}
