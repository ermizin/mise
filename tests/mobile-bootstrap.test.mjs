import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildMobileBootstrap } from "../domain/mobile.ts";
const catalog = JSON.parse(await readFile(new URL("../data/recipe-runtime-catalog.json", import.meta.url), "utf8"));
const audit = JSON.parse(await readFile(new URL("../data/recipe-release-audit.json", import.meta.url), "utf8"));
const manifest = JSON.parse(await readFile(new URL("../data/recipe-image-manifest.json", import.meta.url), "utf8"));
const simpleManifest = JSON.parse(await readFile(new URL("../data/simple-recipe-images.json", import.meta.url), "utf8"));
const bootstrap = buildMobileBootstrap(catalog, audit, simpleManifest);

test("mobile bootstrap has a versioned, bounded release contract", () => {
  assert.equal(bootstrap.schemaVersion, 2);
  assert.equal(bootstrap.catalogSchemaVersion, catalog.schemaVersion);
  assert.deepEqual(bootstrap.capabilities, {
    catalog: true,
    planGeneration: true,
    offlinePlanGeneration: true,
  });
  assert.deepEqual(bootstrap.limits.periodDays, { min: 1, max: 14 });
  assert.deepEqual(bootstrap.limits.people, { min: 1, max: 4 });
  assert.deepEqual(bootstrap.limits.menuStyles, ["simple", "protein", "budget"]);
  assert.deepEqual(bootstrap.limits.kitchenEquipment, ["stove", "pot", "pan", "oven", "baking_dish", "multicooker", "air_fryer", "blender", "microwave", "waffle_iron", "pressure_cooker"]);
  assert.deepEqual(bootstrap.limits.mealSlots, ["breakfast", "lunch", "dinner", "snack1", "snack2"]);
  assert.throws(() => buildMobileBootstrap({ ...catalog, schemaVersion: 2 }, audit, simpleManifest), /Unsupported/);
  assert.throws(() => buildMobileBootstrap(catalog, { ...audit, schemaVersion: 2 }, simpleManifest), /Unsupported/);
  assert.throws(() => buildMobileBootstrap(catalog, audit, { ...simpleManifest, schemaVersion: 2 }), /Unsupported/);
});

test("mobile recipes are only audit-ready cards with production-eligible families", () => {
  const readyIds = new Set(audit.cards.filter((card) => card.verdict === "ready").map((card) => card.id));
  const eligibleCoreIds = catalog.recipes
    .filter((recipe) => recipe.recipeFamily.reviewStatus === "pilot" && recipe.recipeFamily.ingredients.length >= 3)
    .map((recipe) => recipe.id)
    .sort();
  const eligibleSimpleIds = catalog.simpleRecipes
    .filter((recipe) => recipe.recipeFamily.reviewStatus === "pilot" && recipe.recipeFamily.ingredients.length >= 3)
    .map((recipe) => recipe.id)
    .sort();
  const mobileIds = bootstrap.recipes.map((recipe) => recipe.id).sort();
  assert.deepEqual(mobileIds, [...eligibleCoreIds, ...eligibleSimpleIds].sort());
  assert.ok(eligibleCoreIds.every((id) => readyIds.has(id)));
  assert.ok(eligibleSimpleIds.every((id) => simpleManifest.images.some((image) => image.id === id)));
  assert.equal(bootstrap.recipes.length, 250);
  assert.equal(new Set(mobileIds).size, mobileIds.length);

  const rejected = catalog.recipes[0];
  const withRejected = {
    ...catalog,
    recipes: [
      ...catalog.recipes,
      { ...rejected, id: "unreviewed-test", recipeFamily: { ...rejected.recipeFamily, reviewStatus: "review_required" } },
      { ...rejected, id: "remote-photo-test", provenance: { ...rejected.provenance, preview: { ...rejected.provenance.preview, imageUrl: "https://example.com/photo.jpg" } } },
      { ...rejected, id: "absent-from-audit-test" },
    ],
  };
  assert.equal(buildMobileBootstrap(withRejected, audit, simpleManifest).recipes.length, bootstrap.recipes.length);
});

test("mobile photo references are local and retain attribution and integrity metadata", () => {
  const manifestById = new Map([...manifest.images, ...simpleManifest.images].map((image) => [image.id, image]));
  for (const recipe of bootstrap.recipes) {
    const photo = manifestById.get(recipe.id);
    assert.ok(photo, recipe.id);
    assert.equal(recipe.photo.path, photo.localPath);
    assert.equal(recipe.photo.sha256, photo.sha256);
    if (photo.contentType) assert.equal(recipe.photo.contentType, photo.contentType);
    assert.ok(recipe.photo.attribution);
    assert.equal(recipe.photo.sourceUrl, photo.sourceUrl ?? "");
    assert.match(recipe.photo.path, /^\/recipe-images\/[a-z0-9-]+\.(?:jpg|png|webp|avif)$/u);
    if (photo.sourceImageUrl) assert.ok(!JSON.stringify(recipe).includes(photo.sourceImageUrl), `${recipe.id}: remote image URL is not in the mobile payload`);
  }
  assert.equal(bootstrap.recipes.filter((recipe) => recipe.photo.origin === "generated").length, 25);
});

test("mobile projection exposes only the minimal offline solver input", () => {
  const recipe = bootstrap.recipes[0];
  assert.deepEqual(Object.keys(recipe).sort(), ["costTier", "effort", "equipmentOptions", "id", "ingredients", "instructions", "macros", "menuTags", "packing", "photo", "servingMass", "slot", "solver", "steps", "storage", "timeMinutes", "title"].sort());
  assert.ok(recipe.equipmentOptions.some((method) => method.id === "original"));
  assert.equal(recipe.recipeFamily, undefined);
  assert.equal(recipe.adapter, undefined);
  assert.equal(recipe.provenance, undefined);
  assert.deepEqual(
    Object.keys(recipe.solver).sort(),
    ["geometryLockedMax", "id", "ingredients", "maxViableCalories", "minimumProtein", "minViableCalories"].filter((key) => key !== "geometryLockedMax" || recipe.solver.geometryLockedMax !== undefined).sort(),
  );
  assert.equal(recipe.solver.editorialAudit, undefined);
  assert.equal(recipe.solver.provenance, undefined);
  assert.equal(recipe.solver.storage, undefined);
  assert.ok(recipe.ingredients.every((ingredient) => ingredient.baseAmount > 0));
});
