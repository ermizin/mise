export type RecipeIngredientRole =
  | "protein"
  | "carb"
  | "vegetable"
  | "fat"
  | "fat_cooking" // Fixed against personal calorie targeting; batch cookware geometry is not modeled yet.
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
  sourceAmount: number | null;
  sourceUnit: string | null;
  sourceAmountPerServing: number | null;
  canonicalIngredientId: string | null;
  replacementCanonicalIngredientIds?: string[];
  status: "mapped" | "replaced" | "ignored_noncaloric" | "ignored_microcomponent" | "unresolved";
  reason?: string;
};

export type AuditedIngredientAmount = {
  canonicalIngredientId: string;
  amount: number;
  unit: RecipeUnit;
};

export type SourceIngredientDisposition = {
  sourceName: string;
  sourceAmount: number | null;
  sourceUnit: string | null;
  sourceAmountPerServing: number | null;
  sourceAmountForMiseServing: number | null;
  canonicalIngredientIds: string[];
  miseAmounts: AuditedIngredientAmount[];
  amountStatus: "quantified" | "source_amount_unavailable" | "not_applicable";
  disposition: "retained" | "replaced" | "omitted_by_adaptation" | "ignored_noncaloric" | "ignored_microcomponent" | "unresolved";
  reason: string;
};

export type SourceNutritionEvidence = {
  scope: "per_serving" | "per_100g_raw" | "unavailable";
  sourceServings?: number;
  miseServingToSourceServingRatio?: number;
  quantitativeCoverage: "verified" | "incomplete";
  comparableToMise: boolean;
  reviewedAt: string;
  note: string;
};

