import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const { RECIPE_GEOMETRY_CAPACITY, geometryLockedMaxForFamily } =
  await loadTypeScriptModule(
    new URL("../domain/recipe-geometry-capacity.ts", import.meta.url),
  );
const { familyGeometryLimits } = await loadTypeScriptModule(
  new URL("../domain/recipe-engine.ts", import.meta.url),
);

test("the capacity manifest stores limits in Mise base servings", () => {
  assert.equal(geometryLockedMaxForFamily("src-taco-mac"), 5);
  assert.equal(geometryLockedMaxForFamily("src-halal-chicken"), 6);
  assert.equal(geometryLockedMaxForFamily("src-light-stroganoff"), 10);
  assert.equal(geometryLockedMaxForFamily("src-red-pepper-chicken-dip"), 5);
  assert.equal(geometryLockedMaxForFamily("src-protein-oats"), undefined);
});

test("source-serving ratios reproduce every audited source-batch limit", () => {
  for (const [id, capacity] of Object.entries(RECIPE_GEOMETRY_CAPACITY)) {
    assert.ok(capacity.maxBaseServingsPerRun > 0, `${id}: positive capacity`);
    if (capacity.evidence !== "source_batch" || !capacity.sourceServings)
      continue;
    const ratio = capacity.miseServingToSourceServingRatio ?? 1;
    assert.equal(
      capacity.maxBaseServingsPerRun,
      capacity.sourceServings / ratio,
      `${id}: source servings converted to Mise base servings`,
    );
  }
});

test("the standalone evidence manifest and live engine limits cannot drift", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(familyGeometryLimits)),
    Object.fromEntries(
      Object.entries(RECIPE_GEOMETRY_CAPACITY).map(([id, capacity]) => [
        id,
        capacity.maxBaseServingsPerRun,
      ]),
    ),
  );
});
