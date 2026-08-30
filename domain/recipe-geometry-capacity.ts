export type RecipeGeometryCapacity = {
  /** Maximum number of Mise base servings that may share one physical run. */
  maxBaseServingsPerRun: number;
  constraint: "baking_form" | "oven_surface" | "pan_surface" | "pot_volume";
  evidence: "source_batch" | "conservative_single_serving";
  sourceServings?: number;
  /** Number of source servings represented by one Mise base serving. */
  miseServingToSourceServingRatio?: number;
};

/**
 * Editorial cookware limits for the current Recipe Families.
 *
 * RecipeFamily ingredient amounts describe one Mise base serving. For an
 * audited source batch, capacity is therefore:
 *
 *   source servings / source servings represented by one Mise serving
 *
 * A value of 1 is used only when the retained evidence proves that one base
 * serving can be cooked but does not establish a larger vessel load. Cold and
 * no-cook recipes intentionally have no entry.
 */
export const RECIPE_GEOMETRY_CAPACITY: Readonly<
  Record<string, RecipeGeometryCapacity>
> = Object.freeze({
  "src-cottage-bake": {
    maxBaseServingsPerRun: 1,
    constraint: "baking_form",
    evidence: "conservative_single_serving",
  },
  "src-chicken-buckwheat": {
    maxBaseServingsPerRun: 1,
    constraint: "pot_volume",
    evidence: "source_batch",
    sourceServings: 1,
  },
  "src-chicken-rice-veg": {
    maxBaseServingsPerRun: 1,
    constraint: "oven_surface",
    evidence: "conservative_single_serving",
  },
  "src-chicken-bean-bowl": {
    maxBaseServingsPerRun: 4,
    constraint: "pan_surface",
    evidence: "source_batch",
    sourceServings: 4,
  },
  "src-salmon-rice-veg": {
    maxBaseServingsPerRun: 3,
    constraint: "oven_surface",
    evidence: "source_batch",
    sourceServings: 3,
  },
  "src-turkey-meatballs": {
    maxBaseServingsPerRun: 1,
    constraint: "pan_surface",
    evidence: "conservative_single_serving",
  },
  "src-taco-mac": {
    maxBaseServingsPerRun: 5,
    constraint: "pot_volume",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-teriyaki-tray": {
    maxBaseServingsPerRun: 5,
    constraint: "oven_surface",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-halal-chicken": {
    maxBaseServingsPerRun: 6,
    constraint: "oven_surface",
    evidence: "source_batch",
    sourceServings: 6,
  },
  "src-crispy-beef-noodles": {
    maxBaseServingsPerRun: 5,
    constraint: "pan_surface",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-mediterranean-wrap": {
    maxBaseServingsPerRun: 6,
    constraint: "oven_surface",
    evidence: "source_batch",
    sourceServings: 6,
  },
  "src-creamy-chicken-pasta": {
    maxBaseServingsPerRun: 5,
    constraint: "baking_form",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-sausage-pepper-pasta": {
    maxBaseServingsPerRun: 5,
    constraint: "pot_volume",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-honey-lime-steak": {
    maxBaseServingsPerRun: 5,
    constraint: "pan_surface",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-light-stroganoff": {
    maxBaseServingsPerRun: 10,
    constraint: "pot_volume",
    evidence: "source_batch",
    sourceServings: 5,
    miseServingToSourceServingRatio: 0.5,
  },
  "src-bbq-burger-bowl": {
    maxBaseServingsPerRun: 5,
    constraint: "oven_surface",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-red-pepper-chicken-dip": {
    maxBaseServingsPerRun: 5,
    constraint: "pot_volume",
    evidence: "source_batch",
    sourceServings: 10,
    miseServingToSourceServingRatio: 2,
  },
  "src-lemon-chicken": {
    maxBaseServingsPerRun: 5,
    constraint: "pan_surface",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-curry-fried-rice": {
    maxBaseServingsPerRun: 5,
    constraint: "pan_surface",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-fajita-rice": {
    maxBaseServingsPerRun: 5,
    constraint: "pan_surface",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-japanese-beef-curry": {
    maxBaseServingsPerRun: 5,
    constraint: "pot_volume",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-gochujang-beef": {
    maxBaseServingsPerRun: 5,
    constraint: "pan_surface",
    evidence: "source_batch",
    sourceServings: 5,
  },
  "src-beefy-cheese-potatoes": {
    maxBaseServingsPerRun: 5,
    constraint: "oven_surface",
    evidence: "source_batch",
    sourceServings: 5,
  },
});

export function geometryLockedMaxForFamily(familyId: string) {
  return RECIPE_GEOMETRY_CAPACITY[familyId]?.maxBaseServingsPerRun;
}