export type RecipeFamilyEditorialAudit = {
  ingredientMapping:
    | {
        source: "raw_candidate";
        reviewedAt: string;
        sourceIngredientCount: number;
        sourceSlug: string;
      }
    | {
        source: "curated_source_audit";
        reviewedAt: string;
        sourceIngredientCount: number;
        decisions: SourceIngredientDisposition[];
      };
  nutrition: SourceNutritionEvidence;
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
  sourceNutrition: Nutrition | null;
  comparisonNutrition: Nutrition | null;
  legacyEditorialNutrition: Nutrition;
  miseCalculatedNutrition: Nutrition;
  nutritionDelta: Nutrition | null;
  nutritionDeltaKcal: number | null;
  editorialAudit: RecipeFamilyEditorialAudit;
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
  bouillon: fdcReference("171563", "Soup, chicken broth cubes, dry", "Консервативный профиль отмечает сою и глютен; состав зависит от марки, этикетка обязательна."),
  buckwheat: fdcReference("170685", "Buckwheat groats, roasted, dry"),
  cabbage: fdcReference("169975", "Cabbage, raw"),
  carrot: fdcReference("170393", "Carrots, raw"),
  cauliflower: fdcReference("169986", "Cauliflower, raw"),
  cheese: fdcReference("173414", "Cheese, cheddar", "Прокси для полутвёрдого сыра; сверить этикетку упаковки."),
  chicken: fdcReference("171077", "Chicken breast, skinless, boneless, meat only, raw"),
  "chicken-thigh": fdcReference("173627", "Chicken thigh, meat only, raw"),
  corn: fdcReference("168401", "Corn, sweet, yellow, frozen, cooked, boiled, drained, without salt"),
  cottage: fdcReference("172179", "Cheese, cottage, creamed", "Ближайший профиль к творогу 4–5%; сверить этикетку."),
  cream: {
    provider: "Простоквашино, карточка продукта",
    checkedAt,
    note: "Расчётный профиль сливок 10%; конкретную упаковку сверить по этикетке.",
    sourceUrl: "https://prostokvashino.ru/product/slivki-10--500-g/",
    recordId: "prostokvashino:cream-10-500",
    dataType: "label_required",
    description: "Сливки 10%: 120 ккал, белки 2,9 г, жиры 10 г, углеводы 4,5 г на 100 г",
  },
  "cream-cheese": fdcReference("173418", "Cheese, cream", "Творожный сыр зависит от марки; сверить этикетку."),
  cucumber: fdcReference("168409", "Cucumber, with peel, raw"),
  egg: fdcReference("171287", "Egg, whole, raw, fresh"),
  feta: fdcReference("173420", "Cheese, feta"),
  gochujang: labelReference("label:gochujang", "Gochujang", "Состав и КБЖУ зависят от бренда; профиль только для планирования, этикетка обязательна."),
  greens: fdcReference("170416", "Parsley, fresh", "Прокси для свежей зелени."),
  ginger: fdcReference("169231", "Ginger root, raw"),
  honey: fdcReference("169640", "Honey"),
  "hot-sauce": fdcReference("171186", "Sauce, hot chile, sriracha", "Прокси для острого соуса; сверить этикетку."),
  hummus: fdcReference("174289", "Hummus, commercial", "Коммерческий хумус зависит от марки; сверить этикетку."),
  jalapeno: fdcReference("168576", "Peppers, jalapeno, raw"),
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
  "white-sugar": fdcReference("169655", "Sugars, granulated"),
  "maple-syrup": fdcReference("169661", "Syrups, maple"),
  garlic: fdcReference("169230", "Garlic, raw"),
  "egg-white": fdcReference("172183", "Egg, white, raw, fresh"),
  celery: fdcReference("169988", "Celery, raw"),
  "wheat-flour": fdcReference("169761", "Wheat flour, white, all-purpose, unenriched"),
  "peanut-butter": fdcReference("172470", "Peanut butter, smooth style, without salt"),
  "canola-oil": fdcReference("172336", "Oil, canola"),
  "sesame-oil": fdcReference("171016", "Oil, sesame, salad or cooking"),
  "coconut-oil": fdcReference("171412", "Oil, coconut"),
  "heavy-cream": fdcReference("170859", "Cream, fluid, heavy whipping"),
  "sour-cream": fdcReference("171257", "Cream, sour, cultured"),
  ricotta: fdcReference("170851", "Cheese, ricotta, whole milk"),
  mozzarella: fdcReference("170845", "Cheese, mozzarella, whole milk"),
  banana: fdcReference("173944", "Bananas, raw"),
  quinoa: fdcReference("168874", "Quinoa, uncooked"),
  "pinto-beans": fdcReference("175200", "Beans, pinto, mature seeds, cooked, boiled, without salt"),
  "oat-flour": fdcReference("169741", "Oat flour, partially debranned"),
  ketchup: fdcReference("168556", "Catsup", "Содержание сахара зависит от марки; сверить этикетку."),
  "beef-mince-90": fdcReference("174030", "Beef, ground, 90% lean meat / 10% fat, raw"),
  "beef-mince-85": fdcReference("171796", "Beef, ground, 85% lean meat / 15% fat, raw"),
  "turkey-mince-93": fdcReference("172850", "Turkey, ground, 93% lean, 7% fat, raw"),
  "chicken-mince": fdcReference("171116", "Chicken, ground, raw"),
  kale: fdcReference("168421", "Kale, raw"),
  "black-beans-dry": fdcReference("173734", "Beans, black, mature seeds, raw"),
  "ricotta-part-skim": fdcReference("171248", "Cheese, ricotta, part skim milk"),
  raisins: fdcReference("168165", "Raisins, dark, seedless"),
  "ham-steak": fdcReference("167874", "Pork, cured, ham, steak, boneless, extra lean, unheated", "Упаковка ветчины может отличаться по соли и сахару; сверить этикетку."),
  "red-cabbage": fdcReference("169977", "Cabbage, red, raw"),
  "active-dry-yeast": fdcReference("175043", "Leavening agents, yeast, baker's, active dry"),
  olives: fdcReference("169094", "Olives, ripe, canned (small-extra large)"),
  "green-chiles": fdcReference("168577", "Peppers, chili, green, canned"),
  "tomato-sauce": fdcReference("170462", "Tomato products, canned, sauce, with onions, green peppers, and celery"),
  "teriyaki-sauce": fdcReference("171167", "Sauce, teriyaki, ready-to-serve", "Готовый соус зависит от марки; сверить этикетку."),
  "corn-tortilla": fdcReference("173241", "Tortillas, ready-to-bake or -fry, corn, without added salt"),
  "vegetable-oil": fdcReference("172370", "Oil, vegetable, soybean, refined"),
  "sesame-seeds": fdcReference("170150", "Seeds, sesame seeds, whole, dried"),
  cocoa: fdcReference("169593", "Cocoa, dry powder, unsweetened"),
  chickpeas: fdcReference("173757", "Chickpeas, mature seeds, cooked, boiled, without salt"),
  tahini: fdcReference("170189", "Seeds, sesame butter, tahini, from roasted and toasted kernels"),
  mustard: fdcReference("172234", "Mustard, prepared, yellow", "Прокси для дижонской горчицы; горчица отмечена как аллерген."),
  "oyster-sauce": fdcReference("174529", "Sauce, oyster, ready-to-serve", "Упаковка может содержать моллюсков, сою и глютен; этикетка обязательна."),
  worcestershire: fdcReference("171610", "Sauce, worcestershire", "Состав зависит от бренда и может содержать рыбу; этикетка обязательна."),
  vinegar: fdcReference("172237", "Vinegar, distilled"),
  lemon: fdcReference("167747", "Lemon juice, raw"),
  "lime-juice": fdcReference("168156", "Lime juice, raw"),
  starch: fdcReference("169698", "Cornstarch"),
  "vegetable-broth": fdcReference("171583", "Soup, vegetable broth, ready to serve"),
  "sunflower-oil": fdcReference("171017", "Oil, sunflower, linoleic (less than 60%)"),
  capers: fdcReference("172238", "Capers, canned"),
  lentils: fdcReference("172420", "Lentils, raw"),
  "lentils-cooked": fdcReference("172421", "Lentils, mature seeds, cooked, boiled, without salt"),
  "red-lentils": fdcReference("174284", "Lentils, pink or red, raw"),
  "whole-milk": fdcReference("171265", "Milk, whole, 3.25% milkfat, with added vitamin D"),
  apple: fdcReference("171688", "Apples, raw, with skin"),
  applesauce: fdcReference("167772", "Applesauce, canned, unsweetened, with added ascorbic acid"),
  avocado: fdcReference("171705", "Avocados, raw, all commercial varieties"),
  provolone: fdcReference("170850", "Cheese, provolone"),
  "brussels-sprouts": fdcReference("170383", "Brussels sprouts, raw"),
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
  ["bouillon", "Сухой бульон", "sauce", "processed", n(198, 14.6, 4.7, 23.5), 1, ["soy", "gluten"]],
  ["buckwheat", "Гречка сухая", "grain", "raw", n(346, 11.73, 2.71, 74.95)],
  ["cabbage", "Капуста", "vegetable", "raw", n(25, 1.28, 0.1, 5.8)],
  ["carrot", "Морковь", "vegetable", "raw", n(41, 0.93, 0.24, 9.58), 80],
  ["cauliflower", "Цветная капуста", "vegetable", "raw", n(25, 1.92, 0.28, 4.97)],
  ["cheese", "Полутвёрдый сыр", "dairy", "processed", n(403, 22.87, 33.31, 3.37), 1, ["milk"]],
  ["chicken", "Куриная грудка", "meat", "raw", n(120, 22.5, 2.62, 0)],
  ["chicken-thigh", "Куриное бедро без кожи", "meat", "raw", n(121, 19.66, 4.12, 0)],
  ["corn", "Кукуруза", "vegetable", "cooked", n(94, 3.11, 0.74, 22.33)],
  ["cottage", "Творог 4–5%", "dairy", "processed", n(98, 11.12, 4.3, 3.38), 1, ["milk"]],
  ["cream", "Сливки 10%", "dairy", "processed", n(120, 2.9, 10, 4.5), 1, ["milk"]],
  ["cream-cheese", "Творожный сыр", "dairy", "processed", n(350, 6.15, 34.44, 5.52), 1, ["milk"]],
  ["cucumber", "Огурец", "vegetable", "raw", n(15, 0.65, 0.11, 3.63), 200],
  ["egg", "Куриное яйцо", "egg", "raw", n(143, 12.56, 9.51, 0.72), 50, ["egg"]],
  ["feta", "Фета", "dairy", "processed", n(265, 14.21, 21.49, 3.88), 1, ["milk"]],
  ["gochujang", "Паста кочудян", "sauce", "processed", n(210, 5, 3, 43), 1, ["soy", "gluten"]],
  ["greens", "Зелень", "vegetable", "raw", n(36, 2.97, 0.79, 6.33)],
  ["ginger", "Имбирь", "vegetable", "raw", n(80, 1.82, 0.75, 17.77)],
  ["honey", "Мёд", "sweetener", "processed", n(304, 0.3, 0, 82.4)],
  ["hot-sauce", "Острый соус", "sauce", "processed", n(93, 1.93, 0.93, 19.16)],
  ["hummus", "Хумус", "legume", "processed", n(237, 7.78, 17.82, 15), 1, ["sesame"]],
  ["jalapeno", "Халапеньо", "vegetable", "raw", n(29, 0.91, 0.37, 6.5)],
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
  ["white-sugar", "Белый сахар", "sweetener", "processed", n(387, 0, 0, 100)],
  ["maple-syrup", "Кленовый сироп", "sweetener", "processed", n(260, 0.04, 0.06, 67)],
  ["garlic", "Чеснок", "vegetable", "raw", n(149, 6.36, 0.5, 33.06), 5],
  ["egg-white", "Яичный белок", "egg", "raw", n(52, 10.9, 0.17, 0.73), 33, ["egg"]],
  ["celery", "Сельдерей", "vegetable", "raw", n(14, 0.69, 0.17, 2.97), 40],
  ["wheat-flour", "Пшеничная мука", "grain", "raw", n(364, 10.3, 0.98, 76.3), 1, ["gluten"]],
  ["peanut-butter", "Арахисовая паста", "nut", "processed", n(598, 22.2, 51.4, 22.3), 1, ["peanuts"]],
  ["canola-oil", "Рапсовое масло", "fat", "processed", n(884, 0, 100, 0)],
  ["sesame-oil", "Кунжутное масло", "fat", "processed", n(884, 0, 100, 0), 1, ["sesame"]],
  ["coconut-oil", "Кокосовое масло", "fat", "processed", n(892, 0, 99.1, 0)],
  ["heavy-cream", "Жирные сливки", "dairy", "processed", n(340, 2.84, 36.1, 2.84), 1, ["milk"]],
  ["sour-cream", "Сметана", "dairy", "processed", n(198, 2.44, 19.4, 4.63), 1, ["milk"]],
  ["ricotta", "Рикотта", "dairy", "processed", n(150, 7.54, 10.2, 7.27), 1, ["milk"]],
  ["mozzarella", "Моцарелла", "dairy", "processed", n(299, 22.2, 22.1, 2.4), 1, ["milk"]],
  ["banana", "Банан", "fruit", "raw", n(89, 1.09, 0.33, 22.8), 118],
  ["quinoa", "Киноа сухая", "grain", "raw", n(368, 14.1, 6.07, 64.2)],
  ["pinto-beans", "Фасоль пинто", "legume", "cooked", n(143, 9.01, 0.65, 26.2)],
  ["oat-flour", "Овсяная мука", "grain", "raw", n(404, 14.7, 9.12, 65.7), 1, ["gluten"]],
  ["ketchup", "Кетчуп", "sauce", "processed", n(101, 1.04, 0.1, 27.4)],
  ["beef-mince-90", "Говяжий фарш 90/10", "meat", "raw", n(176, 20, 10, 0)],
  ["beef-mince-85", "Говяжий фарш 85/15", "meat", "raw", n(215, 18.6, 15, 0)],
  ["turkey-mince-93", "Фарш индейки 93/7", "meat", "raw", n(150, 18.7, 8.34, 0)],
  ["chicken-mince", "Куриный фарш", "meat", "raw", n(143, 17.4, 8.1, 0.04)],
  ["kale", "Кейл", "vegetable", "raw", n(35, 2.92, 1.49, 4.42)],
  ["black-beans-dry", "Чёрная фасоль сухая", "legume", "raw", n(341, 21.6, 1.42, 62.4)],
  ["ricotta-part-skim", "Рикотта частично обезжиренная", "dairy", "processed", n(138, 11.4, 7.91, 5.14), 1, ["milk"]],
  ["raisins", "Изюм", "fruit", "processed", n(299, 3.3, 0.25, 79.3)],
  ["ham-steak", "Ветчина", "meat", "processed", n(122, 19.6, 4.25, 0)],
  ["red-cabbage", "Краснокочанная капуста", "vegetable", "raw", n(31, 1.43, 0.16, 7.37)],
  ["active-dry-yeast", "Сухие активные дрожжи", "leavener", "processed", n(325, 40.4, 7.61, 41.2)],
  ["olives", "Маслины", "vegetable", "processed", n(116, 0.84, 10.9, 6.04)],
  ["green-chiles", "Зелёный чили консервированный", "vegetable", "processed", n(21, 0.72, 0.27, 4.6)],
  ["tomato-sauce", "Томатный соус", "sauce", "processed", n(41, 0.94, 0.74, 8.77)],
  ["teriyaki-sauce", "Соус терияки", "sauce", "processed", n(89, 5.93, 0.02, 15.6), 1, ["soy", "gluten"]],
  ["corn-tortilla", "Кукурузная тортилья", "grain", "processed", n(222, 5.7, 2.5, 46.6), 28],
  ["vegetable-oil", "Растительное масло", "fat", "processed", n(884, 0, 100, 0)],
  ["sesame-seeds", "Кунжут", "seed", "raw", n(573, 17.7, 49.7, 23.4), 1, ["sesame"]],
  ["cocoa", "Какао-порошок", "sweetener", "processed", n(228, 19.6, 13.7, 57.9)],
  ["chickpeas", "Нут", "legume", "cooked", n(164, 8.86, 2.59, 27.4)],
  ["tahini", "Тахини", "seed", "processed", n(595, 17, 53.8, 21.2), 1, ["sesame"]],
  ["mustard", "Горчица", "sauce", "processed", n(60, 3.74, 3.34, 5.83), 1, ["mustard"]],
  ["oyster-sauce", "Устричный соус", "sauce", "processed", n(51, 1.35, 0.25, 10.92), 1, ["molluscs", "soy", "gluten"]],
  ["worcestershire", "Вустерширский соус", "sauce", "processed", n(77, 0, 0, 19.17), 1, ["fish"]],
  ["vinegar", "Уксус", "sauce", "processed", n(18, 0, 0, 0.04)],
  ["lemon", "Лимонный сок", "fruit", "raw", n(22, 0.35, 0.24, 6.9)],
  ["lime-juice", "Сок лайма", "fruit", "raw", n(25, 0.42, 0.07, 8.42)],
  ["starch", "Кукурузный крахмал", "grain", "processed", n(381, 0.26, 0.05, 91.27)],
  ["vegetable-broth", "Овощной бульон", "sauce", "processed", n(5, 0.24, 0.07, 0.93)],
  ["sunflower-oil", "Подсолнечное масло", "fat", "processed", n(884, 0, 100, 0)],
  ["capers", "Каперсы", "vegetable", "processed", n(23, 2.36, 0.86, 4.89)],
  ["lentils", "Чечевица сухая", "legume", "raw", n(352, 24.6, 1.06, 63.4)],
  ["lentils-cooked", "Чечевица готовая", "legume", "cooked", n(116, 9.02, 0.38, 20.1)],
  ["red-lentils", "Красная чечевица сухая", "legume", "raw", n(358, 23.9, 2.17, 63.1)],
  ["whole-milk", "Цельное молоко 3,25%", "dairy", "processed", n(61, 3.15, 3.25, 4.8), 1, ["milk"]],
  ["apple", "Яблоко", "fruit", "raw", n(52, 0.26, 0.17, 13.8), 182],
  ["applesauce", "Яблочное пюре без сахара", "fruit", "processed", n(42, 0.17, 0.1, 11.3)],
  ["avocado", "Авокадо", "fruit", "raw", n(160, 2, 14.7, 8.53), 201],
  ["provolone", "Проволоне", "dairy", "processed", n(351, 25.6, 26.6, 2.14), 1, ["milk"]],
  ["brussels-sprouts", "Брюссельская капуста", "vegetable", "raw", n(43, 3.38, 0.3, 8.95)],
];

