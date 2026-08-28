export type RecipeIngredientRole =
  | "protein"
  | "carb"
  | "vegetable"
  | "fat"
  | "sauce"
  | "flavour"
  | "flavour_fixed"
  | "garnish";

export type RecipeUnit = "g" | "ml" | "piece";

export type Nutrition = {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

export type RawRecipeCandidate = {
  id: string;
  publisher: string;
  sourceTitle: string;
  sourceUrl: string;
  accessedAt: string;
  imageUrl?: string;
  servings?: number;
  sourceIngredients: unknown[];
  sourceNutrition: Nutrition;
  sourceTimes: Record<string, number | undefined>;
  instructionFacts: RecipeInstruction[];
  paraphrasedInstructionDraft: RecipeInstruction[];
  localization: Record<string, unknown>;
  editorial: { legacyStatus: string; reviewStatus: "pending" | "promoted" };
  legacy: Record<string, unknown>;
};

export type NormalizedRecipeDraft = RawRecipeCandidate & {
  canonicalIngredientIds: (string | null)[];
  normalizationStatus: "ready_for_editorial" | "ingredient_review_required" | "instructions_required";
};

export type CanonicalIngredient = {
  id: string;
  canonicalName: string;
  aliases: string[];
  category: string;
  state: "raw" | "cooked" | "processed";
  nutritionPer100g: Nutrition;
  allergens: string[];
  unit: { sensibleUnit: RecipeUnit; gramsPerUnit: number; roundTo: number };
  reference: { provider: string; checkedAt: string; note: string };
};

export type RecipeFamilyIngredient = {
  sourceIngredientId: string;
  canonicalIngredientId: string;
  baseAmount: number;
  unit: RecipeUnit;
  role: RecipeIngredientRole;
  minAmount: number;
  preferredMin: number;
  preferredMax: number;
  maxAmount: number;
  scalable: boolean;
  scalingPriority: number;
  substitutions: string[];
  optional: boolean;
  preparation?: string;
};

export type RecipeInstruction = {
  id: string;
  text: string;
  ingredientIds: string[];
  action?: string;
  temperature?: string;
  duration?: string;
  equipment?: string[];
  donenessCue?: string;
  dependsOn?: string[];
};

export type RecipeFamily = {
  id: string;
  title: string;
  mealSlots: string[];
  provenance: Record<string, unknown>;
  image: {
    imageUrl?: string;
    source?: string;
    sourceUrl?: string;
    usageStatus: "reference_only" | "licensed" | "owned" | "unknown";
    attribution?: string;
    license?: string;
    fetchedAt?: string;
    confidenceMatch: number;
    manuallyApproved: boolean;
    photoType: "source" | "licensed" | "stock" | "fallback";
  };
  ingredients: RecipeFamilyIngredient[];
  minViableCalories: number;
  maxViableCalories: number;
  minimumProtein: number;
  sourceNutrition: Nutrition;
  miseCalculatedNutrition: Nutrition;
  nutritionDeltaKcal: number;
  miseInstructions: RecipeInstruction[];
  storage: Record<string, unknown>;
  freezing: { freezable: boolean; storageDays: number };
  complexity: Record<string, unknown>;
  activeTime: number;
  totalTime: number;
  equipment: string[];
  localization: Record<string, unknown>;
  substitutions: Record<string, string[]>;
  reviewStatus: "pilot" | "review_required";
};

export type SolvedRecipeVariant = {
  familyId: string;
  targetCalories: number;
  targetProtein?: number;
  amounts: Record<string, number>;
  nutrition: Nutrition;
  viable: boolean;
  reason?: "outside_calorie_range" | "hard_exclusion" | "constraints_unsatisfied";
  explanation: string[];
};

type LegacyIngredient = {
  id: string;
  name: string;
  quantity: number;
  unit: "г" | "мл" | "шт.";
};

export type LegacyRecipeForEngine = {
  id: string;
  title: string;
  slot: string;
  time: number;
  macros: Nutrition;
  ingredients: LegacyIngredient[];
  steps: string[];
  storageDays: number;
  freezable: boolean;
  provenance: Record<string, unknown> & { imageUrl?: string; sourceUrl?: string; sourceTitle?: string };
  storage: Record<string, unknown>;
  effort: Record<string, unknown> & { activeMinutes?: number };
  localization: Record<string, unknown>;
};

const checkedAt = "2026-08-29";
const reference = {
  provider: "Mise canonical food reference v1",
  checkedAt,
  note: "Ориентировочные значения на 100 г; конкретная упаковка может отличаться.",
};

type IngredientSeed = [string, string, string, CanonicalIngredient["state"], Nutrition, number?, string[]?];
const n = (kcal: number, protein: number, fat: number, carbs: number): Nutrition => ({ kcal, protein, fat, carbs });
const ingredientSeeds: IngredientSeed[] = [
  ["bbq-sauce", "Соус BBQ", "sauce", "processed", n(150, 0.8, 0.5, 36)],
  ["beef", "Говядина постная", "meat", "raw", n(170, 26, 7, 0)],
  ["beef-mince", "Говяжий фарш", "meat", "raw", n(215, 26, 12, 0)],
  ["berries", "Ягоды", "fruit", "raw", n(45, 0.8, 0.4, 10)],
  ["black-beans", "Фасоль чёрная", "legume", "cooked", n(132, 8.9, 0.5, 23.7)],
  ["broccoli", "Брокколи", "vegetable", "raw", n(34, 2.8, 0.4, 6.6)],
  ["broth", "Бульон", "sauce", "processed", n(6, 0.5, 0.2, 0.4)],
  ["buckwheat", "Гречка сухая", "grain", "raw", n(343, 13.3, 3.4, 71.5)],
  ["cabbage", "Капуста", "vegetable", "raw", n(25, 1.3, 0.1, 5.8)],
  ["carrot", "Морковь", "vegetable", "raw", n(41, 0.9, 0.2, 9.6), 80],
  ["cauliflower", "Цветная капуста", "vegetable", "raw", n(25, 1.9, 0.3, 5)],
  ["cheese", "Полутвёрдый сыр", "dairy", "processed", n(356, 25, 27, 2), 1, ["milk"]],
  ["chicken", "Куриная грудка", "meat", "raw", n(120, 22.5, 2.6, 0)],
  ["chicken-thigh", "Куриное бедро без кожи", "meat", "raw", n(144, 19.7, 7, 0)],
  ["corn", "Кукуруза", "vegetable", "cooked", n(86, 3.3, 1.4, 19)],
  ["cottage", "Творог 5%", "dairy", "processed", n(121, 17, 5, 3), 1, ["milk"]],
  ["cream", "Сливки", "dairy", "processed", n(206, 2.5, 20, 4), 1, ["milk"]],
  ["cream-cheese", "Творожный сыр", "dairy", "processed", n(225, 6, 21, 4), 1, ["milk"]],
  ["cucumber", "Огурец", "vegetable", "raw", n(15, 0.7, 0.1, 3.6), 200],
  ["egg", "Куриное яйцо", "egg", "raw", n(143, 12.6, 9.5, 0.7), 50, ["egg"]],
  ["feta", "Фета", "dairy", "processed", n(264, 14.2, 21.3, 4.1), 1, ["milk"]],
  ["gochujang", "Паста кочудян", "sauce", "processed", n(210, 5, 3, 43), 1, ["soy", "gluten"]],
  ["greens", "Зелень", "vegetable", "raw", n(30, 3, 0.5, 4)],
  ["honey", "Мёд", "sweetener", "processed", n(304, 0.3, 0, 82)],
  ["hot-sauce", "Острый соус", "sauce", "processed", n(20, 1, 0.5, 4)],
  ["hummus", "Хумус", "legume", "processed", n(166, 7.9, 9.6, 14.3), 1, ["sesame"]],
  ["lettuce", "Салат", "vegetable", "raw", n(15, 1.4, 0.2, 2.9)],
  ["lime", "Лайм", "fruit", "raw", n(30, 0.7, 0.2, 10.5), 70],
  ["mayonnaise", "Майонез", "fat", "processed", n(680, 1, 75, 0.6), 1, ["egg"]],
  ["milk", "Молоко 2,5%", "dairy", "processed", n(52, 3, 2.5, 4.8), 1, ["milk"]],
  ["mushrooms", "Шампиньоны", "vegetable", "raw", n(22, 3.1, 0.3, 3.3)],
  ["oats", "Овсяные хлопья", "grain", "raw", n(379, 13.2, 6.5, 67.7), 1, ["gluten"]],
  ["onion", "Репчатый лук", "vegetable", "raw", n(40, 1.1, 0.1, 9.3), 110],
  ["parmesan", "Пармезан", "dairy", "processed", n(431, 38, 29, 4), 1, ["milk"]],
  ["pasta", "Макароны сухие", "grain", "raw", n(350, 12.5, 1.5, 72), 1, ["gluten"]],
  ["peas", "Зелёный горошек", "legume", "cooked", n(81, 5.4, 0.4, 14.5)],
  ["pepper", "Сладкий перец", "vegetable", "raw", n(31, 1, 0.3, 6), 150],
  ["pickles", "Маринованные огурцы", "vegetable", "processed", n(12, 0.5, 0.3, 2.4)],
  ["pork-mince", "Свиной фарш", "meat", "raw", n(242, 27, 14, 0)],
  ["potato", "Картофель", "vegetable", "raw", n(77, 2, 0.1, 17)],
  ["pumpkin", "Тыква", "vegetable", "raw", n(26, 1, 0.1, 6.5)],
  ["red-beans", "Красная фасоль", "legume", "cooked", n(127, 8.7, 0.5, 22.8)],
  ["rice", "Рис сухой", "grain", "raw", n(365, 7.1, 0.7, 80)],
  ["roasted-pepper", "Запечённый перец", "vegetable", "cooked", n(31, 1, 0.3, 6)],
  ["salmon", "Лосось", "fish", "raw", n(208, 20, 13, 0), 1, ["fish"]],
  ["salsa", "Томатная сальса", "sauce", "processed", n(36, 1.5, 0.2, 7)],
  ["soy", "Соевый соус", "sauce", "processed", n(53, 8.1, 0.6, 4.9), 1, ["soy", "gluten"]],
  ["spinach", "Шпинат", "vegetable", "raw", n(23, 2.9, 0.4, 3.6)],
  ["sweet-potato", "Батат", "vegetable", "raw", n(86, 1.6, 0.1, 20)],
  ["tomato", "Томат", "vegetable", "raw", n(18, 0.9, 0.2, 3.9), 120],
  ["tomato-passata", "Протёртые томаты", "vegetable", "processed", n(29, 1.4, 0.2, 4.8)],
  ["tomato-paste", "Томатная паста", "sauce", "processed", n(82, 4.3, 0.5, 19)],
  ["tortilla", "Пшеничная тортилья", "grain", "processed", n(312, 8, 8.3, 52), 60, ["gluten"]],
  ["turkey-mince", "Фарш индейки", "meat", "raw", n(170, 22, 8, 0)],
  ["yogurt", "Греческий йогурт", "dairy", "processed", n(73, 9, 2, 4), 1, ["milk"]],
  ["zucchini", "Кабачок", "vegetable", "raw", n(17, 1.2, 0.3, 3.1)],
];

export const canonicalIngredients: Record<string, CanonicalIngredient> = Object.fromEntries(
  ingredientSeeds.map(([legacyId, name, category, state, nutrition, gramsPerUnit = 1, allergens = []]) => {
    const id = `${legacyId.replaceAll("-", "_")}_${state}`;
    return [id, {
      id,
      canonicalName: name,
      aliases: [legacyId, name.toLowerCase()],
      category,
      state,
      nutritionPer100g: nutrition,
      allergens,
      unit: { sensibleUnit: gramsPerUnit > 1 ? "piece" : "g", gramsPerUnit, roundTo: gramsPerUnit > 1 ? 0.1 : 5 },
      reference,
    } satisfies CanonicalIngredient];
  }),
);

const canonicalByAlias = new Map<string, CanonicalIngredient>();
for (const item of Object.values(canonicalIngredients)) for (const alias of item.aliases) canonicalByAlias.set(alias, item);

export function normalizeRawRecipeCandidate(
  candidate: Record<string, unknown> & { id: string; sourceTitle?: string; title?: string; sourceUrl: string },
  context: { publisher: string; accessedAt: string },
): NormalizedRecipeDraft {
  const sourceIngredients = Array.isArray(candidate.sourceIngredients)
    ? candidate.sourceIngredients
    : Array.isArray(candidate.ingredients) ? candidate.ingredients : [];
  const legacyNutrition = (candidate.sourceNutrition ?? candidate.macros ?? {}) as Partial<Nutrition>;
  const sourceNutrition = {
    kcal: Number(legacyNutrition.kcal ?? 0),
    protein: Number(legacyNutrition.protein ?? 0),
    fat: Number(legacyNutrition.fat ?? 0),
    carbs: Number(legacyNutrition.carbs ?? 0),
  };
  const sourceTimes = (candidate.sourceTimes ?? candidate.time ?? {}) as Record<string, number | undefined>;
  const instructionFacts = Array.isArray(candidate.instructionFacts) ? candidate.instructionFacts as RecipeInstruction[] : [];
  const paraphrasedInstructionDraft = Array.isArray(candidate.paraphrasedInstructionDraft) ? candidate.paraphrasedInstructionDraft as RecipeInstruction[] : [];
  const canonicalIngredientIds = sourceIngredients.map((value) => {
    const ingredient = value as { id?: string; name?: string };
    return canonicalByAlias.get(ingredient.id ?? "")?.id ?? canonicalByAlias.get(String(ingredient.name ?? "").toLowerCase())?.id ?? null;
  });
  const legacyStatus = String(candidate.editorialStatus ?? "pending");
  const raw: RawRecipeCandidate = {
    id: candidate.id,
    publisher: context.publisher,
    sourceTitle: String(candidate.sourceTitle ?? candidate.title ?? ""),
    sourceUrl: candidate.sourceUrl,
    accessedAt: context.accessedAt,
    imageUrl: typeof candidate.imageUrl === "string" ? candidate.imageUrl : undefined,
    servings: Number.isFinite(Number(candidate.servings)) ? Number(candidate.servings) : undefined,
    sourceIngredients,
    sourceNutrition,
    sourceTimes,
    instructionFacts,
    paraphrasedInstructionDraft,
    localization: (candidate.localization ?? {}) as Record<string, unknown>,
    editorial: { legacyStatus, reviewStatus: legacyStatus === "promoted" ? "promoted" : "pending" },
    legacy: candidate,
  };
  return {
    ...raw,
    canonicalIngredientIds,
    normalizationStatus: canonicalIngredientIds.some((id) => !id)
      ? "ingredient_review_required"
      : instructionFacts.length || paraphrasedInstructionDraft.length
        ? "ready_for_editorial"
        : "instructions_required",
  };
}

export const PILOT_RECIPE_IDS = [
  "src-cottage-bake", "src-protein-oats", "src-chicken-buckwheat", "src-chicken-rice-veg",
  "src-chicken-bean-bowl", "src-salmon-rice-veg", "src-turkey-meatballs", "src-taco-mac",
  "src-teriyaki-tray", "src-halal-chicken", "src-crispy-beef-noodles", "src-mediterranean-wrap",
  "src-creamy-chicken-pasta", "src-light-stroganoff", "src-bbq-burger-bowl", "src-red-pepper-chicken-dip",
  "src-sausage-pepper-pasta", "src-honey-lime-steak",
] as const;
const pilotIds = new Set<string>(PILOT_RECIPE_IDS);

const roleSets: Record<RecipeIngredientRole, Set<string>> = {
  protein: new Set(["beef", "beef-mince", "chicken", "chicken-thigh", "pork-mince", "salmon", "turkey-mince", "cottage"]),
  carb: new Set(["black-beans", "buckwheat", "corn", "oats", "pasta", "peas", "potato", "red-beans", "rice", "sweet-potato", "tortilla"]),
  vegetable: new Set(["berries", "broccoli", "cabbage", "carrot", "cauliflower", "cucumber", "lettuce", "mushrooms", "onion", "pepper", "pumpkin", "roasted-pepper", "spinach", "tomato", "zucchini"]),
  fat: new Set(["cheese", "cream", "cream-cheese", "feta", "mayonnaise", "parmesan"]),
  sauce: new Set(["bbq-sauce", "gochujang", "honey", "hummus", "milk", "salsa", "tomato-passata", "tomato-paste", "yogurt"]),
  flavour: new Set(["broth", "hot-sauce", "soy"]),
  flavour_fixed: new Set(["lime"]),
  garnish: new Set(["greens", "pickles"]),
};

function roleFor(id: string): RecipeIngredientRole {
  for (const [role, ids] of Object.entries(roleSets) as [RecipeIngredientRole, Set<string>][]) if (ids.has(id)) return role;
  return "flavour";
}

function unitFor(unit: LegacyIngredient["unit"]): RecipeUnit {
  return unit === "мл" ? "ml" : unit === "шт." ? "piece" : "g";
}

function bounds(base: number, role: RecipeIngredientRole) {
  const ratios: Record<RecipeIngredientRole, [number, number, number, number, boolean, number]> = {
    protein: [0.72, 0.9, 1.15, 1.45, true, 2],
    carb: [0.35, 0.75, 1.25, 2.1, true, 1],
    vegetable: [0.8, 0.95, 1.2, 1.45, true, 5],
    fat: [0.25, 0.65, 1.2, 1.8, true, 1],
    sauce: [0.5, 0.8, 1.25, 1.6, true, 3],
    flavour: [0.75, 0.9, 1.15, 1.3, true, 6],
    flavour_fixed: [1, 1, 1, 1, false, 9],
    garnish: [0.8, 1, 1.2, 1.4, true, 7],
  };
  const [min, preferredMin, preferredMax, max, scalable, scalingPriority] = ratios[role];
  return { minAmount: base * min, preferredMin: base * preferredMin, preferredMax: base * preferredMax, maxAmount: base * max, scalable, scalingPriority };
}

function round(value: number, digits = 1) { const m = 10 ** digits; return Math.round(value * m) / m; }

function nutritionForAmount(ingredient: RecipeFamilyIngredient, amount: number): Nutrition {
  const canonical = canonicalIngredients[ingredient.canonicalIngredientId];
  const grams = amount * (ingredient.unit === "piece" ? canonical.unit.gramsPerUnit : 1);
  const factor = grams / 100;
  return {
    kcal: canonical.nutritionPer100g.kcal * factor,
    protein: canonical.nutritionPer100g.protein * factor,
    fat: canonical.nutritionPer100g.fat * factor,
    carbs: canonical.nutritionPer100g.carbs * factor,
  };
}

export function nutritionForFamily(family: Pick<RecipeFamily, "ingredients">, amounts?: Record<string, number>): Nutrition {
  const result = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const ingredient of family.ingredients) {
    const nutrition = nutritionForAmount(ingredient, amounts?.[ingredient.sourceIngredientId] ?? ingredient.baseAmount);
    for (const key of Object.keys(result) as (keyof Nutrition)[]) result[key] += nutrition[key];
  }
  return { kcal: round(result.kcal), protein: round(result.protein), fat: round(result.fat), carbs: round(result.carbs) };
}

