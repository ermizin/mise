import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPlanRecipeRegistry } from "../scripts/build-plan-recipe-registry.mjs";

const checkedIn = JSON.parse(
  await readFile(new URL("../data/plan-recipe-registry.json", import.meta.url), "utf8"),
);
const simpleSource = JSON.parse(
  await readFile(new URL("../data/simple-recipes.json", import.meta.url), "utf8"),
);
const extensionSource = JSON.parse(
  await readFile(new URL("../data/extension-recipes.json", import.meta.url), "utf8"),
);

test("server recipe registry exactly follows the client production predicate", async () => {
  const rebuilt = await buildPlanRecipeRegistry();
  assert.equal(JSON.stringify(checkedIn), JSON.stringify(rebuilt));
  assert.equal(checkedIn.recipeCount, 349);
  assert.equal(checkedIn.recipes.length, checkedIn.recipeCount);
  const sourceSimpleIds = new Set(simpleSource.recipes.map((recipe) => recipe.id));
  const registrySimpleIds = checkedIn.recipes
    .map((recipe) => recipe.id)
    .filter((id) => sourceSimpleIds.has(id));
  assert.equal(sourceSimpleIds.size, 50, "simple source contains fifty recipes");
  assert.equal(registrySimpleIds.length, 50, "registry includes every simple recipe");
  const registryIds = new Set(checkedIn.recipes.map((recipe) => recipe.id));
  assert.equal(extensionSource.recipes.length, 89, "extension source contains eighty-nine recipes");
  assert.deepEqual(
    extensionSource.recipes.map((recipe) => recipe.id).filter((id) => !registryIds.has(id)),
    [],
    "registry includes every extension recipe, so a vegan or paleo plan can be saved",
  );
  assert.equal(
    checkedIn.recipes.some((recipe) => recipe.id === "src-taco-mac"),
    false,
    "review-required legacy cards cannot be saved through the server",
  );
});

test("every ingredient line with sesame makes the dish a sesame dish for the server", async () => {
  // Приправа «всё и сразу» (everything bagel) — кунжут, мак, чеснок и лук, но
  // слова sesame в названии нет. Хлебцы с авокадо и фасолью проходили с
  // аллергией на кунжут: и автосборка, и сервер видели пустой список аллергенов.
  const runtime = JSON.parse(
    await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"),
  );
  const registryById = new Map(checkedIn.recipes.map((recipe) => [recipe.id, recipe]));
  assert.deepEqual(registryById.get("tmpm-25006-avocado-bean-rice-cakes").allergens, ["sesame"]);
  const sesameWords = /кунжут|тахини|хумус|sesame|tahini|tahina|hummus|everything bagel|furikake|za'?atar|dukkah|gomasio/iu;
  let sesameLines = 0;
  for (const record of [...runtime.recipes, ...runtime.simpleRecipes, ...runtime.extensionRecipes]) {
    for (const line of [...record.shoppingIngredients, ...record.procedureIngredients]) {
      if (!sesameWords.test(`${line.nameRu} ${line.sourceName ?? ""} ${line.canonicalIngredientId ?? ""}`)) continue;
      sesameLines += 1;
      assert.ok(line.allergens?.includes("sesame"), `${record.id}: «${line.nameRu}» carries sesame`);
      assert.ok(registryById.get(record.id)?.allergens.includes("sesame"), `${record.id}: the server refuses it for a sesame allergy`);
    }
  }
  assert.ok(sesameLines >= 14, `${sesameLines} sesame lines`);
});