const densityByLegacyId: Record<string, number> = {
  "bbq-sauce": 1.13,
  broth: 1,
  "canola-oil": 0.91,
  "coconut-oil": 0.91,
  cream: 1.01,
  honey: 1.4,
  "hot-sauce": 1,
  ketchup: 1.13,
  lemon: 1.03,
  "lime-juice": 1.03,
  "maple-syrup": 1.31,
  mayonnaise: 0.92,
  milk: 1.03,
  "olive-oil": 0.9,
  "sesame-oil": 0.91,
  soy: 1.16,
  "teriyaki-sauce": 1.16,
  "tomato-passata": 1.04,
  "tomato-sauce": 1.04,
  vinegar: 1,
  "vegetable-oil": 0.92,
  "vegetable-broth": 0.92,
  "sunflower-oil": 0.91,
  capers: 0.57,
  applesauce: 1.02,
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
    .replace(/[\u200B-\u200D\u2060\u2063\uFEFF]/g, "")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const canonicalByAlias = new Map<string, CanonicalIngredient>();
for (const item of Object.values(canonicalIngredients)) for (const alias of item.aliases) canonicalByAlias.set(normalizedAlias(alias), item);
const canonicalByLegacyId = new Map(
  ingredientSeeds.map(([legacyId, , , state]) => [legacyId, canonicalIngredients[`${legacyId.replaceAll("-", "_")}_${state}`]]),
);

const ingredientAliasTargets: Record<string, string> = {
  "2% milk": "milk",
  "90/10 ground pork": "pork-mince",
  "baby broccoli": "broccoli",
  "barbecue sauce": "bbq-sauce",
  "bbq sauce": "bbq-sauce",
  "beef broth": "broth",
  "boneless skinless chicken breast": "chicken",
  "boneless skinless chicken thighs": "chicken-thigh",
  "broccoli florets": "broccoli",
  "brown sugar": "brown-sugar",
  "light brown soft sugar": "brown-sugar",
  "dark brown sugar": "brown-sugar",
  "caster sugar": "white-sugar",
  sugar: "white-sugar",
  "granulated sugar": "white-sugar",
  "maple syrup": "maple-syrup",
  "pure maple syrup": "maple-syrup",
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
  "double cream": "heavy-cream",
  "heavy cream": "heavy-cream",
  "sour cream": "sour-cream",
  "ricotta cheese": "ricotta",
  "mozzarella cheese": "mozzarella",
  "crushed tomatoes": "tomato-passata",
  "dijon mustard": "mustard",
  "dill pickle slices": "pickles",
  "dry basmati rice": "rice",
  "english cucumber": "cucumber",
  "feta cheese": "feta",
  "crumbled feta cheese": "feta",
  "frozen butternut squash": "pumpkin",
  "frozen cauliflower": "cauliflower",
  "frozen corn": "corn",
  "green bell pepper": "pepper",
  "green onions": "onion",
  "green pepper": "pepper",
  "ground beef": "beef-mince",
  "ground beef (93/7)": "beef-mince",
  "ground beef 93/7": "beef-mince",
  "ground beef (90/10)": "beef-mince-90",
  "ground beef 90/10": "beef-mince-90",
  "90/10 beef": "beef-mince-90",
  "ground beef (85/15)": "beef-mince-85",
  "ground beef 85/15": "beef-mince-85",
  "85/15 beef": "beef-mince-85",
  "ground turkey (93/7)": "turkey-mince-93",
  "ground turkey 93/7": "turkey-mince-93",
  "ground chicken": "chicken-mince",
  "ground chicken (93/7)": "chicken-mince",
  "ground chicken (95/5)": "chicken-mince",
  "ground chicken (97/3)": "chicken-mince",
  "half and half": "cream",
  kale: "kale",
  "chopped kale": "kale",
  "lemon juice": "lemon",
  "lemon wedges": "lemon",
  "lime juice": "lime-juice",
  "lo mein noodles": "pasta",
  macaroni: "pasta",
  mayo: "mayonnaise",
  oil: "olive-oil",
  "olive oil": "olive-oil",
  "oyster sauce": "oyster-sauce",
  "peanut butter": "peanut-butter",
  "smooth peanut butter": "peanut-butter",
  "cornstarch": "starch",
  "plain flour": "wheat-flour",
  flour: "wheat-flour",
  "all purpose flour": "wheat-flour",
  "rapeseed oil": "canola-oil",
  "canola oil": "canola-oil",
  "sesame oil": "sesame-oil",
  "coconut oil": "coconut-oil",
  celery: "celery",
  bananas: "banana",
  "liquid egg whites": "egg-white",
  "egg whites": "egg-white",
  quinoa: "quinoa",
  "dry quinoa": "quinoa",
  "pinto beans": "pinto-beans",
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
  "russet potato": "potato",
  scallions: "onion",
  "shredded cabbage": "cabbage",
  "shredded cheese": "cheese",
  "small red onion": "onion",
  spaghetti: "pasta",
  "soy sauce": "soy",
  "sweet potato": "sweet-potato",
  "tomato paste": "tomato-paste",
  "hot sauce": "hot-sauce",
  sriracha: "hot-sauce",
  "oat flour": "oat-flour",
  ketchup: "ketchup",
  "dried black beans": "black-beans-dry",
  "low fat ricotta cheese": "ricotta-part-skim",
  "part-skim ricotta": "ricotta-part-skim",
  raisins: "raisins",
  "ham steak": "ham-steak",
  "red cabbage": "red-cabbage",
  "dried yeast": "active-dry-yeast",
  "active dry yeast": "active-dry-yeast",
  "canned black olives": "olives",
  "canned green chilies": "green-chiles",
  "canned green chiles": "green-chiles",
  "tomato sauce": "tomato-sauce",
  "canned tomato sauce": "tomato-sauce",
  "teriyaki sauce": "teriyaki-sauce",
  "corn tortillas": "corn-tortilla",
  "vegetable oil": "vegetable-oil",
  "sesame seeds": "sesame-seeds",
  "cocoa powder": "cocoa",
  "dark cocoa powder": "cocoa",
  "garbanzo beans": "chickpeas",
  tahini: "tahini",
  "4% cottage cheese": "cottage",
  "poblano pepper": "pepper",
  "poblano peppers": "pepper",
  "jalapeño": "jalapeno",
  "top round roast": "beef",
  "top round steak": "beef",
  "top sirloin steak": "beef",
  tortillas: "tortilla",
  "white vinegar": "vinegar",
  "worcestershire sauce": "worcestershire",
  "vegetable broth": "vegetable-broth",
  "vegetable stock": "vegetable-broth",
  "vegetable bouillon powder": "bouillon",
  "vegetable stock cube": "bouillon",
  "vegetable stock cubes": "bouillon",
  "low-salt beef stock cube": "bouillon",
  "sunflower oil": "sunflower-oil",
  caper: "capers",
  capers: "capers",
  lentils: "lentils",
  "dried green lentils": "lentils",
  "green lentils": "lentils",
  "can green lentils": "lentils-cooked",
  "canned green lentils": "lentils-cooked",
  "red lentils": "red-lentils",
  "whole milk": "whole-milk",
  apple: "apple",
  apples: "apple",
  applesauce: "applesauce",
  avocado: "avocado",
  "provolone cheese": "provolone",
  "brussels sprouts": "brussels-sprouts",
};

for (const [alias, legacyId] of Object.entries(ingredientAliasTargets)) {
  const canonical = canonicalByLegacyId.get(legacyId);
  if (canonical) canonicalByAlias.set(normalizedAlias(alias), canonical);
}

const ingredientReplacementTargets: Record<string, { legacyIds: string[]; reason: string }> = {
  mirin: {
    legacyIds: ["vinegar", "brown-sugar"],
    reason: "В адаптации Mise мирин заменён отмеренными уксусом и коричневым сахаром; замена сохранена для аудита КБЖУ.",
  },
};

const noncaloricIngredientReasons: Record<string, string> = Object.fromEntries([
  "baking soda", "salt", "salt to taste", "water", "hot water", "water to consistency",
].map((name) => [name, "Некалорийный технологический компонент: сохранён в source audit, но не используется для вариативного расчёта КБЖУ."]));
const microIngredientReasons: Record<string, string> = Object.fromEntries([
  "baking powder", "black pepper", "cayenne pepper", "chili powder", "cinnamon", "cumin", "cumin seeds", "fennel seeds",
  "garlic powder", "ground cumin", "italian seasoning", "onion powder", "oregano", "paprika",
  "pepper", "red pepper flakes", "salt and pepper to taste", "smoked paprika", "turmeric", "white pepper",
].map((name) => [name, "Редакционный микрокомпонент: вклад мал, но не объявляется нулевым; компонент сохранён в source audit и исключён из вариативной части КБЖУ."]));

// The imported corpus contains two very different parsers.  TMPM usually gives
// a short ingredient name, while Good Food often keeps the preparation and the
// package wording in `name`.  Keep this resolver deliberately conservative:
// it only removes preparation language around an already-known product.  A
// product with materially different nutrition (for example whole milk,
// protein powder or a branded sauce) must stay unresolved until there
// is a canonical profile for it.
const ignoredMicroIngredientPatterns: RegExp[] = [
  /^(?:a |small )?(?:pinch|pinches|sprig|sprigs|handful|small handful|bunch|small bunch|pack)?\s*(?:of )?(?:fresh |dried |ground |minced |crushed |sweet |soft |chopped |finely chopped |roughly chopped |finely sliced |finely grated |toasted )?(?:basil|bay leaf|bay leaves|cayenne(?: pepper)?|chili(?: powder)?|chilli(?: powder| flakes?)?|cinnamon(?: stick)?|coriander|cumin(?: seeds)?|curry powder|dill|fennel seeds?|garam masala|ginger|italian seasoning|jalapeños?|kashmiri chili powder|marjoram|mint|nutmeg|oregano|paprika|parsley|pepper|red pepper flakes?|rosemary|rubbed sage|sage|smoked paprika|sumac|thyme|turmeric|vanilla(?: extract)?|white pepper)(?:\b|,|\(|$)/,
  /^(?:lemon|lime|orange) zest(?:\b|,|$)/,
  /^zest (?:of )?\d+ lemon(?:\b|,|$)/,
  /^(?:salt(?: and pepper)?|seasoned salt)(?:\b|,|$)/,
  /^(?:hot |warm )?water(?:\b|,|$)/,
  /^pasta water(?:\b|,|$)/,
];

const sourceIngredientPatterns: Array<[RegExp, string]> = [
  [/^(?:large |medium |small )?eggs?(?:,? (?:beaten|lightly beaten))?$/, "egg"],
  [/^(?:liquid )?egg whites?$/, "egg-white"],
  [/^(?:minced garlic|(?:large |small |fat )?garlic cloves?(?:,? (?:crushed|chopped|finely chopped|finely grated|grated))?|garlic clove(?:,? (?:crushed|chopped|finely chopped|finely grated|grated))?)$/, "garlic"],
  [/^(?:large |medium |small |very small |sweet |yellow |white |red )?onions?(?: \([^)]*\))?(?:,? (?:halved(?: then)? and )?(?:sliced|chopped|diced|finely chopped|finely diced|finely sliced|roughly chopped|cut into quarters|cut into chunks))?$/, "onion"],
  [/^(?:large |medium |small )?red onions?(?:,? (?:halved(?: then)? and )?(?:sliced|chopped|diced|finely chopped|finely sliced|cut into chunks))?$/, "onion"],
  [/^(?:large |medium |small )?carrots?(?: \([^)]*\))?(?:,? (?:cut .*|chopped|finely chopped|finely diced|very finely chopped|grated|coarsely grated))?$/, "carrot"],
  [/^(?:(?:medium )?sticks? )?celery(?: sticks?| stalks?)?(?: \([^)]*\))?(?:,? (?:finely |very finely )?(?:chopped|diced|sliced))?$/, "celery"],
  [/^(?:red |green |yellow |orange )?(?:bell )?peppers?(?:,? (?:deseeded and )?(?:sliced|diced|finely sliced|finely chopped|halved and deseeded|cut into small chunks|cut into chunks))?$/, "pepper"],
  [/^(?:large |small )?(?:red |green |yellow |orange )?peppers?(?:,? (?:deseeded and )?(?:sliced|diced|finely sliced|finely chopped|halved and deseeded|cut into small chunks|cut into chunks))?$/, "pepper"],
  [/^(?:medium )?poblano peppers?$/, "pepper"],
  [/^(?:large )?(?:boneless,? ?)?(?:skinless,? ?)?chicken breasts?(?: fillets?)?(?:,? .*)?$/, "chicken"],
  [/^(?:boneless,? ?)?(?:skinless,? ?)?chicken thighs?(?: fillets?)?(?:,? .*)?$/, "chicken-thigh"],
  [/^(?:head of |heads of |long-stem |frozen )?broccoli(?: florets?)?(?:,? .*)?$/, "broccoli"],
  [/^(?:frozen )?peas?$/, "peas"],
  [/^(?:frozen )?cauliflower$/, "cauliflower"],
  [/^(?:frozen )?(?:sweetcorn|corn)(?: \([^)]*\))?$/, "corn"],
  [/^(?:extra virgin )?olive oil(?: .*)?$/, "olive-oil"],
  [/^(?:white|red wine|rice|cider|apple cider|balsamic) vinegar$/, "vinegar"],
  [/^(?:chicken|beef) (?:broth|stock)(?: .*)?$/, "broth"],
  [/^(?:chopped |canned |can |tin |x \d+g cans? |x \d+g can )?(?:petite )?(?:diced |chopped |crushed |plum )?tomatoes?(?:,? .*)?$/, "tomato-passata"],
  [/^(?:tomato )?(?:purée|puree)(?: or tomato and veg purée)?$/, "tomato-passata"],
  [/^(?:shredded |mature |strong |smoked or ordinary |vegetarian )?cheddar(?: cheese)?(?:,? grated)?$/, "cheese"],
  [/^(?:grated )?parmesan(?: cheese)?(?: \([^)]*\))?(?:,? (?:finely )?grated)?$/, "parmesan"],
  [/^(?:dry |brown |jasmine |long grain )?basmati rice$/, "rice"],
  [/^jasmine rice$/, "rice"],
  [/^(?:dry )?rice$/, "rice"],
  [/^(?:macaroni noodles|elbow pasta|penne(?: pasta noodles)?|wholewheat penne|wholemeal penne|wholemeal fusilli|pasta shells|small pasta shapes|orzo(?: pasta)?|pasta of choice)$/, "pasta"],
  [/^(?:porridge |old fashioned |rolled )?oats?$/, "oats"],
  [/^oat flour$/, "oat-flour"],
  [/^(?:plain |all[- ]purpose )?flour(?: plus extra for dusting)?$/, "wheat-flour"],
  [/^(?:smooth |crunchy )?peanut butter$/, "peanut-butter"],
  [/^(?:pure )?maple syrup$/, "maple-syrup"],
  [/^(?:caster|granulated) sugar$/, "white-sugar"],
  [/^(?:light |dark )?brown soft sugar$/, "brown-sugar"],
  [/^(?:ripe )?bananas?$/, "banana"],
  [/^(?:dry )?quinoa$/, "quinoa"],
  [/^(?:japanese )?sweet potato(?:es)?(?:,? .*)?$/, "sweet-potato"],
  [/^(?:baby |baking |russet |yukon gold |yellow )?potato(?:es)?(?:,? .*)?$/, "potato"],
  [/^(?:canned )?red kidney beans?$/, "red-beans"],
  [/^(?:(?:can|canned|tin) )?black beans?(?:,? .*)?$/, "black-beans"],
  [/^dried black beans?$/, "black-beans-dry"],
  [/^(?:(?:can|canned|tin) )?pinto beans?(?:,? .*)?$/, "pinto-beans"],
  [/^(?:(?:can|canned|tin|jar) )?chickpeas?(?:,? .*)?$/, "chickpeas"],
  [/^(?:feta cheese|feta crumbled|vegetarian feta)$/, "feta"],
  [/^(?:plain )?cream cheese$/, "cream-cheese"],
  [/^(?:plain )?(?:non ?fat|low ?fat) greek yogurt(?:\s+.*)?$/, "yogurt"],
  [/^2% plain greek yogurt$/, "yogurt"],
  [/^(?:chopped )?cilantro$/, "greens"],
  [/^(?:green onions?|spring onions?)(?:,? .*)?$/, "onion"],
  [/^(?:large )?(?:sliced )?(?:english |seedless |baby )?cucumbers?(?:,? .*)?$/, "cucumber"],
  [/^(?:large |cherry |roma |vine )?tomatoes?(?:,? .*)?$/, "tomato"],
  [/^(?:(?:chestnut|portobello|closed cup) )?mushrooms?(?:,? .*)?$/, "mushrooms"],
  [/^(?:zucchini|courgette)(?:,? .*)?$/, "zucchini"],
  [/^(?:baby )?spinach(?: leaves)?$/, "spinach"],
  [/^(?:romaine )?lettuce$/, "lettuce"],
  [/^lemon (?:juiced|juice)$/, "lemon"],
  [/^lime (?:juiced|juice)$/, "lime-juice"],
  [/^(?:lemon zested and juiced|squeeze of lemon juice)$/, "lemon"],
  [/^(?:handful )?grated cheddar$/, "cheese"],
  [/^(?:(?:large )?knob of |cold |melted )?butter(?:,? .*)?$/, "butter"],
  [/^passata$/, "tomato-passata"],
  [/^beef mince$/, "beef-mince"],
  [/^(?:ground beef \(90\/10\)|ground beef 90\/10|90\/10 beef)$/, "beef-mince-90"],
  [/^(?:ground beef \(85\/15\)|ground beef 85\/15|85\/15 beef)$/, "beef-mince-85"],
  [/^ground turkey \(?(?:93\/7)\)?$/, "turkey-mince-93"],
  [/^ground chicken(?: \(?(?:93\/7|95\/5|97\/3)\)?)?$/, "chicken-mince"],
  [/^(?:ground pork 90\/10|90\/10 ground pork|pork mince)$/, "pork-mince"],
  [/^ground beef(?: \(?(?:93\/7)\)?)?$/, "beef-mince"],
  [/^cooked basmati rice$/, "rice-cooked"],
  [/^flour tortillas?$/, "tortilla"],
  [/^top round steak$/, "beef"],
  [/^matchstick carrots?$/, "carrot"],
  [/^stalks? green onions?$/, "onion"],
  [/^(?:apple|apples)(?:,? (?:peeled and )?(?:grated|chopped|sliced))?$/, "apple"],
  [/^(?:small |medium |large )?avocados?(?:,? (?:halved,? destoned and |halved,? stoned and |peeled and )?(?:chopped|sliced|diced))?$/, "avocado"],
  [/^(?:can |canned )?green lentils?(?:,? (?:drained|rinsed and drained))?$/, "lentils-cooked"],
  [/^(?:dried )?(?:green |brown )?lentils?$/, "lentils"],
  [/^(?:dried )?red lentils?$/, "red-lentils"],
  [/^provolone(?: cheese)?$/, "provolone"],
  [/^brussels sprouts(?:,? .*)?$/, "brussels-sprouts"],
  [/^(?:hot )?(?:low-salt )?vegetable stock$/, "vegetable-broth"],
  [/^(?:vegetable bouillon powder|vegetable stock cubes?|low-salt beef stock cube)$/, "bouillon"],
  [/^(?:can |canned |frozen )?sweetcorn(?:,? (?:drained|defrosted))?$/, "corn"],
  [/^(?:can |canned )?lentils?(?:,? (?:drained|rinsed and drained|drained and rinsed))?$/, "lentils-cooked"],
  [/^cooked green lentils?$/, "lentils-cooked"],
  [/^feta cheese(?:,? cubed)?$/, "feta"],
  [/^(?:grated )?mozzarella(?: cheese)?$/, "mozzarella"],
  [/^ball mozzarella(?: \([^)]*\))?(?:,? (?:drained|quartered).*)?$/, "mozzarella"],
  [/^(?:finely grated )?(?:parmesan|italian-style vegetarian hard cheese)$/, "parmesan"],
  [/^courgettes?(?: \([^)]*\))?(?:,? .*)?$/, "zucchini"],
  [/^carrots?(?:,? (?:very |finely |coarsely )?(?:chopped|diced|grated|sliced|cut into .*))?(?: \([^)]*\))?$/, "carrot"],
  [/^(?:finely chopped )?(?:red |white )?onions?(?:,? (?:halved(?: then)?(?: and)? |very finely |finely |roughly )?(?:sliced|chopped|diced|cut into chunks))?$/, "onion"],
  [/^(?:maris piper|king edward|floury|red-skinned) potato(?:es)?(?:,? .*)?$/, "potato"],
  [/^(?:frozen |bag )?spinach(?: leaves)?(?:,? .*)?$/, "spinach"],
  [/^(?:pitted )?kalamata olives?(?:,? .*)?$/, "olives"],
  [/^white wine vinegar$/, "vinegar"],
];