function parameterizedInstructions(recipe: LegacyRecipeForEngine): RecipeInstruction[] {
  const names = recipe.ingredients.map((item) => [item.id, item.name.toLowerCase()] as const);
  return recipe.steps.map((source, index) => {
    const ingredientIds = index === 0 ? recipe.ingredients.map((item) => item.id) : names.filter(([, name]) => source.toLowerCase().includes(name)).map(([id]) => id);
    const text = index === 0
      ? "Отмерьте рассчитанные Mise количества ингредиентов, указанные для этой порции или всей партии."
      : source.replace(/\b\d+(?:[.,]\d+)?\s*(?:г|мл|шт\.?)(?!\p{L})/giu, "рассчитанное количество");
    return { id: `step-${index + 1}`, text, ingredientIds, dependsOn: index ? [`step-${index}`] : [] };
  });
}

export function recipeToFamily(recipe: LegacyRecipeForEngine): RecipeFamily | null {
  if (!pilotIds.has(recipe.id)) return null;
  const ingredients: RecipeFamilyIngredient[] = [];
  for (const ingredient of recipe.ingredients) {
    const canonical = canonicalByAlias.get(ingredient.id);
    if (!canonical) return null;
    const role = roleFor(ingredient.id);
    ingredients.push({
      sourceIngredientId: ingredient.id,
      canonicalIngredientId: canonical.id,
      baseAmount: ingredient.quantity,
      unit: unitFor(ingredient.unit),
      role,
      ...bounds(ingredient.quantity, role),
      substitutions: [],
      optional: role === "garnish",
    });
  }
  const calculated = nutritionForFamily({ ingredients });
  const sourceUrl = typeof recipe.provenance.sourceUrl === "string" ? recipe.provenance.sourceUrl : undefined;
  const imageUrl = typeof recipe.provenance.imageUrl === "string" ? recipe.provenance.imageUrl : undefined;
  const mealLike = recipe.slot === "lunch" || recipe.slot === "dinner";
  return {
    id: recipe.id,
    title: recipe.title,
    mealSlots: [recipe.slot],
    provenance: recipe.provenance,
    image: { imageUrl, source: recipe.provenance.sourceTitle, sourceUrl, usageStatus: imageUrl ? "reference_only" : "unknown", license: undefined, fetchedAt: undefined, confidenceMatch: imageUrl ? 1 : 0, manuallyApproved: Boolean(imageUrl), photoType: imageUrl ? "source" : "fallback" },
    ingredients,
    minViableCalories: mealLike ? 400 : Math.max(180, Math.floor(calculated.kcal * 0.72 / 10) * 10),
    maxViableCalories: mealLike ? 780 : Math.ceil(calculated.kcal * 1.45 / 10) * 10,
    minimumProtein: mealLike ? Math.min(35, Math.max(24, Math.floor(recipe.macros.protein * 0.68))) : Math.max(16, Math.floor(recipe.macros.protein * 0.65)),
    sourceNutrition: recipe.macros,
    miseCalculatedNutrition: calculated,
    nutritionDeltaKcal: round(calculated.kcal - recipe.macros.kcal),
    miseInstructions: parameterizedInstructions(recipe),
    storage: recipe.storage,
    freezing: { freezable: recipe.freezable, storageDays: recipe.storageDays },
    complexity: recipe.effort,
    activeTime: Number(recipe.effort.activeMinutes ?? recipe.time),
    totalTime: recipe.time,
    equipment: [...new Set(recipe.steps.flatMap((step) => [
      /духовк|запек/i.test(step) ? "духовка" : "",
      /сковород|обжар/i.test(step) ? "сковорода" : "",
      /кастрюл|варить/i.test(step) ? "кастрюля" : "",
      /блендер/i.test(step) ? "блендер" : "",
    ]).filter(Boolean))],
    localization: recipe.localization,
    substitutions: {},
    reviewStatus: Math.abs(calculated.kcal - recipe.macros.kcal) > Math.max(100, recipe.macros.kcal * 0.2) ? "review_required" : "pilot",
  };
}

