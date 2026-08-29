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

export type IngredientMappingDecision = {
  sourceName: string;
  canonicalIngredientId: string | null;
  status: "mapped" | "ignored" | "unresolved";
  reason?: string;
};

export type NormalizedRecipeDraft = RawRecipeCandidate & {
  canonicalIngredientIds: (string | null)[];
  ingredientMappings: IngredientMappingDecision[];
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
  densityGPerMl?: number;
  reference: {
    provider: string;
    checkedAt: string;
    note: string;
    sourceUrl: string;
    recordId: string;
    dataType: "foundation" | "sr_legacy" | "interpolated" | "label_required";
    description: string;
  };
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
  nutritionDelta: Nutrition;
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
const fdcReference = (recordId: string, description: string, note = "Значения на 100 г для указанной формы продукта."): CanonicalIngredient["reference"] => ({
  provider: "USDA FoodData Central",
  checkedAt,
  note,
  sourceUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${recordId}/nutrients`,
  recordId,
  dataType: "sr_legacy",
  description,
});
const labelReference = (recordId: string, description: string, note: string): CanonicalIngredient["reference"] => ({
  provider: "Mise editorial label profile",
  checkedAt,
  note,
  sourceUrl: "https://fdc.nal.usda.gov/data-documentation/",
  recordId,
  dataType: "label_required",
  description,
});
const interpolatedReference = (recordId: string, description: string, note: string): CanonicalIngredient["reference"] => ({
  provider: "USDA FoodData Central, editorial interpolation",
  checkedAt,
  note,
  sourceUrl: "https://fdc.nal.usda.gov/data-documentation/",
  recordId,
  dataType: "interpolated",
  description,
});

const nutritionReferences: Record<string, CanonicalIngredient["reference"]> = {
  "bbq-sauce": fdcReference("174523", "Sauce, barbecue", "Упаковка может заметно отличаться; перед готовкой сверить этикетку."),
  beef: fdcReference("174055", "Beef, top sirloin, steak, separable lean only, raw"),
  "beef-mince": fdcReference("173110", "Beef, ground, 93% lean meat / 7% fat, raw"),
  berries: fdcReference("171711", "Blueberries, raw", "Прокси для несладкой смеси ягод; конкретная смесь может отличаться."),
  "black-beans": fdcReference("173735", "Beans, black, mature seeds, cooked, boiled, without salt"),
  broccoli: fdcReference("170379", "Broccoli, raw"),
  broth: fdcReference("174536", "Soup, chicken broth, ready-to-serve", "Для концентрата или кубика использовать этикетку."),
  bouillon: fdcReference("171563", "Soup, chicken broth cubes, dry", "Состав и аллергены зависят от марки; этикетка обязательна."),
  buckwheat: fdcReference("170685", "Buckwheat groats, roasted, dry"),
  cabbage: fdcReference("169975", "Cabbage, raw"),
  carrot: fdcReference("170393", "Carrots, raw"),
  cauliflower: fdcReference("169986", "Cauliflower, raw"),
  cheese: fdcReference("173414", "Cheese, cheddar", "Прокси для полутвёрдого сыра; сверить этикетку упаковки."),
  chicken: fdcReference("171077", "Chicken breast, skinless, boneless, meat only, raw"),
  "chicken-thigh": fdcReference("173627", "Chicken thigh, meat only, raw"),
  corn: fdcReference("168401", "Corn, sweet, yellow, frozen, cooked, boiled, drained, without salt"),
  cottage: fdcReference("172179", "Cheese, cottage, creamed", "Ближайший профиль к творогу 4–5%; сверить этикетку."),
  cream: fdcReference("171308", "Cream, half and half, lowfat", "Прокси для сливок 10%."),
  "cream-cheese": fdcReference("173418", "Cheese, cream", "Творожный сыр зависит от марки; сверить этикетку."),
  cucumber: fdcReference("168409", "Cucumber, with peel, raw"),
  egg: fdcReference("171287", "Egg, whole, raw, fresh"),
  feta: fdcReference("173420", "Cheese, feta"),
  gochujang: labelReference("label:gochujang", "Gochujang", "Состав и КБЖУ зависят от бренда; профиль только для планирования, этикетка обязательна."),
  greens: fdcReference("170416", "Parsley, fresh", "Прокси для свежей зелени."),
  honey: fdcReference("169640", "Honey"),
  "hot-sauce": fdcReference("171186", "Sauce, hot chile, sriracha", "Прокси для острого соуса; сверить этикетку."),
  hummus: fdcReference("174289", "Hummus, commercial", "Коммерческий хумус зависит от марки; сверить этикетку."),
  lettuce: fdcReference("169247", "Lettuce, cos or romaine, raw"),
  lime: fdcReference("168155", "Limes, raw"),
  mayonnaise: fdcReference("171009", "Salad dressing, mayonnaise, regular", "Майонез зависит от жирности; сверить этикетку."),
  milk: fdcReference("171267", "Milk, reduced fat, fluid, 2% milkfat"),
  mushrooms: fdcReference("169251", "Mushrooms, white, raw"),
  oats: fdcReference("169705", "Oats"),
  onion: fdcReference("170000", "Onions, raw"),
  parmesan: fdcReference("170848", "Cheese, parmesan, hard"),
  pasta: fdcReference("169736", "Pasta, dry, enriched"),
  peas: fdcReference("170420", "Peas, green, cooked, boiled, drained, without salt"),
  pepper: fdcReference("170108", "Peppers, sweet, red, raw"),
  pickles: fdcReference("168558", "Pickles, cucumber, dill or kosher dill"),
  "pork-mince": interpolatedReference("168372+169190", "Pork, ground, 90% lean / 10% fat, raw", "Линейная интерполяция USDA 84/16 и 96/4; если упаковка маркирована иначе, использовать этикетку."),
  potato: fdcReference("170026", "Potatoes, flesh and skin, raw"),
  pumpkin: fdcReference("168448", "Pumpkin, raw"),
  "red-beans": fdcReference("175194", "Beans, kidney, red, mature seeds, cooked, boiled, without salt"),
  rice: fdcReference("168877", "Rice, white, long-grain, regular, raw, enriched"),
  "rice-cooked": fdcReference("168878", "Rice, white, long-grain, regular, cooked, enriched"),
  "roasted-pepper": fdcReference("170110", "Peppers, sweet, red, cooked, boiled, drained, without salt", "Прокси для запечённого перца без масла."),
  salmon: fdcReference("175167", "Fish, salmon, Atlantic, farmed, raw"),
  salsa: fdcReference("174524", "Sauce, salsa, ready-to-serve", "Готовая сальса зависит от марки; сверить этикетку."),
  soy: fdcReference("174277", "Soy sauce made from soy and wheat (shoyu)", "Для безглютенового соуса использовать отдельную этикетку."),
  spinach: fdcReference("168462", "Spinach, raw"),
  "sweet-potato": fdcReference("168482", "Sweet potato, raw, unprepared"),
  tomato: fdcReference("170457", "Tomatoes, red, ripe, raw, year round average"),
  "tomato-passata": fdcReference("170460", "Tomato products, canned, puree, without salt added", "Прокси для пассаты; сверить этикетку."),
  "tomato-paste": fdcReference("170459", "Tomato products, canned, paste, without salt added"),
  tortilla: fdcReference("173242", "Tortillas, flour, without added calcium", "Тортилья зависит от массы и марки; сверить этикетку."),
  "turkey-mince": fdcReference("171505", "Turkey, ground, raw"),
  yogurt: fdcReference("170903", "Yogurt, Greek, plain, lowfat", "Йогурт зависит от жирности; сверить этикетку."),
  zucchini: fdcReference("169291", "Squash, summer, zucchini, includes skin, raw"),
  "olive-oil": fdcReference("171413", "Oil, olive, salad or cooking"),
  butter: fdcReference("173430", "Butter, without salt"),
  "brown-sugar": fdcReference("168833", "Sugars, brown"),
  garlic: fdcReference("169230", "Garlic, raw"),
  mustard: fdcReference("172234", "Mustard, prepared, yellow", "Прокси для дижонской горчицы; горчица отмечена как аллерген."),
  "oyster-sauce": fdcReference("174529", "Sauce, oyster, ready-to-serve", "Упаковка может содержать моллюсков, сою и глютен; этикетка обязательна."),
  worcestershire: fdcReference("171610", "Sauce, worcestershire", "Состав зависит от бренда и может содержать рыбу; этикетка обязательна."),
  vinegar: fdcReference("172237", "Vinegar, distilled"),
  lemon: fdcReference("167747", "Lemon juice, raw"),
  "lime-juice": fdcReference("168156", "Lime juice, raw"),
  starch: fdcReference("169698", "Cornstarch"),
};

type IngredientSeed = [string, string, string, CanonicalIngredient["state"], Nutrition, number?, string[]?];
const n = (kcal: number, protein: number, fat: number, carbs: number): Nutrition => ({ kcal, protein, fat, carbs });
const ingredientSeeds: IngredientSeed[] = [
  ["bbq-sauce", "Соус BBQ", "sauce", "processed", n(172, 0.82, 0.63, 40.77)],
  ["beef", "Говядина постная", "meat", "raw", n(131, 22.09, 4.08, 0)],
  ["beef-mince", "Говяжий фарш 93/7", "meat", "raw", n(152, 20.85, 7, 0)],
  ["berries", "Ягоды", "fruit", "raw", n(57, 0.74, 0.33, 14.49)],
  ["black-beans", "Фасоль чёрная", "legume", "cooked", n(132, 8.86, 0.54, 23.71)],
  ["broccoli", "Брокколи", "vegetable", "raw", n(34, 2.82, 0.37, 6.64)],
  ["broth", "Бульон", "sauce", "processed", n(6, 0.64, 0.21, 0.44)],
  ["bouillon", "Сухой бульон", "sauce", "processed", n(198, 14.6, 4.7, 23.5)],
  ["buckwheat", "Гречка сухая", "grain", "raw", n(346, 11.73, 2.71, 74.95)],
  ["cabbage", "Капуста", "vegetable", "raw", n(25, 1.28, 0.1, 5.8)],
  ["carrot", "Морковь", "vegetable", "raw", n(41, 0.93, 0.24, 9.58), 80],
  ["cauliflower", "Цветная капуста", "vegetable", "raw", n(25, 1.92, 0.28, 4.97)],
  ["cheese", "Полутвёрдый сыр", "dairy", "processed", n(403, 22.87, 33.31, 3.37), 1, ["milk"]],
  ["chicken", "Куриная грудка", "meat", "raw", n(120, 22.5, 2.62, 0)],
  ["chicken-thigh", "Куриное бедро без кожи", "meat", "raw", n(121, 19.66, 4.12, 0)],
  ["corn", "Кукуруза", "vegetable", "cooked", n(94, 3.11, 0.74, 22.33)],
  ["cottage", "Творог 4–5%", "dairy", "processed", n(98, 11.12, 4.3, 3.38), 1, ["milk"]],
  ["cream", "Сливки 10%", "dairy", "processed", n(72, 3.33, 5, 3.33), 1, ["milk"]],
  ["cream-cheese", "Творожный сыр", "dairy", "processed", n(350, 6.15, 34.44, 5.52), 1, ["milk"]],
  ["cucumber", "Огурец", "vegetable", "raw", n(15, 0.65, 0.11, 3.63), 200],
  ["egg", "Куриное яйцо", "egg", "raw", n(143, 12.56, 9.51, 0.72), 50, ["egg"]],
  ["feta", "Фета", "dairy", "processed", n(265, 14.21, 21.49, 3.88), 1, ["milk"]],
  ["gochujang", "Паста кочудян", "sauce", "processed", n(210, 5, 3, 43), 1, ["soy", "gluten"]],
  ["greens", "Зелень", "vegetable", "raw", n(36, 2.97, 0.79, 6.33)],
  ["honey", "Мёд", "sweetener", "processed", n(304, 0.3, 0, 82.4)],
  ["hot-sauce", "Острый соус", "sauce", "processed", n(93, 1.93, 0.93, 19.16)],
  ["hummus", "Хумус", "legume", "processed", n(237, 7.78, 17.82, 15), 1, ["sesame"]],
  ["lettuce", "Салат романо", "vegetable", "raw", n(17, 1.23, 0.3, 3.29)],
  ["lime", "Лайм", "fruit", "raw", n(30, 0.7, 0.2, 10.54), 70],
  ["mayonnaise", "Майонез", "fat", "processed", n(680, 0.96, 74.85, 0.57), 1, ["egg"]],
  ["milk", "Молоко 2%", "dairy", "processed", n(50, 3.3, 1.98, 4.8), 1, ["milk"]],
  ["mushrooms", "Шампиньоны", "vegetable", "raw", n(22, 3.09, 0.34, 3.26)],
  ["oats", "Овсяные хлопья", "grain", "raw", n(389, 16.89, 6.9, 66.27), 1, ["gluten"]],
  ["onion", "Репчатый лук", "vegetable", "raw", n(40, 1.1, 0.1, 9.34), 110],
  ["parmesan", "Пармезан", "dairy", "processed", n(392, 35.75, 25, 3.22), 1, ["milk"]],
  ["pasta", "Макароны сухие", "grain", "raw", n(371, 13.04, 1.51, 74.67), 1, ["gluten"]],
  ["peas", "Зелёный горошек", "legume", "cooked", n(84, 5.36, 0.22, 15.63)],
  ["pepper", "Сладкий перец", "vegetable", "raw", n(26, 0.99, 0.3, 6.03), 150],
  ["pickles", "Маринованные огурцы", "vegetable", "processed", n(12, 0.5, 0.3, 2.4)],
  ["pork-mince", "Свиной фарш 90/10", "meat", "raw", n(176, 20.45, 10, 0.1)],
  ["potato", "Картофель", "vegetable", "raw", n(77, 2.05, 0.09, 17.49)],
  ["pumpkin", "Тыква", "vegetable", "raw", n(26, 1, 0.1, 6.5)],
  ["red-beans", "Красная фасоль", "legume", "cooked", n(127, 8.7, 0.5, 22.8)],
  ["rice", "Рис сухой", "grain", "raw", n(365, 7.13, 0.66, 79.95)],
  ["rice-cooked", "Рис готовый", "grain", "cooked", n(130, 2.69, 0.28, 28.17)],
  ["roasted-pepper", "Запечённый перец", "vegetable", "cooked", n(28, 0.92, 0.2, 6.7)],
  ["salmon", "Лосось", "fish", "raw", n(208, 20.42, 13.42, 0), 1, ["fish"]],
  ["salsa", "Томатная сальса", "sauce", "processed", n(29, 1.52, 0.17, 6.64)],
  ["soy", "Соевый соус", "sauce", "processed", n(53, 8.14, 0.57, 4.93), 1, ["soy", "gluten"]],
  ["spinach", "Шпинат", "vegetable", "raw", n(23, 2.86, 0.39, 3.63)],
  ["sweet-potato", "Батат", "vegetable", "raw", n(86, 1.57, 0.05, 20.12)],
  ["tomato", "Томат", "vegetable", "raw", n(18, 0.88, 0.2, 3.89), 120],
  ["tomato-passata", "Протёртые томаты", "vegetable", "processed", n(38, 1.65, 0.21, 8.98)],
  ["tomato-paste", "Томатная паста", "sauce", "processed", n(82, 4.32, 0.47, 18.91)],
  ["tortilla", "Пшеничная тортилья", "grain", "processed", n(325, 8.7, 7.1, 55.6), 60, ["gluten"]],
  ["turkey-mince", "Фарш индейки", "meat", "raw", n(148, 19.66, 7.66, 0)],
  ["yogurt", "Греческий йогурт", "dairy", "processed", n(73, 9.95, 1.92, 3.94), 1, ["milk"]],
  ["zucchini", "Кабачок", "vegetable", "raw", n(17, 1.21, 0.32, 3.11)],
  ["olive-oil", "Оливковое масло", "fat", "processed", n(884, 0, 100, 0)],
  ["butter", "Сливочное масло", "fat", "processed", n(717, 0.85, 81.11, 0.06), 1, ["milk"]],
  ["brown-sugar", "Коричневый сахар", "sweetener", "processed", n(380, 0.12, 0, 98.09)],
  ["garlic", "Чеснок", "vegetable", "raw", n(149, 6.36, 0.5, 33.06), 5],
  ["mustard", "Горчица", "sauce", "processed", n(60, 3.74, 3.34, 5.83), 1, ["mustard"]],
  ["oyster-sauce", "Устричный соус", "sauce", "processed", n(51, 1.35, 0.25, 10.92), 1, ["molluscs", "soy", "gluten"]],
  ["worcestershire", "Вустерширский соус", "sauce", "processed", n(77, 0, 0, 19.17), 1, ["fish"]],
  ["vinegar", "Уксус", "sauce", "processed", n(18, 0, 0, 0.04)],
  ["lemon", "Лимонный сок", "fruit", "raw", n(22, 0.35, 0.24, 6.9)],
  ["lime-juice", "Сок лайма", "fruit", "raw", n(25, 0.42, 0.07, 8.42)],
  ["starch", "Кукурузный крахмал", "grain", "processed", n(381, 0.26, 0.05, 91.27)],
];

const densityByLegacyId: Record<string, number> = {
  broth: 1,
  cream: 1.01,
  lemon: 1.03,
  "lime-juice": 1.03,
  milk: 1.03,
  soy: 1.16,
  "tomato-passata": 1.04,
  vinegar: 1,
};

export const canonicalIngredients: Record<string, CanonicalIngredient> = Object.fromEntries(
  ingredientSeeds.map(([legacyId, name, category, state, nutrition, gramsPerUnit = 1, allergens = []]) => {
    const id = `${legacyId.replaceAll("-", "_")}_${state}`;
    const referenceProfile = nutritionReferences[legacyId];
    if (!referenceProfile) throw new Error(`Нет nutrition reference для canonical ingredient ${legacyId}.`);
    return [id, {
      id,
      canonicalName: name,
      aliases: [legacyId, name.toLowerCase()],
      category,
      state,
      nutritionPer100g: nutrition,
      allergens,
      unit: { sensibleUnit: gramsPerUnit > 1 ? "piece" : densityByLegacyId[legacyId] ? "ml" : "g", gramsPerUnit, roundTo: gramsPerUnit > 1 ? 0.1 : 5 },
      densityGPerMl: densityByLegacyId[legacyId],
      reference: referenceProfile,
    } satisfies CanonicalIngredient];
  }),
);

function normalizedAlias(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const canonicalByAlias = new Map<string, CanonicalIngredient>();
for (const item of Object.values(canonicalIngredients)) for (const alias of item.aliases) canonicalByAlias.set(normalizedAlias(alias), item);

const ingredientAliasTargets: Record<string, string> = {
  "2% milk": "milk",
  "90/10 ground pork": "pork-mince",
  "baby broccoli": "broccoli",
  "barbecue sauce": "bbq-sauce",
  "beef broth": "broth",
  "boneless skinless chicken breast": "chicken",
  "boneless skinless chicken thighs": "chicken-thigh",
  "broccoli florets": "broccoli",
  "brown sugar": "brown-sugar",
  "canned black beans": "black-beans",
  carrots: "carrot",
  "cheddar cheese": "cheese",
  "chicken boullion": "bouillon",
  cilantro: "greens",
  "chopped parsley": "greens",
  "chopped parsley for garnish": "greens",
  "cooked rice": "rice-cooked",
  "cottage cheese": "cottage",
  "cream cheese": "cream-cheese",
  "crushed tomatoes": "tomato-passata",
  "dijon mustard": "mustard",
  "dill pickle slices": "pickles",
  "dry basmati rice": "rice",
  "english cucumber": "cucumber",
  "feta cheese": "feta",
  "frozen butternut squash": "pumpkin",
  "frozen cauliflower": "cauliflower",
  "frozen corn": "corn",
  "green bell pepper": "pepper",
  "green onions": "onion",
  "green pepper": "pepper",
  "ground beef": "beef-mince",
  "ground beef (93/7)": "beef-mince",
  "half and half": "cream",
  kale: "cabbage",
  "lemon juice": "lemon",
  "lemon wedges": "lemon",
  "lime juice": "lime-juice",
  "lo mein noodles": "pasta",
  macaroni: "pasta",
  mayo: "mayonnaise",
  oil: "olive-oil",
  "olive oil": "olive-oil",
  "oyster sauce": "oyster-sauce",
  "parmesan cheese": "parmesan",
  "plain greek yogurt": "yogurt",
  "plain non fat greek yogurt": "yogurt",
  "red bell pepper": "pepper",
  "red onion": "onion",
  "roasted red peppers": "roasted-pepper",
  "roma tomato": "tomato",
  "roma tomatoes": "tomato",
  "romaine lettuce": "lettuce",
  "russet potatoes": "potato",
  scallions: "onion",
  "shredded cabbage": "cabbage",
  "shredded cheese": "cheese",
  "small red onion": "onion",
  spaghetti: "pasta",
  "soy sauce": "soy",
  "sweet potato": "sweet-potato",
  "tomato paste": "tomato-paste",
  "hot sauce": "hot-sauce",
  "top round roast": "beef",
  "top sirloin steak": "beef",
  tortillas: "tortilla",
  "white vinegar": "vinegar",
  "worcestershire sauce": "worcestershire",
};

for (const [alias, legacyId] of Object.entries(ingredientAliasTargets)) {
  const canonicalId = `${legacyId.replaceAll("-", "_")}_${ingredientSeeds.find(([id]) => id === legacyId)?.[3]}`;
  const canonical = canonicalIngredients[canonicalId];
  if (canonical) canonicalByAlias.set(normalizedAlias(alias), canonical);
}

const ignoredIngredientReasons: Record<string, string> = Object.fromEntries([
  "baking soda", "cayenne pepper", "chili powder", "cinnamon", "cumin", "fennel seeds",
  "garlic powder", "ginger", "ground cumin", "italian seasoning", "jalapeño", "mirin",
  "onion powder", "oregano", "paprika", "pepper", "red pepper flakes", "salt",
  "salt and pepper to taste", "salt to taste", "smoked paprika", "turmeric", "water",
  "hot water", "water to consistency", "white pepper",
].map((name) => [name, "Редакционный микрокомпонент: указан в инструкции, но не используется для вариативного расчёта КБЖУ."]));

export const PILOT_RAW_SOURCE_SLUGS = [
  "crispy-chili-beef-noodles", "sheet-pan-teriyaki-chicken-and-vegetables", "taco-mac",
  "mediterranean-chicken-wraps", "easy-dump-and-bake-creamy-chicken-pasta",
  "one-pot-sausage-and-pepper-pasta", "bbq-cheddar-burger-bowls",
  "honey-lime-steak-burrito-bowls", "halal-cart-style-chicken-buffet-prep",
  "roasted-red-pepper-chicken-dip", "slow-cooker-big-boy-beef-stroganoff",
] as const;

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
  const ingredientMappings: IngredientMappingDecision[] = sourceIngredients.map((value) => {
    const ingredient = value as { id?: string; name?: string };
    const sourceName = String(ingredient.name ?? ingredient.id ?? "").trim();
    const alias = normalizedAlias(sourceName);
    const canonical = canonicalByAlias.get(normalizedAlias(ingredient.id ?? "")) ?? canonicalByAlias.get(alias);
    if (canonical) return { sourceName, canonicalIngredientId: canonical.id, status: "mapped" };
    const reason = ignoredIngredientReasons[alias];
    if (reason) return { sourceName, canonicalIngredientId: null, status: "ignored", reason };
    return { sourceName, canonicalIngredientId: null, status: "unresolved", reason: "Нужно редакционное решение для канонического ингредиента." };
  });
  const canonicalIngredientIds = ingredientMappings.map((mapping) => mapping.canonicalIngredientId);
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
    ingredientMappings,
    normalizationStatus: ingredientMappings.some((mapping) => mapping.status === "unresolved")
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

function familyRoles(groups: Partial<Record<RecipeIngredientRole, string[]>>) {
  return Object.fromEntries(
    Object.entries(groups).flatMap(([role, ids]) => (ids ?? []).map((id) => [id, role])),
  ) as Record<string, RecipeIngredientRole>;
}

const pilotRoleOverrides: Record<string, Record<string, RecipeIngredientRole>> = {
  "src-cottage-bake": familyRoles({ protein: ["cottage", "egg"], sauce: ["milk"], fat: ["butter"] }),
  "src-protein-oats": familyRoles({ protein: ["cottage"], carb: ["oats"], sauce: ["milk"], vegetable: ["berries"] }),
  "src-chicken-buckwheat": familyRoles({ protein: ["chicken"], carb: ["buckwheat"], vegetable: ["carrot"], garnish: ["greens"] }),
  "src-chicken-rice-veg": familyRoles({ protein: ["chicken"], carb: ["rice"], vegetable: ["carrot", "pepper", "peas"] }),
  "src-chicken-bean-bowl": familyRoles({ protein: ["chicken"], carb: ["rice", "red-beans"], vegetable: ["onion"], sauce: ["tomato-passata"], fat: ["olive-oil"] }),
  "src-salmon-rice-veg": familyRoles({ protein: ["salmon"], carb: ["rice"], vegetable: ["broccoli", "zucchini"], fat: ["olive-oil"], flavour_fixed: ["garlic"] }),
  "src-turkey-meatballs": familyRoles({ protein: ["turkey-mince"], carb: ["buckwheat"], vegetable: ["onion", "carrot"], sauce: ["tomato-passata"], fat: ["olive-oil"], flavour_fixed: ["egg"] }),
  "src-taco-mac": familyRoles({ protein: ["beef-mince"], carb: ["pasta"], vegetable: ["pepper"], sauce: ["tomato-passata", "milk"], fat: ["cheese", "olive-oil"], flavour: ["broth"] }),
  "src-teriyaki-tray": familyRoles({ protein: ["chicken-thigh"], carb: ["rice", "sweet-potato"], vegetable: ["broccoli"], fat: ["olive-oil"], flavour_fixed: ["soy", "brown-sugar", "vinegar", "garlic"] }),
  "src-halal-chicken": familyRoles({ protein: ["chicken-thigh"], carb: ["rice"], vegetable: ["cucumber", "tomato", "onion"], fat: ["mayonnaise", "butter", "olive-oil"], sauce: ["yogurt"], flavour_fixed: ["lemon", "vinegar"] }),
  "src-crispy-beef-noodles": familyRoles({ protein: ["beef-mince"], carb: ["pasta"], vegetable: ["broccoli", "cabbage", "carrot", "onion"], fat: ["olive-oil"], sauce: ["gochujang"], flavour_fixed: ["soy", "honey", "oyster-sauce", "garlic"] }),
  "src-mediterranean-wrap": familyRoles({ protein: ["chicken-thigh"], carb: ["tortilla"], vegetable: ["cucumber", "tomato", "lettuce", "onion"], fat: ["feta", "olive-oil"], sauce: ["hummus"], flavour_fixed: ["lemon", "vinegar"] }),
  "src-creamy-chicken-pasta": familyRoles({ protein: ["chicken-thigh"], carb: ["pasta"], vegetable: ["cauliflower", "pumpkin"], sauce: ["cottage", "milk"], fat: ["parmesan", "olive-oil"], flavour_fixed: ["lemon", "bouillon"] }),
  "src-sausage-pepper-pasta": familyRoles({ protein: ["pork-mince"], carb: ["pasta"], vegetable: ["onion", "pepper", "spinach"], sauce: ["tomato-passata", "tomato-paste"], fat: ["cream", "parmesan", "olive-oil"], flavour_fixed: ["garlic"] }),
  "src-honey-lime-steak": familyRoles({ protein: ["beef"], carb: ["rice", "black-beans"], vegetable: ["pepper", "corn"], fat: ["olive-oil"], sauce: ["salsa"], flavour_fixed: ["lime", "honey", "soy", "lime-juice"] }),
  "src-light-stroganoff": familyRoles({ protein: ["beef"], carb: ["pasta"], vegetable: ["carrot", "mushrooms", "onion"], fat: ["cream-cheese"], sauce: ["yogurt", "broth"], flavour_fixed: ["mustard", "worcestershire", "starch"] }),
  "src-bbq-burger-bowl": familyRoles({ protein: ["beef-mince"], carb: ["potato"], vegetable: ["cabbage", "tomato"], fat: ["cheese", "olive-oil"], sauce: ["bbq-sauce"], garnish: ["pickles"] }),
  "src-red-pepper-chicken-dip": familyRoles({ protein: ["chicken", "cottage"], vegetable: ["roasted-pepper"], sauce: ["milk", "hot-sauce"], fat: ["cream-cheese", "parmesan"] }),
};

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
  const grams = amount * (
    ingredient.unit === "piece"
      ? canonical.unit.gramsPerUnit
      : ingredient.unit === "ml"
        ? canonical.densityGPerMl ?? 1
        : 1
  );
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
    const role = pilotRoleOverrides[recipe.id]?.[ingredient.id];
    if (!role) return null;
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
  const nutritionDelta = {
    kcal: round(calculated.kcal - recipe.macros.kcal),
    protein: round(calculated.protein - recipe.macros.protein),
    fat: round(calculated.fat - recipe.macros.fat),
    carbs: round(calculated.carbs - recipe.macros.carbs),
  };
  const nutritionThresholds: Nutrition = {
    kcal: Math.max(50, recipe.macros.kcal * 0.1),
    protein: Math.max(5, recipe.macros.protein * 0.15),
    fat: Math.max(4, recipe.macros.fat * 0.2),
    carbs: Math.max(8, recipe.macros.carbs * 0.15),
  };
  const needsNutritionReview = (Object.keys(nutritionDelta) as (keyof Nutrition)[])
    .some((key) => Math.abs(nutritionDelta[key]) > nutritionThresholds[key]);
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
    nutritionDelta,
    nutritionDeltaKcal: nutritionDelta.kcal,
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
    reviewStatus: needsNutritionReview ? "review_required" : "pilot",
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
    const relative =
      (amounts[ingredient.sourceIngredientId] - center) /
      Math.max(1, ingredient.baseAmount);
    return sum + relative * relative * ingredient.scalingPriority;
  }, 0);
  return Math.abs(targetCalories - nutrition.kcal) * 10 + shortfall * 150 + proteinError * 2 + deviation * 50;
}

function hillClimb(family: RecipeFamily, seed: "min" | "base" | "preferred", targetCalories: number, targetProtein?: number) {
  const amounts = Object.fromEntries(family.ingredients.map((ingredient) => {
    const value = seed === "min" ? ingredient.minAmount : seed === "preferred" ? (ingredient.preferredMin + ingredient.preferredMax) / 2 : ingredient.baseAmount;
    return [ingredient.sourceIngredientId, normalizedAmount(ingredient, value)];
  }));
  let score = objective(family, amounts, targetCalories, targetProtein);
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    let best: { changes: Record<string, number>; score: number } | null = null;
    for (const ingredient of family.ingredients) {
      if (!ingredient.scalable) continue;
      const id = ingredient.sourceIngredientId;
      const step = ingredient.unit === "piece" ? 0.1 : Math.max(1, canonicalIngredients[ingredient.canonicalIngredientId].unit.roundTo);
      for (const direction of [-1, 1]) {
        const next = normalizedAmount(ingredient, amounts[id] + direction * step);
        if (next === amounts[id]) continue;
        const candidate = { ...amounts, [id]: next };
        const nextScore = objective(family, candidate, targetCalories, targetProtein);
        if (nextScore + 0.0001 < (best?.score ?? score)) best = { changes: { [id]: next }, score: nextScore };
      }
    }
    for (let leftIndex = 0; leftIndex < family.ingredients.length; leftIndex += 1) {
      const left = family.ingredients[leftIndex];
      if (!left.scalable) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < family.ingredients.length; rightIndex += 1) {
        const right = family.ingredients[rightIndex];
        if (!right.scalable || right.role !== left.role) continue;
        const leftStep = left.unit === "piece" ? 0.1 : Math.max(1, canonicalIngredients[left.canonicalIngredientId].unit.roundTo);
        const rightStep = right.unit === "piece" ? 0.1 : Math.max(1, canonicalIngredients[right.canonicalIngredientId].unit.roundTo);
        const leftCalories = nutritionForAmount(left, 1).kcal;
        const rightCalories = nutritionForAmount(right, 1).kcal;
        if (leftCalories <= 0 || rightCalories <= 0) continue;
        for (const direction of [-1, 1]) {
          const leftAmount = normalizedAmount(left, amounts[left.sourceIngredientId] + direction * leftStep);
          const leftDelta = leftAmount - amounts[left.sourceIngredientId];
          if (!leftDelta) continue;
          const desiredRightDelta = -(leftDelta * leftCalories) / rightCalories;
          const rightAmount = normalizedAmount(right, amounts[right.sourceIngredientId] + Math.round(desiredRightDelta / rightStep) * rightStep);
          if (rightAmount === amounts[right.sourceIngredientId]) continue;
          const candidate = { ...amounts, [left.sourceIngredientId]: leftAmount, [right.sourceIngredientId]: rightAmount };
          const nextScore = objective(family, candidate, targetCalories, targetProtein);
          if (nextScore + 0.0001 < (best?.score ?? score)) best = { changes: { [left.sourceIngredientId]: leftAmount, [right.sourceIngredientId]: rightAmount }, score: nextScore };
        }
      }
    }
    if (!best) break;
    Object.assign(amounts, best.changes);
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