function canonicalFromSourceName(alias: string): CanonicalIngredient | undefined {
  const direct = canonicalByAlias.get(alias);
  if (direct) return direct;
  // Some source names start with a broken multiplier ("x 400g cans …").
  // It is presentation metadata, never product identity.
  const compact = alias.replace(/^x\s+\d+(?:\.\d+)?(?:g|ml)\s+(?:cans?|packs?|pots?)\s+/, "");
  for (const [pattern, legacyId] of sourceIngredientPatterns) {
    if (pattern.test(compact)) return canonicalByLegacyId.get(legacyId);
  }
  return undefined;
}

function inferredMicroIngredientReason(alias: string): string | undefined {
  // A flavour word is sometimes the prefix of a nutritionally meaningful
  // product ("vanilla protein powder", "pepper jack cheese").  Do not let
  // the broad preparation matcher turn those into a silent omission.
  if (/\b(?:protein|cheese|oil|butter|milk|cream|flour|sugar|chocolate|peanuts?|nuts?|seeds?)\b/.test(alias)) return undefined;
  return ignoredMicroIngredientPatterns.some((pattern) => pattern.test(alias))
    ? "Редакционный микрокомпонент: вклад мал, но не объявляется нулевым; компонент сохранён в source audit и исключён из вариативной части КБЖУ."
    : undefined;
}

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
  const sourceServings = Number.isFinite(Number(candidate.servings)) ? Number(candidate.servings) : undefined;
  const instructionFacts = Array.isArray(candidate.instructionFacts) ? candidate.instructionFacts as RecipeInstruction[] : [];
  const paraphrasedInstructionDraft = Array.isArray(candidate.paraphrasedInstructionDraft) ? candidate.paraphrasedInstructionDraft as RecipeInstruction[] : [];
  const ingredientMappings: IngredientMappingDecision[] = sourceIngredients.map((value) => {
    const ingredient = value as { id?: string; name?: string; amountMetric?: string | number; unitMetric?: string; amount?: string | number; quantity?: string | number; unit?: string };
    const sourceName = String(ingredient.name ?? ingredient.id ?? "").trim();
    const sourceAmountValue = ingredient.amountMetric ?? ingredient.amount ?? ingredient.quantity;
    const parsedSourceAmount = sourceAmountValue === undefined || sourceAmountValue === null || String(sourceAmountValue).trim() === ""
      ? null
      : Number(sourceAmountValue);
    const sourceAmount = parsedSourceAmount !== null && Number.isFinite(parsedSourceAmount) ? parsedSourceAmount : null;
    const sourceUnitValue = String(ingredient.unitMetric ?? ingredient.unit ?? "").trim();
    const sourceUnit = sourceUnitValue || null;
    const sourceAmountPerServing = sourceAmount !== null && sourceServings
      ? sourceAmount / sourceServings
      : null;
    const measurement = { sourceName, sourceAmount, sourceUnit, sourceAmountPerServing };
    const alias = normalizedAlias(sourceName);
    const explicitCanonical = ingredient.id ? canonicalIngredients[ingredient.id] : undefined;
    if (explicitCanonical) return { ...measurement, canonicalIngredientId: explicitCanonical.id, status: "mapped" };
    const noncaloricReason = noncaloricIngredientReasons[alias];
    if (noncaloricReason) return { ...measurement, canonicalIngredientId: null, status: "ignored_noncaloric", reason: noncaloricReason };
    const microReason = microIngredientReasons[alias];
    if (microReason) return { ...measurement, canonicalIngredientId: null, status: "ignored_microcomponent", reason: microReason };
    const replacement = ingredientReplacementTargets[alias];
    if (replacement) {
      return {
        ...measurement,
        canonicalIngredientId: null,
        replacementCanonicalIngredientIds: replacement.legacyIds.map((id) => canonicalByLegacyId.get(id)?.id).filter((id): id is string => Boolean(id)),
        status: "replaced",
        reason: replacement.reason,
      };
    }
    const canonical = canonicalFromSourceName(alias);
    if (canonical) return { ...measurement, canonicalIngredientId: canonical.id, status: "mapped" };
    const inferredMicroReason = inferredMicroIngredientReason(alias);
    if (inferredMicroReason) return { ...measurement, canonicalIngredientId: null, status: "ignored_microcomponent", reason: inferredMicroReason };
    return { ...measurement, canonicalIngredientId: null, status: "unresolved", reason: "Нужно редакционное решение для канонического ингредиента." };
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
    servings: sourceServings,
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

const editorialReviewedAt = "2026-08-29";

type PilotNutritionRecord = SourceNutritionEvidence & { declaredNutrition?: Nutrition | null };

const comparableRawNutrition = (
  sourceServings: number,
  note = "КБЖУ на порцию сохранены из raw-карточки источника; сопоставление выполняется только после редакционной сверки состава.",
  miseServingToSourceServingRatio = 1,
  declaredNutrition?: Nutrition,
): PilotNutritionRecord => ({
  scope: "per_serving",
  sourceServings,
  miseServingToSourceServingRatio,
  quantitativeCoverage: "verified",
  comparableToMise: true,
  reviewedAt: editorialReviewedAt,
  note,
  declaredNutrition,
});

const pilotNutritionRecords: Record<string, PilotNutritionRecord> = {
  "src-cottage-bake": {
    scope: "per_100g_raw",
    quantitativeCoverage: "incomplete",
    comparableToMise: false,
    reviewedAt: editorialReviewedAt,
    note: "Food.ru публикует КБЖУ на 100 г сырьевых продуктов, а выход готовой запеканки не указан; сравнение с порцией Mise некорректно.",
    declaredNutrition: { kcal: 115.72, protein: 12.99, fat: 6.13, carbs: 2.14 },
  },
  "src-protein-oats": {
    scope: "per_serving",
    sourceServings: 4,
    quantitativeCoverage: "incomplete",
    comparableToMise: false,
    reviewedAt: editorialReviewedAt,
    note: "BBC Good Food даёт КБЖУ одной из четырёх порций исходного рецепта; Mise заменяет протеин творогом и исключает несколько калорийных компонентов.",
    declaredNutrition: { kcal: 349, protein: 17, fat: 11, carbs: 41 },
  },
  "src-chicken-buckwheat": {
    scope: "per_100g_raw",
    sourceServings: 1,
    quantitativeCoverage: "incomplete",
    comparableToMise: false,
    reviewedAt: editorialReviewedAt,
    note: "Food.ru публикует КБЖУ на 100 г сырьевых продуктов без выхода блюда; Mise отдельно задаёт увеличенную порцию и количества овощей.",
    declaredNutrition: { kcal: 171.82, protein: 20.36, fat: 2.31, carbs: 18.55 },
  },
  "src-chicken-rice-veg": {
    scope: "per_100g_raw",
    quantitativeCoverage: "incomplete",
    comparableToMise: false,
    reviewedAt: editorialReviewedAt,
    note: "Food.ru публикует КБЖУ на 100 г сырьевых продуктов; состав и доля партии в адаптации Mise изменены, поэтому порционная дельта не вычисляется.",
    declaredNutrition: { kcal: 121.01, protein: 7.14, fat: 5.23, carbs: 11.16 },
  },
  "src-chicken-bean-bowl": {
    scope: "per_serving",
    sourceServings: 4,
    quantitativeCoverage: "incomplete",
    comparableToMise: false,
    reviewedAt: editorialReviewedAt,
    note: "MyProtein даёт КБЖУ исходной порции, но Mise меняет вид фасоли, томатный компонент, количества и исключает лайм с кориандром.",
    declaredNutrition: { kcal: 378, protein: 30, fat: 8, carbs: 35 },
  },
  "src-salmon-rice-veg": {
    scope: "unavailable",
    sourceServings: 3,
    quantitativeCoverage: "incomplete",
    comparableToMise: false,
    reviewedAt: editorialReviewedAt,
    note: "На доступной первичной странице MyProtein числовые КБЖУ отсутствуют; кускус заменён рисом, а веса рыбы и овощей заданы редакционно.",
    declaredNutrition: null,
  },
  "src-turkey-meatballs": {
    scope: "per_100g_raw",
    quantitativeCoverage: "incomplete",
    comparableToMise: false,
    reviewedAt: editorialReviewedAt,
    note: "Food.ru публикует КБЖУ на 100 г сырьевых продуктов; Mise выносит гарнир отдельно и заменяет рис, томатную пасту и количества жира.",
    declaredNutrition: { kcal: 186.46, protein: 11.05, fat: 9.96, carbs: 12.29 },
  },
  "src-taco-mac": comparableRawNutrition(5),
  "src-teriyaki-tray": comparableRawNutrition(5, "Источник даёт КБЖУ на одну из пяти порций; переход от 563 г готового риса в партии к сухому рису Mise отмечен отдельно и остаётся редакционным блокером."),
  "src-halal-chicken": comparableRawNutrition(6, "КБЖУ raw-карточки источника восстановлены без прежней редакционной подмены 705 ккал; салат-латук исключён явно.", 1, { kcal: 773, protein: 53, fat: 36, carbs: 60 }),
  "src-crispy-beef-noodles": comparableRawNutrition(5),
  "src-mediterranean-wrap": comparableRawNutrition(6),
  "src-creamy-chicken-pasta": comparableRawNutrition(5),
  "src-light-stroganoff": comparableRawNutrition(5, "Одна порция Mise соответствует половине большой порции источника; коэффициент 0,5 хранится отдельно от исходных КБЖУ.", 0.5, { kcal: 1013, protein: 80, fat: 22, carbs: 125 }),
  "src-bbq-burger-bowl": comparableRawNutrition(5),
  "src-red-pepper-chicken-dip": comparableRawNutrition(10, "Одна порция Mise соответствует двум небольшим порциям дипа из источника; коэффициент 2 хранится отдельно от исходных КБЖУ.", 2, { kcal: 109, protein: 14.6, fat: 4.6, carbs: 2.4 }),
  "src-sausage-pepper-pasta": comparableRawNutrition(5),
  "src-honey-lime-steak": comparableRawNutrition(5),
};

const idsFor = (...legacyIds: string[]) => legacyIds.map((legacyId) => {
  const canonical = canonicalByLegacyId.get(legacyId);
  if (!canonical) throw new Error(`Нет canonical ingredient для редакционного mapping: ${legacyId}.`);
  return canonical.id;
});
const sourceDecision = (
  sourceName: string,
  disposition: SourceIngredientDisposition["disposition"],
  legacyIds: string[],
  reason: string,
  sourceAmount: number | null = null,
  sourceUnit: string | null = null,
): SourceIngredientDisposition => ({
  sourceName,
  sourceAmount,
  sourceUnit,
  sourceAmountPerServing: null,
  sourceAmountForMiseServing: null,
  canonicalIngredientIds: idsFor(...legacyIds),
  miseAmounts: [],
  amountStatus: "not_applicable",
  disposition,
  reason,
});
const retained = (sourceName: string, legacyId: string, reason = "Сопоставлен с ингредиентом адаптации Mise.", sourceAmount: number | null = null, sourceUnit: string | null = null) =>
  sourceDecision(sourceName, "retained", [legacyId], reason, sourceAmount, sourceUnit);
const replaced = (sourceName: string, legacyIds: string[], reason: string, sourceAmount: number | null = null, sourceUnit: string | null = null) =>
  sourceDecision(sourceName, "replaced", legacyIds, reason, sourceAmount, sourceUnit);
const omitted = (sourceName: string, reason: string, sourceAmount: number | null = null, sourceUnit: string | null = null) =>
  sourceDecision(sourceName, "omitted_by_adaptation", [], reason, sourceAmount, sourceUnit);
const ignoredNoncaloric = (sourceName: string, reason = "Некалорийный технологический компонент; сохранён в source audit, но исключён из вариативного КБЖУ.", sourceAmount: number | null = null, sourceUnit: string | null = null) =>
  sourceDecision(sourceName, "ignored_noncaloric", [], reason, sourceAmount, sourceUnit);
const ignoredMicrocomponent = (sourceName: string, reason = "Малый вкусовой компонент сохранён в source audit; его вклад не объявляется нулевым.", sourceAmount: number | null = null, sourceUnit: string | null = null) =>
  sourceDecision(sourceName, "ignored_microcomponent", [], reason, sourceAmount, sourceUnit);
const retainedMeasured = (sourceName: string, legacyId: string, sourceAmount: number, sourceUnit: string, reason = "Сопоставлен с ингредиентом адаптации Mise.") =>
  retained(sourceName, legacyId, reason, sourceAmount, sourceUnit);
const replacedMeasured = (sourceName: string, legacyIds: string[], sourceAmount: number, sourceUnit: string, reason: string) =>
  replaced(sourceName, legacyIds, reason, sourceAmount, sourceUnit);
const omittedMeasured = (sourceName: string, sourceAmount: number, sourceUnit: string, reason: string) =>
  omitted(sourceName, reason, sourceAmount, sourceUnit);
const ignoredNoncaloricMeasured = (sourceName: string, sourceAmount: number, sourceUnit: string, reason?: string) =>
  ignoredNoncaloric(sourceName, reason, sourceAmount, sourceUnit);

const curatedPilotIngredientAudits: Record<string, SourceIngredientDisposition[]> = {
  "src-cottage-bake": [
    retainedMeasured("Творог", "cottage", 500, "g"), retainedMeasured("Молоко", "milk", 200, "g", "Сохранён, но количество адаптировано."), retainedMeasured("Яйца", "egg", 4, "piece"),
    omitted("Ванилин", "Исключён из адаптации Mise как необязательная ароматическая добавка."),
    retained("Масло для формы", "butter", "Компонент источника сохранён и редакционно нормирован до 2 г на базовую порцию."),
  ],
  "src-protein-oats": [
    replacedMeasured("Протеиновый порошок", ["cottage"], 30, "g", "Заменён мягким творогом по зафиксированной адаптации Mise."),
    retainedMeasured("Овсяные хлопья", "oats", 200, "g"), retainedMeasured("Молоко", "milk", 400, "ml"), retainedMeasured("Ягоды", "berries", 75, "g"),
    omittedMeasured("Семена чиа", 2, "tbsp", "Исключены из упрощённой адаптации Mise."), omittedMeasured("Кленовый сироп", 2, "tsp", "Исключён из адаптации Mise."),
    omittedMeasured("Арахисовая паста", 2, "tbsp", "Исключена из адаптации Mise; исходный аллерген не переносится в адаптированный состав."),
    omittedMeasured("Греческий йогурт", 4, "tbsp", "Исключён из адаптации Mise."), ignoredNoncaloricMeasured("Вода", 100, "ml"),
  ],
  "src-chicken-buckwheat": [
    retainedMeasured("Куриная грудка", "chicken", 120, "g", "Сохранена с редакционно увеличенным количеством."),
    retainedMeasured("Гречка", "buckwheat", 50, "g", "Сохранена как сухая крупа с редакционно увеличенным количеством."),
    retained("Морковь", "carrot", "Источник указывает по вкусу; Mise задаёт измеримое количество."),
    ignoredNoncaloric("Соль"), retained("Зелень", "greens", "Источник упоминает зелень в шаге; Mise задаёт измеримое количество."),
    omitted("Растительное масло после готовности", "В источнике необязательно; в адаптацию Mise не включено."),
  ],
  "src-chicken-rice-veg": [
    retainedMeasured("Рис", "rice", 250, "g"), retainedMeasured("Курица", "chicken", 800, "g"), omittedMeasured("Лук", 80, "g", "Исключён из адаптации Mise."),
    retainedMeasured("Морковь", "carrot", 100, "g"), retainedMeasured("Болгарский перец", "pepper", 300, "g"),
    replacedMeasured("Консервированный горошек", ["peas"], 150, "g", "Заменён замороженным горошком с явным количеством."),
    omittedMeasured("Чеснок", 15, "g", "Исключён из адаптации Mise."), ignoredNoncaloricMeasured("Вода", 500, "g"), ignoredNoncaloric("Соль"), ignoredMicrocomponent("Специи"),
  ],
  "src-chicken-bean-bowl": [
    retainedMeasured("Оливковое масло", "olive-oil", 1, "tbsp"), retainedMeasured("Лук", "onion", 1, "piece"), omittedMeasured("Чеснок", 2, "clove", "Исключён из адаптации Mise."),
    retainedMeasured("Куриные грудки", "chicken", 2, "breast", "Сохранены с редакционно заданной массой."),
    replacedMeasured("Чёрная фасоль", ["red-beans"], 2, "can", "Заменена красной фасолью по зафиксированной адаптации Mise."),
    replacedMeasured("Сальса", ["tomato-passata"], 1, "jar", "Заменена протёртыми томатами по зафиксированной адаптации Mise."),
    replacedMeasured("Бурый рис", ["rice"], 200, "g", "Локализован как обычный сухой рис с отдельно заданной массой."),
    omitted("Лайм", "Исключён из адаптации Mise."), omitted("Кориандр", "Исключён из адаптации Mise."),
  ],
  "src-salmon-rice-veg": [
    retainedMeasured("Филе дикого лосося", "salmon", 3, "fillet", "Сохранено, но масса и профиль лосося заданы редакционно."),
    replacedMeasured("Кускус", ["rice"], 180, "g", "Заменён сухим рисом по зафиксированной адаптации Mise."),
    retainedMeasured("Оливковое масло", "olive-oil", 1, "tbsp"), retainedMeasured("Чеснок", "garlic", 3, "clove"), omittedMeasured("Лимон", 1, "piece", "Исключён из адаптации Mise."),
    omittedMeasured("Каджунская смесь", 1.5, "tbsp", "Заменена в инструкции паприкой и сухими травами; микрокомпонент не участвует в вариативном КБЖУ."),
    retained("Брокколи", "broccoli", "Источник не задаёт массу; Mise задаёт измеримое количество."),
    retainedMeasured("Кабачки", "zucchini", 2, "piece", "Источник задаёт штуки; Mise задаёт измеримую массу."),
  ],
  "src-turkey-meatballs": [
    retainedMeasured("Фарш индейки", "turkey-mince", 400, "g"), replacedMeasured("Рис внутри тефтелей", ["buckwheat"], 100, "g", "Заменён отдельным гарниром из гречки."),
    retainedMeasured("Лук", "onion", 160, "g"), retainedMeasured("Морковь", "carrot", 100, "g"), retainedMeasured("Растительное масло", "olive-oil", 50, "g", "Сохранено и нормировано до фактического количества."),
    retainedMeasured("Яйцо", "egg", 60, "g", "Сохранено как связующий и аллергенный компонент."),
    replacedMeasured("Томатная паста", ["tomato-passata"], 30, "g", "Заменена протёртыми томатами с отдельной массой."), ignoredNoncaloric("Вода"),
  ],
};

const rawPilotIngredientAudits: Record<string, { sourceSlug: string; sourceIngredientCount: number }> = {
  "src-crispy-beef-noodles": { sourceSlug: "crispy-chili-beef-noodles", sourceIngredientCount: 16 },
  "src-teriyaki-tray": { sourceSlug: "sheet-pan-teriyaki-chicken-and-vegetables", sourceIngredientCount: 15 },
  "src-taco-mac": { sourceSlug: "taco-mac", sourceIngredientCount: 16 },
  "src-mediterranean-wrap": { sourceSlug: "mediterranean-chicken-wraps", sourceIngredientCount: 24 },
  "src-creamy-chicken-pasta": { sourceSlug: "easy-dump-and-bake-creamy-chicken-pasta", sourceIngredientCount: 17 },
  "src-sausage-pepper-pasta": { sourceSlug: "one-pot-sausage-and-pepper-pasta", sourceIngredientCount: 20 },
  "src-bbq-burger-bowl": { sourceSlug: "bbq-cheddar-burger-bowls", sourceIngredientCount: 12 },
  "src-honey-lime-steak": { sourceSlug: "honey-lime-steak-burrito-bowls", sourceIngredientCount: 22 },
  "src-halal-chicken": { sourceSlug: "halal-cart-style-chicken-buffet-prep", sourceIngredientCount: 29 },
  "src-red-pepper-chicken-dip": { sourceSlug: "roasted-red-pepper-chicken-dip", sourceIngredientCount: 9 },
  "src-light-stroganoff": { sourceSlug: "slow-cooker-big-boy-beef-stroganoff", sourceIngredientCount: 17 },
};

const pilotAdaptationOmissionReasons: Record<string, Record<string, string>> = {
  "src-crispy-beef-noodles": { "lemon wedges": "Лимонные дольки исключены из адаптации Mise как необязательная подача." },
  "src-taco-mac": { "green onions": "Зелёный лук исключён из упрощённой адаптации Mise." },
  "src-mediterranean-wrap": { ginger: "Имбирь исключён из локализованной смеси специй Mise; его исходные 3 г остаются в source audit." },
  "src-creamy-chicken-pasta": { "chopped parsley": "Петрушка исключена как необязательный гарнир." },
  "src-honey-lime-steak": {
    cilantro: "Кинза исключена из локализованной адаптации Mise.",
    scallions: "Зелёный лук исключён из локализованной адаптации Mise.",
    "jalapeño": "Халапеньо исключён из локализованной адаптации Mise; исходные 20 г остаются в source audit.",
  },
  "src-halal-chicken": { lettuce: "Латук исключён из текущей buffet-адаптации Mise." },
  "src-light-stroganoff": { "chopped parsley for garnish": "Петрушка исключена как необязательный гарнир." },
};

const pilotAdaptationReplacementTargets: Record<string, Record<string, { legacyIds: string[]; reason: string }>> = {
  "src-teriyaki-tray": {
    "cooked rice": {
      legacyIds: ["rice"],
      reason: "Источник задаёт 563 г готового риса на пять порций, а Mise хранит сухой рис; конверсия состояния отмечена явно и требует отдельной проверки количества.",
    },
  },
  "src-bbq-burger-bowl": {
    kale: {
      legacyIds: ["cabbage"],
      reason: "Кейл источника заменён доступной белокочанной капустой по зафиксированной локализации Mise.",
    },
  },
};

export function auditRawCandidateAgainstFamily(
  draft: Pick<NormalizedRecipeDraft, "ingredientMappings">,
  family: Pick<RecipeFamily, "id" | "ingredients" | "editorialAudit">,
): SourceIngredientDisposition[] {
  const familyCanonicalIds = new Set(family.ingredients.map((ingredient) => ingredient.canonicalIngredientId));
  const sourceServingRatio = family.editorialAudit.nutrition.miseServingToSourceServingRatio ?? 1;
  const dispositionFor = (
    mapping: IngredientMappingDecision,
    canonicalIngredientIds: string[],
    disposition: SourceIngredientDisposition["disposition"],
    reason: string,
  ): SourceIngredientDisposition => {
    const miseAmounts = family.ingredients
      .filter((ingredient) => canonicalIngredientIds.includes(ingredient.canonicalIngredientId))
      .map((ingredient) => ({ canonicalIngredientId: ingredient.canonicalIngredientId, amount: ingredient.baseAmount, unit: ingredient.unit }));
    const requiresAmounts = disposition === "retained" || disposition === "replaced";
    const targetsCovered = canonicalIngredientIds.length > 0 && canonicalIngredientIds.every((id) => miseAmounts.some((amount) => amount.canonicalIngredientId === id));
    const sourceAmountForMiseServing = mapping.sourceAmountPerServing !== null
      ? mapping.sourceAmountPerServing * sourceServingRatio
      : null;
    const amountStatus = requiresAmounts
      ? sourceAmountForMiseServing !== null && Boolean(mapping.sourceUnit) && targetsCovered
        ? "quantified"
        : "source_amount_unavailable"
      : "not_applicable";
    return {
      sourceName: mapping.sourceName,
      sourceAmount: mapping.sourceAmount,
      sourceUnit: mapping.sourceUnit,
      sourceAmountPerServing: mapping.sourceAmountPerServing,
      sourceAmountForMiseServing,
      canonicalIngredientIds,
      miseAmounts,
      amountStatus,
      disposition,
      reason,
    };
  };
  return draft.ingredientMappings.map((mapping) => {
    if (mapping.status === "unresolved") {
      return dispositionFor(mapping, [], "unresolved", mapping.reason ?? "Нет canonical mapping.");
    }
    if (mapping.status === "ignored_noncaloric") {
      return dispositionFor(mapping, [], "ignored_noncaloric", mapping.reason ?? "Некалорийный технологический компонент.");
    }
    if (mapping.status === "ignored_microcomponent") {
      return dispositionFor(mapping, [], "ignored_microcomponent", mapping.reason ?? "Малый вкусовой компонент.");
    }
    if (mapping.status === "replaced") {
      const canonicalIngredientIds = mapping.replacementCanonicalIngredientIds ?? [];
      const complete = canonicalIngredientIds.length > 0 && canonicalIngredientIds.every((id) => familyCanonicalIds.has(id));
      return dispositionFor(mapping, canonicalIngredientIds, complete ? "replaced" : "unresolved", complete ? mapping.reason ?? "Явная замена источника." : "Замена не покрыта ингредиентами Recipe Family.");
    }
    const canonicalIngredientId = mapping.canonicalIngredientId;
    if (canonicalIngredientId && familyCanonicalIds.has(canonicalIngredientId)) {
      return dispositionFor(mapping, [canonicalIngredientId], "retained", "Canonical ingredient сохранён в Recipe Family.");
    }
    const alias = normalizedAlias(mapping.sourceName);
    const replacement = pilotAdaptationReplacementTargets[family.id]?.[alias];
    if (replacement) {
      const canonicalIngredientIds = idsFor(...replacement.legacyIds);
      const complete = canonicalIngredientIds.every((id) => familyCanonicalIds.has(id));
      return dispositionFor(mapping, canonicalIngredientIds, complete ? "replaced" : "unresolved", complete ? replacement.reason : "Редакционная замена отсутствует в Recipe Family.");
    }
    const omissionReason = pilotAdaptationOmissionReasons[family.id]?.[alias];
    if (omissionReason) {
      return dispositionFor(mapping, canonicalIngredientId ? [canonicalIngredientId] : [], "omitted_by_adaptation", omissionReason);
    }
    return dispositionFor(mapping, canonicalIngredientId ? [canonicalIngredientId] : [], "unresolved", "Canonical ingredient источника отсутствует в Recipe Family без редакционного решения.");
  });
}

function editorialAuditFor(recipeId: string, ingredients: RecipeFamilyIngredient[]): RecipeFamilyEditorialAudit {
  const nutritionRecord = pilotNutritionRecords[recipeId];
  if (!nutritionRecord) throw new Error(`Нет nutrition audit для pilot Recipe Family ${recipeId}.`);
  const nutrition: SourceNutritionEvidence = {
    scope: nutritionRecord.scope,
    sourceServings: nutritionRecord.sourceServings,
    miseServingToSourceServingRatio: nutritionRecord.miseServingToSourceServingRatio,
    quantitativeCoverage: nutritionRecord.quantitativeCoverage,
    comparableToMise: nutritionRecord.comparableToMise,
    reviewedAt: nutritionRecord.reviewedAt,
    note: nutritionRecord.note,
  };
  const raw = rawPilotIngredientAudits[recipeId];
  if (raw) {
    return {
      ingredientMapping: { source: "raw_candidate", reviewedAt: editorialReviewedAt, ...raw },
      nutrition,
    };
  }
  const decisions = curatedPilotIngredientAudits[recipeId];
  if (!decisions) throw new Error(`Нет ingredient audit для pilot Recipe Family ${recipeId}.`);
  const hydratedDecisions = decisions.map((decision): SourceIngredientDisposition => {
    const miseAmounts = ingredients
      .filter((ingredient) => decision.canonicalIngredientIds.includes(ingredient.canonicalIngredientId))
      .map((ingredient) => ({ canonicalIngredientId: ingredient.canonicalIngredientId, amount: ingredient.baseAmount, unit: ingredient.unit }));
    const requiresAmounts = decision.disposition === "retained" || decision.disposition === "replaced";
    const targetsCovered = decision.canonicalIngredientIds.length > 0 && decision.canonicalIngredientIds.every((id) => miseAmounts.some((amount) => amount.canonicalIngredientId === id));
    const amountStatus = requiresAmounts
      ? decision.sourceAmount !== null && Boolean(decision.sourceUnit) && targetsCovered
        ? "quantified"
        : "source_amount_unavailable"
      : "not_applicable";
    const sourceAmountPerServing = decision.sourceAmount !== null && nutritionRecord.sourceServings
      ? round(decision.sourceAmount / nutritionRecord.sourceServings, 2)
      : null;
    return {
      ...decision,
      sourceAmountPerServing,
      sourceAmountForMiseServing: sourceAmountPerServing !== null
        ? round(sourceAmountPerServing * (nutritionRecord.miseServingToSourceServingRatio ?? 1), 2)
        : null,
      miseAmounts,
      amountStatus,
    };
  });
  return {
    ingredientMapping: { source: "curated_source_audit", reviewedAt: editorialReviewedAt, sourceIngredientCount: hydratedDecisions.length, decisions: hydratedDecisions },
    nutrition,
  };
}

function familyRoles(groups: Partial<Record<RecipeIngredientRole, string[]>>) {
  return Object.fromEntries(
    Object.entries(groups).flatMap(([role, ids]) => (ids ?? []).map((id) => [id, role])),
  ) as Record<string, RecipeIngredientRole>;
}

const pilotRoleOverrides: Record<string, Record<string, RecipeIngredientRole>> = {
  "src-cottage-bake": familyRoles({ protein: ["cottage", "egg"], sauce: ["milk"], fat_cooking: ["butter"] }),
  "src-protein-oats": familyRoles({ protein: ["cottage"], carb: ["oats"], sauce: ["milk"], vegetable: ["berries"] }),
  "src-chicken-buckwheat": familyRoles({ protein: ["chicken"], carb: ["buckwheat"], vegetable: ["carrot"], garnish: ["greens"] }),
  "src-chicken-rice-veg": familyRoles({ protein: ["chicken"], carb: ["rice"], vegetable: ["carrot", "pepper", "peas"] }),
  "src-chicken-bean-bowl": familyRoles({ protein: ["chicken"], carb: ["rice", "red-beans"], vegetable: ["onion"], sauce: ["tomato-passata"], fat_cooking: ["olive-oil"] }),
  "src-salmon-rice-veg": familyRoles({ protein: ["salmon"], carb: ["rice"], vegetable: ["broccoli", "zucchini"], fat: ["olive-oil"], flavour_fixed: ["garlic"] }),
  "src-turkey-meatballs": familyRoles({ protein: ["turkey-mince"], carb: ["buckwheat"], vegetable: ["onion", "carrot"], sauce: ["tomato-passata"], fat_cooking: ["olive-oil"], flavour_fixed: ["egg"] }),
  "src-taco-mac": familyRoles({ protein: ["beef-mince"], carb: ["pasta"], vegetable: ["pepper"], sauce: ["tomato-passata", "milk"], fat: ["cheese"], fat_cooking: ["olive-oil"], flavour: ["broth"] }),
  "src-teriyaki-tray": familyRoles({ protein: ["chicken-thigh"], carb: ["rice", "sweet-potato"], vegetable: ["broccoli"], fat: ["olive-oil"], flavour_fixed: ["soy", "brown-sugar", "vinegar", "garlic"] }),
  "src-halal-chicken": familyRoles({ protein: ["chicken-thigh"], carb: ["rice"], vegetable: ["cucumber", "tomato", "onion"], fat: ["mayonnaise", "butter", "olive-oil"], sauce: ["yogurt"], flavour_fixed: ["lemon", "vinegar"] }),
  "src-crispy-beef-noodles": familyRoles({ protein: ["beef-mince"], carb: ["pasta"], vegetable: ["broccoli", "cabbage", "carrot", "onion"], fat_cooking: ["olive-oil"], sauce: ["gochujang"], flavour_fixed: ["soy", "honey", "oyster-sauce", "garlic"] }),
  "src-mediterranean-wrap": familyRoles({ protein: ["chicken-thigh"], carb: ["tortilla"], vegetable: ["cucumber", "tomato", "lettuce", "onion"], fat: ["feta", "olive-oil"], sauce: ["hummus"], flavour_fixed: ["lemon", "vinegar"] }),
  "src-creamy-chicken-pasta": familyRoles({ protein: ["chicken-thigh"], carb: ["pasta"], vegetable: ["cauliflower", "pumpkin"], sauce: ["cottage", "milk"], fat: ["parmesan", "olive-oil"], flavour_fixed: ["lemon", "bouillon"] }),
  "src-sausage-pepper-pasta": familyRoles({ protein: ["pork-mince"], carb: ["pasta"], vegetable: ["onion", "pepper", "spinach"], sauce: ["tomato-passata", "tomato-paste"], fat: ["cream", "parmesan"], fat_cooking: ["olive-oil"], flavour_fixed: ["garlic"] }),
  "src-honey-lime-steak": familyRoles({ protein: ["beef"], carb: ["rice", "black-beans"], vegetable: ["pepper", "corn"], fat_cooking: ["olive-oil"], sauce: ["salsa"], flavour_fixed: ["lime", "honey", "soy", "lime-juice"] }),
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
    fat_cooking: [1, 1, 1, 1, false, 9],
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
  const measurementStep: RecipeInstruction = {
    id: "step-measure",
    text: "Отмерьте рассчитанные Mise количества ингредиентов для всей готовки.",
    ingredientIds: recipe.ingredients.map((item) => item.id),
    action: "measure",
    dependsOn: [],
  };
  const cookingSteps = recipe.steps
    .filter((source) => !/^На одну базовую порцию отмерьте:/iu.test(source))
    .map((source, index) => ({
      id: `step-${index + 1}`,
      text: source.replace(/\b\d+(?:[.,]\d+)?\s*(?:г|мл|шт\.?)(?!\p{L})/giu, "рассчитанное количество"),
      ingredientIds: names
        .filter(([, name]) => source.toLowerCase().includes(name))
        .map(([id]) => id),
      dependsOn: [index ? `step-${index}` : measurementStep.id],
    }));
  return [measurementStep, ...cookingSteps];
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
  const nutritionRecord = pilotNutritionRecords[recipe.id];
  const editorialAudit = editorialAuditFor(recipe.id, ingredients);
  const sourceNutrition = nutritionRecord.declaredNutrition === undefined ? recipe.macros : nutritionRecord.declaredNutrition;
  const sourceServingRatio = nutritionRecord.miseServingToSourceServingRatio ?? 1;
  const comparisonNutrition = nutritionRecord.comparableToMise && nutritionRecord.quantitativeCoverage === "verified" && sourceNutrition
    ? {
        kcal: round(sourceNutrition.kcal * sourceServingRatio),
        protein: round(sourceNutrition.protein * sourceServingRatio),
        fat: round(sourceNutrition.fat * sourceServingRatio),
        carbs: round(sourceNutrition.carbs * sourceServingRatio),
      }
    : null;
  const nutritionDelta = comparisonNutrition
    ? {
        kcal: round(calculated.kcal - comparisonNutrition.kcal),
        protein: round(calculated.protein - comparisonNutrition.protein),
        fat: round(calculated.fat - comparisonNutrition.fat),
        carbs: round(calculated.carbs - comparisonNutrition.carbs),
      }
    : null;
  const nutritionThresholds: Nutrition | null = comparisonNutrition
    ? {
        kcal: Math.max(50, comparisonNutrition.kcal * 0.1),
        protein: Math.max(5, comparisonNutrition.protein * 0.15),
        fat: Math.max(4, comparisonNutrition.fat * 0.2),
        carbs: Math.max(8, comparisonNutrition.carbs * 0.15),
      }
    : null;
  const needsNutritionReview = !nutritionDelta || !nutritionThresholds ||
    (Object.keys(nutritionDelta) as (keyof Nutrition)[])
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
    sourceNutrition,
    comparisonNutrition,
    legacyEditorialNutrition: recipe.macros,
    miseCalculatedNutrition: calculated,
    nutritionDelta,
    nutritionDeltaKcal: nutritionDelta?.kcal ?? null,
    editorialAudit,
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
  if (!ingredient.scalable) return ingredient.baseAmount;
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

function familyWithCookingFatShare(family: RecipeFamily, share: number): RecipeFamily {
  return {
    ...family,
    ingredients: family.ingredients.map((ingredient) => {
      if (ingredient.role !== "fat_cooking") return ingredient;
      const amount = ingredient.baseAmount * share;
      return {
        ...ingredient,
        baseAmount: amount,
        minAmount: amount,
        preferredMin: amount,
        preferredMax: amount,
        maxAmount: amount,
      };
    }),
  };
}

export function solveRecipeBatch(family: RecipeFamily, portions: { id: string; targetCalories: number; targetProtein?: number; hardExclusions?: string[] }[]) {
  const cookingFats = family.ingredients.filter((ingredient) => ingredient.role === "fat_cooking");
  const totalTargetCalories = portions.reduce((sum, portion) => sum + Math.max(0, portion.targetCalories), 0);
  const equalShare = portions.length ? 1 / portions.length : 0;
  const solved = portions.map((portion) => {
    const share = totalTargetCalories > 0
      ? Math.max(0, portion.targetCalories) / totalTargetCalories
      : equalShare;
    const portionFamily = cookingFats.length
      ? familyWithCookingFatShare(family, share)
      : family;
    return { id: portion.id, variant: solveRecipeFamily(portionFamily, portion) };
  });
  const viable = solved.every((item) => item.variant.viable);
  const totals: Record<string, number> = {};
  if (viable) for (const { variant } of solved) for (const [id, amount] of Object.entries(variant.amounts)) totals[id] = round((totals[id] ?? 0) + amount);
  const sharedCookingTotals = viable && portions.length
    ? Object.fromEntries(
        cookingFats.map((ingredient) => [ingredient.sourceIngredientId, ingredient.baseAmount]),
      )
    : {};
  return {
    familyId: family.id,
    viable,
    portions: solved,
    totals,
    sharedCookingTotals,
    packing: solved.map(({ id, variant }) => ({
      id,
      calories: variant.nutrition.kcal,
      ingredientAmounts: variant.amounts,
    })),
  };
}

export function aggregateCookingAmounts(
  ingredients: Pick<RecipeFamilyIngredient, "sourceIngredientId" | "baseAmount" | "role">[],
  portionAmounts: Record<string, number>[],
  days = 1,
) {
  return Object.fromEntries(
    ingredients.map((ingredient) => {
      if (ingredient.role === "fat_cooking")
        return [ingredient.sourceIngredientId, portionAmounts.length ? ingredient.baseAmount : 0];
      const total = portionAmounts.reduce(
        (sum, amounts) => sum + (amounts[ingredient.sourceIngredientId] ?? 0),
        0,
      );
      return [ingredient.sourceIngredientId, round(total * Math.max(0, days))];
    }),
  );
}

export function materializeInstructions(
  family: RecipeFamily,
  amounts: Record<string, number>,
  displayNames: Record<string, string> = {},
) {
  return family.miseInstructions.map((step) => {
    if (step.action !== "measure") return step.text;
    const lines = family.ingredients.map((ingredient) => {
      const canonical = canonicalIngredients[ingredient.canonicalIngredientId];
      const unit = ingredient.unit === "piece" ? "шт." : ingredient.unit === "ml" ? "мл" : "г";
      const name = displayNames[ingredient.sourceIngredientId] ?? canonical.canonicalName;
      return `${name} — ${round(amounts[ingredient.sourceIngredientId] ?? ingredient.baseAmount)} ${unit}`;
    });
    return `${step.text} ${lines.join("; ")}.`;
  });
}