function normalizedAmount(ingredient: RecipeFamilyIngredient, value: number) {
  const step = ingredient.unit === "piece" ? 0.1 : 1;
  return round(Math.max(ingredient.minAmount, Math.min(ingredient.maxAmount, Math.round(value / step) * step)), ingredient.unit === "piece" ? 1 : 0);
}

function objective(family: RecipeFamily, amounts: Record<string, number>, targetCalories: number, targetProtein?: number) {
  const nutrition = nutritionForFamily(family, amounts);
  const proteinFloor = Math.max(family.minimumProtein, targetProtein ?? 0);
  const shortfall = Math.max(0, proteinFloor - nutrition.protein);
  const proteinError = targetProtein ? Math.abs(targetProtein - nutrition.protein) : 0;
  const deviation = family.ingredients.reduce((sum, ingredient) => {
    const center = (ingredient.preferredMin + ingredient.preferredMax) / 2;
    return sum + Math.abs((amounts[ingredient.sourceIngredientId] - center) / Math.max(1, ingredient.baseAmount)) / Math.max(1, ingredient.scalingPriority);
  }, 0);
  return Math.abs(targetCalories - nutrition.kcal) * 10 + shortfall * 150 + proteinError * 2 + deviation;
}

function hillClimb(family: RecipeFamily, seed: "min" | "base" | "preferred", targetCalories: number, targetProtein?: number) {
  const amounts = Object.fromEntries(family.ingredients.map((ingredient) => {
    const value = seed === "min" ? ingredient.minAmount : seed === "preferred" ? (ingredient.preferredMin + ingredient.preferredMax) / 2 : ingredient.baseAmount;
    return [ingredient.sourceIngredientId, normalizedAmount(ingredient, value)];
  }));
  let score = objective(family, amounts, targetCalories, targetProtein);
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    let best: { id: string; amount: number; score: number } | null = null;
    for (const ingredient of family.ingredients) {
      if (!ingredient.scalable) continue;
      const id = ingredient.sourceIngredientId;
      const step = ingredient.unit === "piece" ? 0.1 : Math.max(1, canonicalIngredients[ingredient.canonicalIngredientId].unit.roundTo);
      for (const direction of [-1, 1]) {
        const next = normalizedAmount(ingredient, amounts[id] + direction * step);
        if (next === amounts[id]) continue;
        const candidate = { ...amounts, [id]: next };
        const nextScore = objective(family, candidate, targetCalories, targetProtein);
        if (nextScore + 0.0001 < (best?.score ?? score)) best = { id, amount: next, score: nextScore };
      }
    }
    if (!best) break;
    amounts[best.id] = best.amount;
    score = best.score;
  }
  return { amounts, nutrition: nutritionForFamily(family, amounts), score };
}

export function solveRecipeFamily(family: RecipeFamily, input: { targetCalories: number; targetProtein?: number; hardExclusions?: string[] }): SolvedRecipeVariant {
  const targetCalories = Math.round(input.targetCalories);
  if (targetCalories < family.minViableCalories || targetCalories > family.maxViableCalories) return { familyId: family.id, targetCalories, targetProtein: input.targetProtein, amounts: {}, nutrition: n(0, 0, 0, 0), viable: false, reason: "outside_calorie_range", explanation: [`Цель ${targetCalories} ккал вне рабочего диапазона ${family.minViableCalories}–${family.maxViableCalories} ккал.`] };
  const exclusions = new Set(input.hardExclusions ?? []);
  const conflict = family.ingredients.find((ingredient) => canonicalIngredients[ingredient.canonicalIngredientId].allergens.some((allergen) => exclusions.has(allergen)));
  if (conflict) return { familyId: family.id, targetCalories, targetProtein: input.targetProtein, amounts: {}, nutrition: n(0, 0, 0, 0), viable: false, reason: "hard_exclusion", explanation: [`Ингредиент ${conflict.canonicalIngredientId} конфликтует с жёстким исключением.`] };
  const candidates = (["min", "base", "preferred"] as const).map((seed) => hillClimb(family, seed, targetCalories, input.targetProtein)).sort((a, b) => a.score - b.score);
  const best = candidates[0];
  const calorieTolerance = Math.max(12, targetCalories * 0.025);
  const proteinFloor = Math.max(family.minimumProtein, input.targetProtein ?? 0);
  const viable = Math.abs(best.nutrition.kcal - targetCalories) <= calorieTolerance && best.nutrition.protein + 0.2 >= proteinFloor;
  const changed = family.ingredients.filter((ingredient) => Math.abs(best.amounts[ingredient.sourceIngredientId] - ingredient.baseAmount) > (ingredient.unit === "piece" ? 0.05 : 0.5)).sort((a, b) => a.scalingPriority - b.scalingPriority);
  return {
    familyId: family.id,
    targetCalories,
    targetProtein: input.targetProtein,
    amounts: best.amounts,
    nutrition: best.nutrition,
    viable,
    reason: viable ? undefined : "constraints_unsatisfied",
    explanation: viable
      ? [`Получено ${best.nutrition.kcal} ккал и ${best.nutrition.protein} г белка.`, ...changed.slice(0, 4).map((ingredient) => `${ingredient.role}: ${ingredient.sourceIngredientId} ${ingredient.baseAmount} → ${best.amounts[ingredient.sourceIngredientId]} ${ingredient.unit}.`)]
      : [`В пределах ингредиентных ограничений получено ${best.nutrition.kcal} ккал и ${best.nutrition.protein} г белка; блюдо не деформируется ради цели.`],
  };
}

export function solveRecipeBatch(family: RecipeFamily, portions: { id: string; targetCalories: number; targetProtein?: number; hardExclusions?: string[] }[]) {
  const solved = portions.map((portion) => ({ id: portion.id, variant: solveRecipeFamily(family, portion) }));
  const viable = solved.every((item) => item.variant.viable);
  const totals: Record<string, number> = {};
  if (viable) for (const { variant } of solved) for (const [id, amount] of Object.entries(variant.amounts)) totals[id] = round((totals[id] ?? 0) + amount);
  return { familyId: family.id, viable, portions: solved, totals, packing: solved.map(({ id, variant }) => ({ id, calories: variant.nutrition.kcal, ingredientAmounts: variant.amounts })) };
}

export function materializeInstructions(family: RecipeFamily, amounts: Record<string, number>) {
  return family.miseInstructions.map((step, index) => {
    if (index !== 0) return step.text;
    const lines = family.ingredients.map((ingredient) => {
      const canonical = canonicalIngredients[ingredient.canonicalIngredientId];
      const unit = ingredient.unit === "piece" ? "шт." : ingredient.unit === "ml" ? "мл" : "г";
      return `${canonical.canonicalName.toLowerCase()} — ${round(amounts[ingredient.sourceIngredientId] ?? ingredient.baseAmount)} ${unit}`;
    });
    return `${step.text} ${lines.join("; ")}.`;
  });
}
