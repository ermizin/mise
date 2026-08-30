export type RecipeIngredientRole =
  | "protein"
  | "carb"
  | "vegetable"
  | "fat"
  | "fat_cooking" // Fixed against personal calorie targeting; counted once per physical cooking run.
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
        /** Deliberately absent from solver quantities, never silently dropped. */
        skippedOptionalSourceIngredients?: string[];
        /** Non-metric source quantities that were converted under a stated basis. */
        inferredMeasurements?: { sourceName: string; amount: number; unit: RecipeUnit; basis: string }[];
      }
    | {
        source: "curated_source_audit";
        reviewedAt: string;
        sourceIngredientCount: number;
        decisions: SourceIngredientDisposition[];
      }
    | {
        source: "recipe_catalog";
        reviewedAt: string;
        sourceIngredientCount: number;
        note: string;
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
  unit: {
    sensibleUnit: RecipeUnit;
    gramsPerUnit: number;
    roundTo: number;
    /** A count whose partial unit would make the recipe structurally unsound. */
    structuralDiscrete?: boolean;
  };
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
  /**
   * Largest safe multiple of the editorial base recipe that can be cooked in
   * one vessel. Values require an editor-confirmed vessel/geometry mapping.
   */
  geometryLockedMax?: number;
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
  targetCarbs?: number;
  targetFat?: number;
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
const averageReference = (recordId: string, description: string, note = "Усреднённый профиль для редакционного расчёта; для брендового продукта сверить этикетку."): CanonicalIngredient["reference"] => ({
  provider: "USDA FoodData Central, Mise editorial average",
  checkedAt,
  note,
  sourceUrl: "https://fdc.nal.usda.gov/data-documentation/",
  recordId: `editorial-average:${recordId}`,
  dataType: "interpolated",
  description,
});

const nutritionReferences: Record<string, CanonicalIngredient["reference"]> = {
  "bbq-sauce": fdcReference("174523", "Sauce, barbecue", "Упаковка может заметно отличаться; перед готовкой сверить этикетку."),
  beef: fdcReference("174055", "Beef, top sirloin, steak, separable lean only, raw"),
  "beef-mince": fdcReference("173110", "Beef, ground, 93% lean meat / 7% fat, raw"),
  berries: fdcReference("171711", "Blueberries, raw", "Расчётный профиль черники; другие ягоды требуют отдельного редакционного профиля."),
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
  yogurt: fdcReference("170903", "Yogurt, Greek, plain, lowfat", "Расчётный профиль натурального греческого йогурта около 2%."),
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
  eggplant: averageReference("eggplant-raw", "Eggplant, raw"),
  arugula: averageReference("arugula-raw", "Arugula, raw"),
  asparagus: averageReference("asparagus-raw", "Asparagus, raw"),
  "baby-corn": averageReference("baby-corn-raw", "Baby corn, raw"),
  "beetroot-cooked": averageReference("beetroot-cooked", "Beets, cooked"),
  "pasta-cooked": averageReference("pasta-cooked", "Pasta, cooked"),
  couscous: averageReference("couscous-dry", "Couscous, dry"),
  bulgur: averageReference("bulgur-dry", "Bulgur, dry"),
  "giant-couscous": averageReference("giant-couscous-dry", "Pearl couscous, dry"),
  cornmeal: averageReference("cornmeal-dry", "Cornmeal, dry"),
  breadcrumbs: averageReference("breadcrumbs-dry", "Bread crumbs, dry"),
  "puff-pastry": labelReference("label:puff-pastry", "Puff pastry", "Жирность заметно зависит от марки; используется средний профиль, этикетка обязательна."),
  halloumi: labelReference("label:halloumi", "Halloumi", "Соль и жирность зависят от марки; используется средний профиль, этикетка обязательна."),
  mascarpone: labelReference("label:mascarpone", "Mascarpone", "Жирность зависит от марки; используется средний профиль, этикетка обязательна."),
  "creme-fraiche": labelReference("label:creme-fraiche", "Crème fraîche", "Жирность зависит от марки; используется средний профиль, этикетка обязательна."),
  "coconut-milk": labelReference("label:coconut-milk-canned", "Coconut milk, canned", "КБЖУ консервированного кокосового молока зависят от марки; этикетка обязательна."),
  "creamed-coconut": labelReference("label:creamed-coconut", "Creamed coconut", "КБЖУ зависят от марки; этикетка обязательна."),
  "white-beans": averageReference("white-beans-cooked", "White beans, cooked"),
  "broad-beans": averageReference("broad-beans-cooked", "Broad beans, cooked"),
  "green-beans": averageReference("green-beans-raw", "Green beans, raw"),
  "hash-browns": labelReference("label:frozen-hash-browns", "Hash browns, frozen", "Масло и соль зависят от марки; используется средний профиль, этикетка обязательна."),
  pomegranate: averageReference("pomegranate-arils", "Pomegranate arils"),
  apricot: averageReference("apricot-raw", "Apricots, raw"),
  mango: averageReference("mango-raw", "Mango, raw"),
  cherries: averageReference("cherries-raw", "Cherries, raw"),
  "pine-nuts": averageReference("pine-nuts", "Pine nuts"),
  walnuts: averageReference("walnuts", "Walnuts"),
  almonds: averageReference("almonds", "Almonds"),
  peanuts: averageReference("peanuts", "Peanuts"),
  "dried-cranberries": labelReference("label:dried-cranberries", "Cranberries, dried and sweetened", "Добавленный сахар зависит от марки; этикетка обязательна."),
  "dark-chocolate": labelReference("label:dark-chocolate", "Dark chocolate", "Процент какао и КБЖУ зависят от марки; этикетка обязательна."),
  "pork-fillet": averageReference("pork-tenderloin-raw", "Pork tenderloin, raw"),
  "pork-shoulder": averageReference("pork-shoulder-raw", "Pork shoulder, raw"),
  sausage: labelReference("label:pork-sausage", "Pork sausage", "Состав и жирность зависят от марки; используется средний профиль, этикетка обязательна."),
  "chicken-sausage": labelReference("label:chicken-sausage", "Chicken sausage", "Состав и жирность зависят от марки; используется средний профиль, этикетка обязательна."),
  bacon: labelReference("label:bacon", "Bacon", "Состав и жирность зависят от марки; используется средний профиль, этикетка обязательна."),
  cod: averageReference("cod-raw", "Cod, raw"),
  "prawns-cooked": averageReference("prawns-cooked", "Prawns, cooked"),
  "tuna-canned": averageReference("tuna-canned-water", "Tuna, canned in water, drained"),
  "salmon-cooked": averageReference("salmon-cooked", "Salmon, cooked"),
  "beef-stewing": averageReference("beef-stewing-raw", "Beef, stewing, lean, raw"),
  lamb: averageReference("lamb-lean-raw", "Lamb, lean, raw"),
  "orange-juice": averageReference("orange-juice", "Orange juice"),
  ghee: labelReference("label:ghee", "Ghee", "КБЖУ зависят от марки; используется средний профиль, этикетка обязательна."),
  "red-wine": averageReference("red-wine", "Red table wine"),
  "protein-powder": labelReference("label:protein-powder", "Protein powder", "Белок и подсластители зависят от марки; используется средний профиль, этикетка обязательна."),
  "casein-powder": labelReference("label:casein-powder", "Casein protein powder", "Белок и подсластители зависят от марки; используется средний профиль, этикетка обязательна."),
  "corn-chex": labelReference("brand:corn-chex", "Corn Chex cereal", "Брендовый профиль; перед готовкой сверить актуальную этикетку."),
  maseca: labelReference("brand:maseca", "Maseca instant corn masa flour", "Брендовый профиль; перед готовкой сверить актуальную этикетку."),
  granola: labelReference("label:granola", "Granola", "Состав зависит от смеси и марки; используется средний профиль, этикетка обязательна."),
  "mixed-vegetables": labelReference("label:mixed-vegetables-frozen", "Mixed vegetables, frozen", "Состав смеси зависит от упаковки; используется средний профиль, этикетка обязательна."),
  "fish-pie-mix": labelReference("label:fish-pie-mix", "Mixed fish for pie", "Соотношение видов рыбы зависит от упаковки; используется средний профиль, этикетка обязательна."),
  "buffalo-sauce": labelReference("label:buffalo-sauce", "Buffalo sauce", "Состав зависит от марки; используется средний профиль, этикетка обязательна."),
  "chili-garlic-oil": labelReference("label:chili-garlic-oil", "Crunchy chilli garlic oil", "Масло и сухие компоненты зависят от марки; используется средний профиль, этикетка обязательна."),
  pesto: labelReference("label:pesto", "Pesto", "Сыр, орехи и масло зависят от марки; используется средний профиль, этикетка обязательна."),
  "fish-sauce": labelReference("label:fish-sauce", "Fish sauce", "Соль и сахар зависят от марки; используется средний профиль, этикетка обязательна."),
  dressing: labelReference("label:salad-dressing", "Prepared salad dressing", "Состав зависит от вида и марки; используется средний профиль, этикетка обязательна."),
  "rice-cake": labelReference("label:rice-cake", "Rice cakes", "Масса и добавки зависят от марки; используется средний профиль, этикетка обязательна."),
  kimchi: labelReference("label:kimchi", "Kimchi", "Состав и соль зависят от марки; используется средний профиль, этикетка обязательна."),
  bread: labelReference("label:bread", "Bread", "Рецептура и масса ломтика зависят от марки; используется средний профиль, этикетка обязательна."),
  splenda: labelReference("brand:splenda", "Splenda granulated sweetener", "Брендовый профиль; перед готовкой сверить актуальную этикетку."),
  "beef-meatballs": labelReference("label:beef-meatballs", "Prepared beef meatballs", "Состав фарша и связующих зависит от продукта; используется средний профиль, этикетка обязательна."),
  "popcorn-chicken": labelReference("label:popcorn-chicken", "Breaded popcorn chicken", "Панировка и масло зависят от марки; используется средний профиль, этикетка обязательна."),
  "seed-mix": labelReference("label:seed-mix", "Mixed seeds", "Соотношение семян зависит от смеси; используется средний профиль, этикетка обязательна."),
  "mushrooms-dried": averageReference("mushrooms-dried", "Mushrooms, dried"),
  "tikka-sauce": labelReference("label:tikka-masala-sauce", "Tikka masala sauce", "Сливки, масло и сахар зависят от марки; используется средний профиль, этикетка обязательна."),
  "curry-paste": labelReference("label:curry-paste", "Prepared curry paste", "Состав зависит от вида и марки; используется средний профиль, этикетка обязательна."),
  "taco-seasoning": labelReference("label:taco-seasoning", "Taco seasoning", "Соль, сахар и крахмал зависят от марки; используется средний профиль, этикетка обязательна."),
  anchovies: averageReference("anchovies-canned", "Anchovies, canned in oil, drained"),
  "pork-mince-80": averageReference("pork-mince-80", "Pork, ground, 80% lean / 20% fat, raw"),
  cashews: averageReference("cashews", "Cashew nuts"),
  "bulgur-quinoa-mix": averageReference("bulgur-quinoa-mix", "Bulgur and quinoa dry mix"),
  "egg-yolk": averageReference("egg-yolk", "Egg yolk, raw"),
  "vegetarian-mince": labelReference("label:vegetarian-mince", "Vegetarian mince", "Используется средний профиль растительного фарша."),
  "whipped-cream": labelReference("label:whipped-cream", "Whipped cream", "Используется средний профиль готовых взбитых сливок."),
  "mango-chutney": labelReference("label:mango-chutney", "Mango chutney", "Используется средний профиль мангового чатни."),
  "soy-milk": labelReference("label:soy-milk", "Soy milk", "Используется средний профиль соевого молока."),
  orange: averageReference("orange", "Orange, raw"),
  peaches: averageReference("peaches", "Peaches, raw"),
  radish: averageReference("radish", "Radishes, raw"),
  "miso-paste": labelReference("label:red-miso", "Red miso paste", "Используется средний профиль красной мисо-пасты."),
  "sun-dried-tomatoes": labelReference("label:sun-dried-tomatoes", "Sun-dried tomatoes", "Используется средний профиль вяленых томатов."),
  "trail-mix": labelReference("label:trail-mix", "Raisin and nut mix", "Используется средний профиль смеси изюма и орехов."),
  "pomegranate-molasses": labelReference("label:pomegranate-molasses", "Pomegranate molasses", "Используется средний профиль гранатовой мелассы."),
  "protein-pancake-mix": labelReference("label:protein-pancake-mix", "Protein pancake mix", "Используется средний профиль протеиновой смеси для блинов."),
  "cream-cheese-frosting": labelReference("label:cream-cheese-frosting", "Cream cheese frosting", "Используется средний профиль глазури из творожного сыра."),
  "mustard-seeds": averageReference("mustard-seeds", "Mustard seeds"),
  charcuterie: labelReference("label:prosciutto-salami", "Prosciutto or salami", "Используется средний профиль мясной нарезки."),
};

type IngredientSeed = [string, string, string, CanonicalIngredient["state"], Nutrition, number?, string[]?];
const n = (kcal: number, protein: number, fat: number, carbs: number): Nutrition => ({ kcal, protein, fat, carbs });
const structuralDiscreteIngredientIds = new Set([
  "egg",
  "egg-yolk",
  "tortilla",
  "corn-tortilla",
]);
const ingredientSeeds: IngredientSeed[] = [
  ["bbq-sauce", "Соус BBQ", "sauce", "processed", n(172, 0.82, 0.63, 40.77)],
  ["beef", "Говядина постная", "meat", "raw", n(131, 22.09, 4.08, 0)],
  ["beef-mince", "Говяжий фарш 93/7", "meat", "raw", n(152, 20.85, 7, 0)],
  ["berries", "Черника", "fruit", "raw", n(57, 0.74, 0.33, 14.49)],
  ["black-beans", "Фасоль чёрная", "legume", "cooked", n(132, 8.86, 0.54, 23.71)],
  ["broccoli", "Брокколи", "vegetable", "raw", n(34, 2.82, 0.37, 6.64), 350],
  ["broth", "Бульон", "sauce", "processed", n(6, 0.64, 0.21, 0.44), 10],
  ["bouillon", "Сухой бульон", "sauce", "processed", n(198, 14.6, 4.7, 23.5), 10, ["soy", "gluten"]],
  ["buckwheat", "Гречка сухая", "grain", "raw", n(346, 11.73, 2.71, 74.95)],
  ["cabbage", "Капуста", "vegetable", "raw", n(25, 1.28, 0.1, 5.8)],
  ["carrot", "Морковь", "vegetable", "raw", n(41, 0.93, 0.24, 9.58), 80],
  ["cauliflower", "Цветная капуста", "vegetable", "raw", n(25, 1.92, 0.28, 4.97)],
  ["cheese", "Полутвёрдый сыр (обычный)", "dairy", "processed", n(403, 22.87, 33.31, 3.37), 20, ["milk"]],
  ["chicken", "Куриная грудка", "meat", "raw", n(120, 22.5, 2.62, 0), 174],
  ["chicken-thigh", "Куриное бедро без кожи", "meat", "raw", n(121, 19.66, 4.12, 0), 100],
  ["corn", "Кукуруза", "vegetable", "cooked", n(94, 3.11, 0.74, 22.33)],
  ["cottage", "Творог 4–5%", "dairy", "processed", n(98, 11.12, 4.3, 3.38), 1, ["milk"]],
  ["cream", "Сливки 10%", "dairy", "processed", n(120, 2.9, 10, 4.5), 1, ["milk"]],
  ["cream-cheese", "Творожный сыр (обычный)", "dairy", "processed", n(350, 6.15, 34.44, 5.52), 1, ["milk"]],
  ["cucumber", "Огурец", "vegetable", "raw", n(15, 0.65, 0.11, 3.63), 200],
  ["egg", "Куриное яйцо", "egg", "raw", n(143, 12.56, 9.51, 0.72), 50, ["egg"]],
  ["feta", "Фета (обычная)", "dairy", "processed", n(265, 14.21, 21.49, 3.88), 1, ["milk"]],
  ["gochujang", "Паста кочудян", "sauce", "processed", n(210, 5, 3, 43), 1, ["soy", "gluten"]],
  ["greens", "Зелень", "vegetable", "raw", n(36, 2.97, 0.79, 6.33), 30],
  ["ginger", "Имбирь", "vegetable", "raw", n(80, 1.82, 0.75, 17.77), 5],
  ["honey", "Мёд", "sweetener", "processed", n(304, 0.3, 0, 82.4)],
  ["hot-sauce", "Острый соус", "sauce", "processed", n(93, 1.93, 0.93, 19.16)],
  ["hummus", "Хумус", "legume", "processed", n(237, 7.78, 17.82, 15), 1, ["sesame"]],
  ["jalapeno", "Халапеньо", "vegetable", "raw", n(29, 0.91, 0.37, 6.5), 14],
  ["lettuce", "Салат романо", "vegetable", "raw", n(17, 1.23, 0.3, 3.29), 15],
  ["lime", "Лайм", "fruit", "raw", n(30, 0.7, 0.2, 10.54), 70],
  ["mayonnaise", "Майонез", "fat", "processed", n(680, 0.96, 74.85, 0.57), 1, ["egg"]],
  ["milk", "Молоко 2%", "dairy", "processed", n(50, 3.3, 1.98, 4.8), 1, ["milk"]],
  ["mushrooms", "Шампиньоны", "vegetable", "raw", n(22, 3.09, 0.34, 3.26)],
  ["oats", "Овсяные хлопья", "grain", "raw", n(389, 16.89, 6.9, 66.27), 1, ["gluten"]],
  ["onion", "Репчатый лук", "vegetable", "raw", n(40, 1.1, 0.1, 9.34), 110],
  ["parmesan", "Пармезан (обычный)", "dairy", "processed", n(392, 35.75, 25, 3.22), 30, ["milk"]],
  ["pasta", "Макароны сухие", "grain", "raw", n(371, 13.04, 1.51, 74.67), 18, ["gluten"]],
  ["peas", "Зелёный горошек", "legume", "cooked", n(84, 5.36, 0.22, 15.63)],
  ["pepper", "Сладкий перец", "vegetable", "raw", n(26, 0.99, 0.3, 6.03), 150],
  ["pickles", "Маринованные огурцы", "vegetable", "processed", n(12, 0.5, 0.3, 2.4)],
  ["pork-mince", "Свиной фарш 90/10", "meat", "raw", n(176, 20.45, 10, 0.1)],
  ["potato", "Картофель", "vegetable", "raw", n(77, 2.05, 0.09, 17.49), 173],
  ["pumpkin", "Тыква", "vegetable", "raw", n(26, 1, 0.1, 6.5), 900],
  ["red-beans", "Красная фасоль", "legume", "cooked", n(127, 8.7, 0.5, 22.8)],
  ["rice", "Рис сухой", "grain", "raw", n(365, 7.13, 0.66, 79.95)],
  ["rice-cooked", "Рис готовый", "grain", "cooked", n(130, 2.69, 0.28, 28.17)],
  ["roasted-pepper", "Запечённый перец", "vegetable", "cooked", n(28, 0.92, 0.2, 6.7), 150],
  ["salmon", "Лосось", "fish", "raw", n(208, 20.42, 13.42, 0), 150, ["fish"]],
  ["salsa", "Томатная сальса", "sauce", "processed", n(29, 1.52, 0.17, 6.64)],
  ["soy", "Соевый соус", "sauce", "processed", n(53, 8.14, 0.57, 4.93), 1, ["soy", "gluten"]],
  ["spinach", "Шпинат", "vegetable", "raw", n(23, 2.86, 0.39, 3.63)],
  ["sweet-potato", "Батат", "vegetable", "raw", n(86, 1.57, 0.05, 20.12), 180],
  ["tomato", "Томат", "vegetable", "raw", n(18, 0.88, 0.2, 3.89), 120],
  ["tomato-passata", "Протёртые томаты", "vegetable", "processed", n(38, 1.65, 0.21, 8.98)],
  ["tomato-paste", "Томатная паста", "sauce", "processed", n(82, 4.32, 0.47, 18.91)],
  ["tortilla", "Пшеничная тортилья", "grain", "processed", n(325, 8.7, 7.1, 55.6), 60, ["gluten"]],
  ["turkey-mince", "Фарш индейки", "meat", "raw", n(148, 19.66, 7.66, 0)],
  ["yogurt", "Греческий йогурт 2%", "dairy", "processed", n(73, 9.95, 1.92, 3.94), 1, ["milk"]],
  ["zucchini", "Кабачок", "vegetable", "raw", n(17, 1.21, 0.32, 3.11), 196],
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
  ["red-cabbage", "Краснокочанная капуста", "vegetable", "raw", n(31, 1.43, 0.16, 7.37), 450],
  ["active-dry-yeast", "Сухие активные дрожжи", "leavener", "processed", n(325, 40.4, 7.61, 41.2)],
  ["olives", "Маслины", "vegetable", "processed", n(116, 0.84, 10.9, 6.04), 4],
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
  ["lemon", "Лимонный сок", "fruit", "raw", n(22, 0.35, 0.24, 6.9), 30],
  ["lime-juice", "Сок лайма", "fruit", "raw", n(25, 0.42, 0.07, 8.42), 30],
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
  ["eggplant", "Баклажан", "vegetable", "raw", n(25, 0.98, 0.18, 5.88), 458],
  ["arugula", "Руккола", "vegetable", "raw", n(25, 2.58, 0.66, 3.65), 30],
  ["asparagus", "Спаржа", "vegetable", "raw", n(20, 2.2, 0.12, 3.88)],
  ["baby-corn", "Мини-кукуруза", "vegetable", "raw", n(26, 2.6, 0.5, 3.9)],
  ["beetroot-cooked", "Свёкла готовая", "vegetable", "cooked", n(44, 1.68, 0.18, 9.96), 80],
  ["pasta-cooked", "Макароны готовые", "grain", "cooked", n(158, 5.8, 0.93, 30.9), 1, ["gluten"]],
  ["couscous", "Кускус сухой", "grain", "raw", n(376, 12.76, 0.64, 77.43), 1, ["gluten"]],
  ["bulgur", "Булгур сухой", "grain", "raw", n(342, 12.29, 1.33, 75.87), 1, ["gluten"]],
  ["giant-couscous", "Жемчужный кускус сухой", "grain", "raw", n(376, 12.8, 0.6, 77.4), 1, ["gluten"]],
  ["cornmeal", "Кукурузная мука", "grain", "raw", n(370, 7.1, 1.8, 79.4)],
  ["breadcrumbs", "Панировочные сухари", "grain", "processed", n(395, 13.4, 5.3, 72), 1, ["gluten"]],
  ["puff-pastry", "Слоёное тесто", "grain", "raw", n(551, 7.3, 38.6, 45.1), 1, ["gluten", "milk"]],
  ["halloumi", "Халлуми", "dairy", "processed", n(321, 22.6, 25, 2.2), 1, ["milk"]],
  ["mascarpone", "Маскарпоне", "dairy", "processed", n(429, 7.1, 42.9, 3.6), 1, ["milk"]],
  ["creme-fraiche", "Крем-фреш", "dairy", "processed", n(292, 2.1, 30, 2.8), 1, ["milk"]],
  ["coconut-milk", "Кокосовое молоко консервированное", "dairy-alternative", "processed", n(230, 2.3, 23.8, 5.5)],
  ["creamed-coconut", "Кокосовая паста", "fat", "processed", n(684, 6.9, 69.1, 6)],
  ["white-beans", "Белая фасоль готовая", "legume", "cooked", n(139, 9.7, 0.4, 25.1)],
  ["broad-beans", "Бобы готовые", "legume", "cooked", n(110, 7.6, 0.4, 19.7)],
  ["green-beans", "Стручковая фасоль", "vegetable", "raw", n(31, 1.83, 0.22, 6.97)],
  ["hash-browns", "Хашбрауны замороженные", "potato", "processed", n(166, 2.4, 6.8, 25)],
  ["pomegranate", "Зёрна граната", "fruit", "raw", n(83, 1.67, 1.17, 18.7)],
  ["apricot", "Абрикос", "fruit", "raw", n(48, 1.4, 0.39, 11.1), 35],
  ["mango", "Манго", "fruit", "raw", n(60, 0.82, 0.38, 15), 200],
  ["cherries", "Вишня или черешня", "fruit", "raw", n(63, 1.06, 0.2, 16)],
  ["pine-nuts", "Кедровые орехи", "nut", "raw", n(673, 13.7, 68.4, 13.1), 1, ["nuts"]],
  ["walnuts", "Грецкие орехи", "nut", "raw", n(654, 15.2, 65.2, 13.7), 1, ["nuts"]],
  ["almonds", "Миндаль", "nut", "raw", n(579, 21.2, 49.9, 21.6), 1, ["nuts"]],
  ["peanuts", "Арахис", "nut", "raw", n(567, 25.8, 49.2, 16.1), 1, ["peanuts"]],
  ["dried-cranberries", "Клюква сушёная", "fruit", "processed", n(325, 0.1, 1.4, 82.4)],
  ["dark-chocolate", "Тёмный шоколад", "sweetener", "processed", n(598, 7.8, 42.6, 45.9), 1, ["milk"]],
  ["pork-fillet", "Свиная вырезка", "meat", "raw", n(120, 21.2, 3.5, 0)],
  ["pork-shoulder", "Свиная лопатка", "meat", "raw", n(186, 17.4, 12.4, 0)],
  ["sausage", "Свиные колбаски", "meat", "processed", n(301, 12, 27, 2), 75, ["gluten"]],
  ["chicken-sausage", "Куриные колбаски", "meat", "processed", n(172, 19, 10, 2), 1, ["gluten"]],
  ["bacon", "Бекон", "meat", "processed", n(417, 12.6, 42, 1.4), 25],
  ["cod", "Треска", "fish", "raw", n(82, 17.8, 0.7, 0), 1, ["fish"]],
  ["prawns-cooked", "Креветки готовые", "seafood", "cooked", n(99, 24, 0.3, 0.2), 1, ["crustaceans"]],
  ["tuna-canned", "Тунец консервированный в воде", "fish", "processed", n(116, 25.5, 0.8, 0), 1, ["fish"]],
  ["salmon-cooked", "Лосось готовый", "fish", "cooked", n(206, 22.1, 12.4, 0), 1, ["fish"]],
  ["beef-stewing", "Говядина для тушения", "meat", "raw", n(137, 20.4, 6.3, 0)],
  ["lamb", "Баранина постная", "meat", "raw", n(143, 20.6, 6.5, 0)],
  ["orange-juice", "Апельсиновый сок", "fruit", "processed", n(45, 0.7, 0.2, 10.4)],
  ["ghee", "Топлёное масло", "fat", "processed", n(876, 0, 99.5, 0), 1, ["milk"]],
  ["red-wine", "Красное сухое вино", "sauce", "processed", n(85, 0.1, 0, 2.6)],
  ["protein-powder", "Протеиновый порошок", "protein", "processed", n(400, 80, 6, 8), 1, ["milk"]],
  ["casein-powder", "Казеиновый протеин", "protein", "processed", n(370, 78, 3, 10), 1, ["milk"]],
  ["corn-chex", "Хлопья Corn Chex", "grain", "processed", n(357, 6.7, 2.4, 84.5)],
  ["maseca", "Кукурузная мука Maseca", "grain", "processed", n(364, 7.6, 3.8, 76.4)],
  ["granola", "Гранола", "grain", "processed", n(471, 10, 20, 64), 1, ["gluten", "nuts"]],
  ["mixed-vegetables", "Овощная смесь замороженная", "vegetable", "processed", n(65, 3, 0.5, 12), 95],
  ["fish-pie-mix", "Рыбная смесь", "fish", "raw", n(100, 20, 2, 0), 1, ["fish"]],
  ["buffalo-sauce", "Соус баффало", "sauce", "processed", n(117, 1, 10, 5), 1, ["milk"]],
  ["chili-garlic-oil", "Хрустящее чили-масло", "sauce", "processed", n(650, 3, 65, 12), 1, ["soy", "sesame"]],
  ["pesto", "Песто", "sauce", "processed", n(430, 5, 42, 8), 1, ["milk", "nuts"]],
  ["fish-sauce", "Рыбный соус", "sauce", "processed", n(35, 5, 0, 3), 1, ["fish"]],
  ["dressing", "Готовая салатная заправка", "sauce", "processed", n(300, 1, 28, 12), 1, ["egg", "mustard"]],
  ["rice-cake", "Рисовый хлебец", "grain", "processed", n(387, 8, 2.8, 81.5)],
  ["kimchi", "Кимчи", "vegetable", "processed", n(15, 1.1, 0.5, 2.4)],
  ["bread", "Хлеб", "grain", "processed", n(265, 9, 3.2, 49), 65, ["gluten"]],
  ["splenda", "Подсластитель Splenda", "sweetener", "processed", n(250, 0, 0, 100)],
  ["beef-meatballs", "Говяжьи тефтели готовые", "meat", "processed", n(250, 18, 18, 7), 40, ["gluten"]],
  ["popcorn-chicken", "Куриные кусочки в панировке", "meat", "processed", n(300, 17, 18, 21), 1, ["gluten"]],
  ["seed-mix", "Смесь семян", "seed", "raw", n(570, 20, 48, 20), 1, ["sesame"]],
  ["mushrooms-dried", "Грибы сушёные", "vegetable", "processed", n(296, 9.6, 1, 75.4)],
  ["tikka-sauce", "Соус тикка масала", "sauce", "processed", n(140, 3, 9, 12), 1, ["milk"]],
  ["curry-paste", "Карри-паста", "sauce", "processed", n(180, 4, 12, 14), 1, ["shrimp"]],
  ["taco-seasoning", "Смесь специй для тако", "sauce", "processed", n(280, 8, 6, 50)],
  ["anchovies", "Анчоусы", "fish", "processed", n(210, 29, 9.7, 0), 4, ["fish"]],
  ["pork-mince-80", "Свиной фарш 80/20", "meat", "raw", n(254, 17.9, 20, 0)],
  ["cashews", "Кешью", "nut", "raw", n(553, 18.2, 43.9, 30.2), 1, ["nuts"]],
  ["bulgur-quinoa-mix", "Смесь булгура и киноа", "grain", "raw", n(355, 13.2, 3.7, 70), 1, ["gluten"]],
  ["egg-yolk", "Яичный желток", "egg", "raw", n(322, 15.9, 26.5, 3.6), 17, ["egg"]],
  ["vegetarian-mince", "Растительный фарш", "protein", "processed", n(170, 20, 7, 8), 1, ["soy"]],
  ["whipped-cream", "Взбитые сливки", "dairy", "processed", n(150, 3, 12, 10), 1, ["milk"]],
  ["mango-chutney", "Манговый чатни", "sauce", "processed", n(250, 1, 0.5, 60)],
  ["soy-milk", "Соевое молоко", "dairy-alternative", "processed", n(43, 2.9, 1.6, 4.9), 1, ["soy"]],
  ["orange", "Апельсин", "fruit", "raw", n(47, 0.9, 0.1, 11.8), 131],
  ["peaches", "Персик", "fruit", "raw", n(39, 0.9, 0.3, 9.5), 150],
  ["radish", "Редис", "vegetable", "raw", n(16, 0.7, 0.1, 3.4), 20],
  ["miso-paste", "Красная мисо-паста", "sauce", "processed", n(199, 12, 6, 26), 1, ["soy"]],
  ["sun-dried-tomatoes", "Вяленые томаты", "vegetable", "processed", n(258, 14, 3, 56), 7],
  ["trail-mix", "Смесь изюма и орехов", "snack", "processed", n(480, 12, 30, 50), 1, ["nuts"]],
  ["pomegranate-molasses", "Гранатовая меласса", "sauce", "processed", n(286, 0, 0, 71)],
  ["protein-pancake-mix", "Протеиновая смесь для блинов", "grain", "processed", n(360, 35, 6, 45), 1, ["milk", "gluten"]],
  ["cream-cheese-frosting", "Глазурь из творожного сыра", "dairy", "processed", n(350, 3, 22, 42), 1, ["milk"]],
  ["mustard-seeds", "Семена горчицы", "seed", "raw", n(508, 26, 36, 28), 1, ["mustard"]],
  ["charcuterie", "Прошутто или салями", "meat", "processed", n(300, 20, 24, 2)],
];

const densityByLegacyId: Record<string, number> = {
  "bbq-sauce": 1.13,
  "active-dry-yeast": 0.64,
  broccoli: 0.38,
  broth: 1,
  "brown-sugar": 0.92,
  bouillon: 0.8,
  butter: 0.91,
  "canola-oil": 0.91,
  cheese: 0.47,
  "chili-garlic-oil": 0.95,
  "coconut-oil": 0.91,
  "coconut-milk": 1.01,
  cream: 1.01,
  "creamed-coconut": 0.95,
  "creme-fraiche": 1.01,
  dressing: 1.02,
  "fish-sauce": 1.2,
  ghee: 0.91,
  ginger: 0.56,
  greens: 0.25,
  "heavy-cream": 0.99,
  honey: 1.4,
  "hot-sauce": 1,
  ketchup: 1.13,
  lemon: 1.03,
  "lime-juice": 1.03,
  "maple-syrup": 1.31,
  mayonnaise: 0.92,
  mascarpone: 1.02,
  milk: 1.03,
  "mixed-vegetables": 0.6,
  mustard: 1.07,
  "oat-flour": 0.38,
  "olive-oil": 0.9,
  onion: 0.67,
  "oyster-sauce": 1.2,
  "peanut-butter": 1.08,
  pesto: 0.98,
  salsa: 1,
  breadcrumbs: 0.45,
  "pine-nuts": 0.56,
  "red-wine": 0.99,
  "rice-cooked": 0.78,
  "sesame-oil": 0.91,
  "sesame-seeds": 0.6,
  soy: 1.16,
  "sour-cream": 1.01,
  "teriyaki-sauce": 1.16,
  "tikka-sauce": 1.05,
  "tomato-passata": 1.04,
  "tomato-sauce": 1.04,
  vinegar: 1,
  "vegetable-oil": 0.92,
  "vegetable-broth": 0.92,
  "sunflower-oil": 0.91,
  "wheat-flour": 0.5,
  "white-sugar": 0.83,
  "whole-milk": 1.03,
  yogurt: 1.03,
  almonds: 0.45,
  "curry-paste": 1.1,
  capers: 0.57,
  applesauce: 1.02,
  raisins: 0.64,
  "mango-chutney": 1.25,
  "soy-milk": 1.02,
  "miso-paste": 1.1,
  "pomegranate-molasses": 1.35,
  "cream-cheese-frosting": 1.05,
  "mustard-seeds": 0.7,
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
      unit: {
        sensibleUnit: gramsPerUnit > 1 ? "piece" : densityByLegacyId[legacyId] ? "ml" : "g",
        gramsPerUnit,
        roundTo: gramsPerUnit > 1 ? 0.1 : 5,
        structuralDiscrete: structuralDiscreteIngredientIds.has(legacyId),
      },
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
    .replace(/^\/\s*/, "")
    .replace(/^\d+(?:\.\d+)?\s*(?:lb|oz|pint)\s*(?:\d+(?:\.\d+)?\s*(?:lb|oz))?\s+/, "")
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
  "2% cottage cheese": "cottage",
  "fat-free greek yogurt": "yogurt",
  "full fat greek yogurt": "yogurt",
  "greek yogurt at room temperature": "yogurt",
  "bio yogurt": "yogurt",
  "pot bio yogurt": "yogurt",
  "pot plain bio yogurt": "yogurt",
  "light feta cheese": "feta",
  "soured cream": "sour-cream",
  "soured cream to serve": "sour-cream",
  "monterrey jack cheese": "cheese",
  "shredded monterey cheese": "cheese",
  "grated cheddar to serve": "cheese",
  "handful of grated cheddar cheese": "cheese",
  "slices burger cheese": "cheese",
  "vegetarian mature cheddar grated": "cheese",
  "parmesan or vegetarian alternative": "parmesan",
  "parmesan or vegetarian equivalent": "parmesan",
  "parmesan to serve": "parmesan",
  "tub mascarpone": "mascarpone",
  "bananas peeled": "banana",
  aubergine: "eggplant",
  "big handful rocket": "arugula",
  "big handfuls of rocket": "arugula",
  "handfuls rocket": "arugula",
  "baby spring mix": "arugula",
  "cavolo nero shredded": "kale",
  "curly kale": "kale",
  "kale shredded": "kale",
  "frozen rice": "rice-cooked",
  "cooked brown rice": "rice-cooked",
  "cooked brown rice to serve": "rice-cooked",
  "cooked rice (we used brown basmati)": "rice-cooked",
  "cooked rice to serve (optional)": "rice-cooked",
  "low-salt soy sauce": "soy",
  "malt vinegar": "vinegar",
  "english mustard": "mustard",
  "english mustard powder": "mustard",
  "dijon or english mustard": "mustard",
  "wholegrain mustard": "mustard",
  "vanilla protein powder": "protein-powder",
  "vanilla whey protein": "protein-powder",
  "vanilla whey protein powder": "protein-powder",
  "vanilla casein protein": "casein-powder",
  "vanilla casein protein powder": "casein-powder",
  "corn chex": "corn-chex",
  "ground corn chex": "corn-chex",
  maseca: "maseca",
  "dark chocolate": "dark-chocolate",
  "dark chocolate chips": "dark-chocolate",
  "mini chocolate chips": "dark-chocolate",
  "chocolate chips": "dark-chocolate",
  "chocolate chips ⁣⁣": "dark-chocolate",
  "frozen shredded hash browns": "hash-browns",
  "frozen shredded hash browns ⁣": "hash-browns",
  "can coconut milk": "coconut-milk",
  "canned coconut milk": "coconut-milk",
  "creamed coconut": "creamed-coconut",
  "crème fraîche": "creme-fraiche",
  mascarpone: "mascarpone",
  "canned white kidney beans": "white-beans",
  "canned white beans": "white-beans",
  "great northern beans": "white-beans",
  "borlotti beans rinsed and drained": "white-beans",
  "can borlotti beans drained": "white-beans",
  "can butter beans drained": "white-beans",
  "can cannellini beans rinsed and drained": "white-beans",
  "frozen broad beans": "broad-beans",
  "green beans": "green-beans",
  "frozen cut green beans": "green-beans",
  "about 110g pack pomegranate seeds": "pomegranate",
  "frozen strawberries": "berries",
  blueberries: "berries",
  "frozen cherries": "cherries",
  "pine nuts toasted": "pine-nuts",
  "dry roasted peanuts": "peanuts",
  "dry roasted peanuts to serve (optional)": "peanuts",
  "crushed peanuts": "peanuts",
  "flaked almonds": "almonds",
  "flaked or chopped almonds": "almonds",
  "dried cranberries": "dried-cranberries",
  "pork fillet": "pork-fillet",
  "ground chicken thighs": "chicken-mince",
  "turkey thigh mince": "turkey-mince",
  "chicken sausage": "chicken-sausage",
  "diced ham": "ham-steak",
  "can of tuna in spring water, drained": "tuna-canned",
  "can tuna in spring water": "tuna-canned",
  "cooked prawn": "prawns-cooked",
  "braising steak": "beef-stewing",
  "braising steak cut into large chunks (shin is a good choice)": "beef-stewing",
  "orange juice": "orange-juice",
  ghee: "ghee",
  "red wine": "red-wine",
  "red wine (optional)": "red-wine",
  "bottle red wine": "red-wine",
  "large glass red wine (optional)": "red-wine",
  "crunchy chili garlic oil": "chili-garlic-oil",
  "buffalo sauce": "buffalo-sauce",
  pesto: "pesto",
  "jar pesto": "pesto",
  "fish sauce (optional)": "fish-sauce",
  "french dressing": "dressing",
  "italian dressing": "dressing",
  "rice cakes": "rice-cake",
  kimchi: "kimchi",
  bread: "bread",
  "block all-butter puff pastry": "puff-pastry",
  "block halloumi cut into 8 slices": "halloumi",
  "halloumi cut into 1cm thick slices": "halloumi",
  "bulgur wheat": "bulgur",
  "dried bulgur": "bulgur",
  couscous: "couscous",
  "wholemeal giant couscous": "giant-couscous",
  "tapioca flour": "starch",
  "chipotle chilli paste": "hot-sauce",
  "chipotle paste": "hot-sauce",
  "chipotle paste (optional)": "hot-sauce",
  "chipotle peppers in adobo sauce": "hot-sauce",
  "frozen peas and carrots": "mixed-vegetables",
  "frozen stir fry blend vegetables": "mixed-vegetables",
  "frozen stir fry vegetables": "mixed-vegetables",
  "pickled carrots": "carrot",
  "granulated chicken bouillon": "bouillon",
  granola: "granola",
  splenda: "splenda",
  "high protein beef meatballs": "beef-meatballs",
  "popcorn chicken": "popcorn-chicken",
  "mixed seeds": "seed-mix",
  "dried porcini mushrooms": "mushrooms-dried",
  "dried porcini mushrooms, soaked in hot water for 15 mins, then drained (reserve the liquid)": "mushrooms-dried",
  "tikka masala sauce": "tikka-sauce",
  "madras curry paste": "curry-paste",
  "thai curry paste": "curry-paste",
  "red thai curry paste": "curry-paste",
  "taco seasoning": "taco-seasoning",
  "anchovies finely chopped (optional)": "anchovies",
  "ground pork (80/20)": "pork-mince-80",
  "beef mince 10% fat": "beef-mince-90",
  "chipolatas each halved": "sausage",
  "frozen, skinless wild salmon fillets (about 120g each)": "salmon",
  "butternut squash": "pumpkin",
  "butternut squash chopped": "pumpkin",
  "butternut squash peeled and cut into 2cm pieces": "pumpkin",
  "butternut squash peeled, deseeded and cut into chunks": "pumpkin",
  "hamburger pickle chips": "pickles",
  "bran flakes": "bread",
  "english muffins toasted": "bread",
  "hamburger buns": "bread",
  "crusty bread to serve (optional)": "bread",
  "demerara sugar": "brown-sugar",
  "golden caster sugar": "white-sugar",
  "grapeseed oil": "vegetable-oil",
  "duck or goose fat": "vegetable-oil",
  "bone broth": "broth",
  "fresh chicken gravy": "broth",
  "brown stir fry sauce": "teriyaki-sauce",
  "marinara sauce": "tomato-sauce",
  "salsa verde": "salsa",
  "harissa (depending on how spicy you like it)": "hot-sauce",
  "harissa (we used rose)": "hot-sauce",
  "tzatziki sauce": "yogurt",
  syrup: "maple-syrup",
  "a 25g pack or a small bunch chives finely snipped": "greens",
  "leftover soft herbs finely chopped, to garnish": "greens",
  "flat-leaf parsley chopped": "greens",
  "large handful chopped parsley": "greens",
  "large handful fresh basil leaves": "greens",
  "large handful of finely chopped soft herbs such as chives, dill and basil": "greens",
  "small bunch chives finely snipped": "greens",
  "small pack flat-leaf parsley chopped": "greens",
  "small handfuls of soft herbs (such as basil, chives and parsley), finely chopped": "greens",
  "handful of soft herbs (we used chives, parsley and dill)": "greens",
  "lemon zested": "lemon",
  "lemons zested": "lemon",
  "juice of 2 lemons": "lemon",
  "juice 1&frac12;-2 lemon depending on size": "lemon",
  "good squeeze of lemon juice": "lemon",
  "lemon cut into wedges": "lemon",
  "lemon halved": "lemon",
  "lemon ½ juiced, the other ½ cut into wedges (optional)": "lemon",
  "lemon zested plus 2 tbsp juice": "lemon",
  "large lemons zest pared": "lemon",
  "lime zested, then halved": "lime",
  "chopped sushi ginger": "ginger",
  "thumb-sized piece ginger finely grated or chopped": "ginger",
  "thumb-sized piece ginger grated": "ginger",
  "thumb-sized piece ginger peeled": "ginger",
  "thumb-sized piece of ginger finely grated": "ginger",
  "large onion very finely chopped": "onion",
  "onion very finely chopped (optional)": "onion",
  "onions (320g), very finely chopped": "onion",
  "finely sliced shallots": "onion",
  "shallot very finely chopped": "onion",
  "shallots roughly chopped": "onion",
  "red onion cut into 3cm chunks": "onion",
  "red onions halved and thinly sliced": "onion",
  "white onion cut into 3cm chunks": "onion",
  "sliced spring onion": "onion",
  "small bunch of spring onions (about 100g), sliced": "onion",
  "small shallots or baby onions, halved or quartered": "onion",
  "sticks celery finely diced (about 130g)": "celery",
  "carrots finely diced, about 200g": "carrot",
  "frozen peas defrosted": "peas",
  "handful frozen petits pois": "peas",
  "peas to serve (optional)": "peas",
  "handful frozen sweetcorn": "corn",
  "sweetcorn (use fresh or frozen), half of it crushed lightly with a fork": "corn",
  "handful baby spinach": "spinach",
  "handfuls baby leaf salad": "arugula",
  rocket: "arugula",
  "rocket leaves": "arugula",
  "green cabbage": "cabbage",
  "white cabbage finely shredded": "cabbage",
  "red cabbage finely shredded": "red-cabbage",
  "red cabbage thinly sliced": "red-cabbage",
  "kale or cavolo nero, any tough stalks removed, finely chopped": "kale",
  "large courgette sliced": "zucchini",
  "small aubergine sliced then diced (about 275g)": "eggplant",
  "large ready-cooked beetroots (160g), sliced": "beetroot-cooked",
  "cooked beetroot cut into wedges": "beetroot-cooked",
  "cooked beetroot diced": "beetroot-cooked",
  "large potatoes peeled and cut into 3cm chunks": "potato",
  "small baking potato weighing 100g": "potato",
  "medium maris piper potatoes finely sliced": "potato",
  "medium potatoes scrubbed (choose a variety that roasts well like maris piper)": "potato",
  "small butternut squash peeled and cut into small cubes": "pumpkin",
  "cherry tomato": "tomato",
  "large tomato": "tomato",
  "tomato amber or red, quartered": "tomato",
  "tomato chopped": "tomato",
  "roughly chopped tomatoes": "tomato",
  "pack cherry tomatoes on the vine": "tomato",
  "fire roasted tomatoes": "roasted-pepper",
  "roasted red peppers finely chopped": "roasted-pepper",
  "roasted red peppers from a jar drained and finely chopped": "roasted-pepper",
  "finely sliced peppers": "pepper",
  "frozen peppers": "pepper",
  "green pepper deseeded and chopped into small pieces": "pepper",
  "large red pepper roughly chopped": "pepper",
  "red and 1 yellow pepper deseeded and cut into small chunks": "pepper",
  "red and yellow pepper - after deseeding and removing stalks, cut into chunks": "pepper",
  "red or orange pepper diced": "pepper",
  "small peppers of any colour": "pepper",
  "medium jalapeño": "jalapeno",
  "bag long grain rice": "rice",
  "long pasta (like bucatini)": "pasta",
  "lasagne sheets": "pasta",
  "farfalle (pasta bows)": "pasta",
  "cornstarch slurry": "starch",
  "flour for dusting": "wheat-flour",
  "strong wholewheat bread flour plus extra for dusting": "wheat-flour",
  "wholemeal self-raising flour plus extra for dusting": "wheat-flour",
  "wholemeal spelt flour plus extra if needed": "wheat-flour",
  "wholemeal breadcrumb": "breadcrumbs",
  "soft white breadcrumbs": "breadcrumbs",
  "sachet fast-action dried yeast": "active-dry-yeast",
  "ketchup (optional)": "ketchup",
  "tomato ketchup": "ketchup",
  "tomato ketchup to serve (optional)": "ketchup",
  "tomato & vegetable purée": "tomato-passata",
  "olives roughly chopped": "olives",
  "unsweetened apple sauce": "applesauce",
  "small ripe avocado cubed": "avocado",
  "hot low salt vegetable stock (from a cube is fine)": "vegetable-broth",
  "low-sodium chicken or vegetable stock from cubes": "broth",
  "strong beef stock (use 1 stock cube for 300ml)": "broth",
  "strong chicken stock": "broth",
  "vegetable stock cube (check the label if you’re vegan)": "bouillon",
  "vegetable stock cube (make sure its vegan)": "bouillon",
  "salsa to serve": "salsa",
  "light oil": "vegetable-oil",
  "veg or rapeseed oil": "vegetable-oil",
  "rapeseed oil plus a little extra for drizzling": "canola-oil",
  "rapeseed oil plus extra for the baking sheet": "canola-oil",
  "drop of olive oil for roasting": "olive-oil",
  "olive or rapeseed oil": "vegetable-oil",
  "coconut or sunflower oil": "vegetable-oil",
  "coconut oil (we used fushi) or sunflower oil": "vegetable-oil",
  "cold-pressed rapeseed oil or mild olive oil": "vegetable-oil",
  "skim milk": "milk",
  "milk of your choice plus a splash": "milk",
  "milk plus a splash": "milk",
  "splash of milk": "milk",
  "natural yogurt to serve (optional)": "yogurt",
  "lighter mature cheddar": "cheese",
  "pepper jack cheese": "cheese",
  "parmesan or vegetarian alternative, finely grated": "parmesan",
  "parmesan or vegetarian equivalent, grated": "parmesan",
  "vegetarian hard cheese to serve, optional": "parmesan",
  "parmesan rind (optional)": "parmesan",
  "pork sausages": "sausage",
  "pork shoulder joint": "pork-shoulder",
  "smoked bacon rashers, chopped": "bacon",
  "unsmoked bacon lardons": "bacon",
  "pack thin pancetta rashers": "bacon",
  "salmon fillet": "salmon",
  "poached salmon flaked": "salmon-cooked",
  "raw king prawns (if frozen, defrosted)": "prawns-cooked",
  "lean fat-trimmed fillet steak": "beef",
  "stewing beef cut into chunks": "beef-stewing",
  "stewing or braising steak cut into small chunks": "beef-stewing",
  "lean minced beef (or use half beef, half pork mince)": "beef-mince",
  "pulled rotisserie chicken": "chicken",
  "velveted chicken": "chicken",
  "walnut halves (35g), broken up": "walnuts",
  "walnuts chopped": "walnuts",
  "pecans roughly chopped": "walnuts",
  "roasted salted pecans roughly chopped": "walnuts",
  "ripe mango cut into small pieces": "mango",
  "pomegranate seeds to serve": "pomegranate",
  "roasted pumpkin seeds": "seed-mix",
  "mixed dried herbs": "greens",
  "mixed herbs": "greens",
  "dried mixed herbs": "greens",
  "few sprigs thyme": "greens",
  "few thyme sprigs": "greens",
  "several pinches of ground cinnamon": "greens",
  "mild curry powder": "greens",
  "medium curry powder plus 1 tsp for the rice": "greens",
  "mild chilli powder": "greens",
  msg: "greens",
  "any other seasoning you like is optional": "greens",
  "tartlet tins (about 7.5cm diameter each)": "greens",
  "/5lb 8 oz maris piper, red-skinned or king edward potatoes peeled": "potato",
  "approx chicken thigh": "chicken-thigh",
  "bag toasted cashew &frac12; very roughly chopped": "cashews",
  "bulgur and quinoa (this comes ready mixed)": "bulgur-quinoa-mix",
  "canned mandarin oranges": "orange",
  "cannellini, butter or pinto beans": "white-beans",
  "chile pepper": "jalapeno",
  "chinese cooking wine": "red-wine",
  "cm fresh ginger grated or finely chopped": "ginger",
  "cooked broccoli": "broccoli",
  "each of onions and carrots, chopped": "mixed-vegetables",
  "egg yolk beaten (freeze the white for another recipe)": "egg-yolk",
  "egg yolks (freeze the whites to use in another recipe)": "egg-yolk",
  "eggs plus 5 egg yolks (reserve a little of the egg white for brushing)": "egg-yolk",
  "fat free whipped cream": "whipped-cream",
  "frozen vegetarian mince": "vegetarian-mince",
  "greens (such as spinach or kale), finely sliced": "greens",
  "handful of chopped coriander and chopped peanuts, to serve": "peanuts",
  "heaped tsp creamed horseradish": "mustard",
  "large flatbreads we used greek ones": "tortilla",
  "large leeks chopped": "onion",
  "lean lamb steaks fat removed, diced (about 240g)": "lamb",
  "leek finely sliced": "onion",
  "leeks finely sliced": "onion",
  "leftover traybake lamb kebab roughly chopped (see step 2)": "lamb",
  "light coconut milk": "coconut-milk",
  mangetout: "peas",
  "mango chutney": "mango-chutney",
  marsala: "red-wine",
  "milk (or alternative)": "milk",
  "muesli mix": "granola",
  "nonfat powdered milk": "milk",
  "nut butter (we used almond)": "peanut-butter",
  "orange cut into segments": "orange",
  "oranges peeled and chopped": "orange",
  "oranges zested and juiced": "orange",
  "small oranges peeled and chopped (leave the pith on)": "orange",
  "pack chestnut mushrooms sliced": "mushrooms",
  "pack portobello mushrooms sliced": "mushrooms",
  "pack prosciutto or salami": "charcuterie",
  "pack wholegrain rice mix with seaweed (merchant gourmet)": "rice-cooked",
  peaches: "peaches",
  "peanut or almond butter plus extra to serve": "peanut-butter",
  "pecans or walnuts, chopped": "walnuts",
  pectin: "starch",
  "pinch of sugar": "white-sugar",
  "pomegranate molasses or good balsamic vinegar": "pomegranate-molasses",
  "powdered sugar": "white-sugar",
  "protein pancake mix": "protein-pancake-mix",
  "pumpkin purée": "pumpkin",
  "puy lentils": "lentils",
  "radishes thinly sliced": "radish",
  "raisin & nut mix": "trail-mix",
  "red miso paste": "miso-paste",
  "rice cake water": "rice-cake",
  "soya milk": "soy-milk",
  "sweetened soy milk": "soy-milk",
  sultana: "raisins",
  "sundried tomatoes chopped": "sun-dried-tomatoes",
  "sundried tomatoes in oil": "sun-dried-tomatoes",
  "sweet relish": "pickles",
  "thai red curry paste (check the label to make sure it’s vegetarian/ vegan)": "curry-paste",
  "tikka curry paste": "curry-paste",
  "tortilla bowls (we used old el paso stand ’n’ stuff)": "tortilla",
  "vegan red wine (optional)": "red-wine",
  "whipped cream cheese frosting": "cream-cheese-frosting",
  "x 110g trout or salmon fillets": "salmon",
  "x 160g cans tuna steak in spring water drained": "tuna-canned",
  "x 25g pack parsley stalks and leaves finely chopped separately": "greens",
  "x 400g cans cooked green lentils drained": "lentils-cooked",
  "x 500g pack chicken pieces (thighs and drumsticks), or thighs": "chicken-thigh",
  "x roughly 130g packs cooked chicken tikka pieces, chopped": "chicken-thigh",
  "yeast extract": "bouillon",
  "yeast extract (optional)": "bouillon",
  "yellow cornmeal": "cornmeal",
  "yellow mustard seed": "mustard-seeds",
  "medium egg yolk": "egg-yolk",
  "x pack fish pie mix (cod, salmon, smoked haddock etc, weight around 320g-400g depending on pack size)": "fish-pie-mix",
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
  "ancho chili powder", "baking powder", "black pepper", "black peppercorns", "cardamom pods", "cardamom pods seeds removed and ground",
  "cayenne pepper", "celery salt (optional)", "chili powder", "cinnamon", "cooking spray", "cumin", "cumin seed", "cumin seeds", "everything bagel seasoning",
  "fennel seeds", "fenugreek powder", "fresh or dried chilli to taste", "garlic granules", "garlic powder", "generous pinches of saffron",
  "gochugaru", "good grating of nutmeg", "ground allspice", "ground cumin", "hot chilli powder", "italian seasoning", "oil spray",
  "onion powder", "oregano", "paprika", "pepper", "ras el hanout", "red pepper flakes", "salt and pepper to taste", "smoked paprika",
  "any other seasoning you like is optional", "dried mixed herbs", "few sprigs thyme", "few thyme sprigs", "medium curry powder plus 1 tsp for the rice",
  "mild chilli powder", "mild curry powder", "mixed dried herbs", "mixed herbs", "msg", "several pinches of ground cinnamon",
  "tartlet tins (about 7.5cm diameter each)", "turmeric", "white pepper",
  "fresh chillies deseeded and finely chopped", "green chillies deseeded and finely chopped",
  "lemongrass stalk bashed, peeled and roughly chopped", "milk or beaten egg, for brushing",
  "pumpkin pie spice", "red chilli deseeded and finely chopped", "red chilli deseeded if you like, finely sliced",
  "red chilli finely shredded", "red chillies deseeded and sliced",
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
  [/^\/?\d+(?:lb|oz|pint)(?:\s+\d+(?:lb|oz))?\s+sweet potato(?:es)?(?:,? .*)?$/, "sweet-potato"],
  [/^\/?\d+(?:lb|oz|pint)(?:\s+\d+(?:lb|oz))?\s+(?:maris piper, red-skinned or king edward )?potato(?:es)?(?:,? .*)?$/, "potato"],
  [/^\/?\d+(?:lb|oz|pint)(?:\s+\d+(?:lb|oz))?\s+(?:strong )?cheddar(?:,? .*)?$/, "cheese"],
  [/^\/?\d+(?:lb|oz|pint)(?:\s+\d+(?:lb|oz))?\s+(?:rigatoni|farfalle|pasta)(?:,? .*)?$/, "pasta"],
  [/^\/?\d+(?:lb|oz|pint)(?:\s+\d+(?:lb|oz))?\s+plain flour(?:,? .*)?$/, "wheat-flour"],
  [/^\/?\d+(?:lb|oz|pint)(?:\s+\d+(?:lb|oz))?\s+butter(?:,? .*)?$/, "butter"],
  [/^\/?\d+(?:lb|oz|pint)(?:\s+\d+(?:lb|oz))?\s+milk(?:,? .*)?$/, "milk"],
  [/^\/?\d+(?:lb|oz|pint)(?:\s+\d+(?:lb|oz))?\s+(?:bag )?spinach(?:,? .*)?$/, "spinach"],
  [/^(?:large |medium |small )?eggs?(?:,? (?:beaten|lightly beaten))?$/, "egg"],
  [/^(?:liquid )?egg whites?$/, "egg-white"],
  [/^(?:minced garlic|(?:large |small |fat )?garlic cloves?(?:,? (?:crushed|chopped|finely chopped|finely grated|grated))?|garlic clove(?:,? (?:crushed|chopped|finely chopped|finely grated|grated))?)$/, "garlic"],
  [/^(?:crushed )?garlic cloves?(?: \([^)]*\))?(?:,? (?:crushed|bashed and skin removed|crushed or finely grated|roughly chopped|sliced))?$/, "garlic"],
  [/^garlic bulb cloves bashed and skin removed$/, "garlic"],
  [/^fat cloves garlic crushed$/, "garlic"],
  [/^(?:cm fresh |fresh |grated )?ginger(?:,? (?:peeled and )?(?:grated|finely chopped|cut into thin matchsticks))?$/, "ginger"],
  [/^(?:large |medium |small |very small |sweet |yellow |white |red )?onions?(?: \([^)]*\))?(?:,? (?:halved(?: then)? and )?(?:sliced|chopped|diced|finely chopped|finely diced|finely sliced|roughly chopped|cut into quarters|cut into chunks))?$/, "onion"],
  [/^(?:large |medium |small )?red onions?(?:,? (?:halved(?: then)? and )?(?:sliced|chopped|diced|finely chopped|finely sliced|cut into chunks))?$/, "onion"],
  [/^(?:large |medium |small )?carrots?(?: \([^)]*\))?(?:,? (?:cut .*|chopped|finely chopped|finely diced|very finely chopped|grated|coarsely grated))?$/, "carrot"],
  [/^(?:(?:medium )?sticks? )?celery(?: sticks?| stalks?)?(?: \([^)]*\))?(?:,? (?:finely |very finely )?(?:chopped|diced|sliced))?$/, "celery"],
  [/^(?:red |green |yellow |orange )?(?:bell )?peppers?(?:,? (?:deseeded and )?(?:sliced|diced|finely sliced|finely chopped|halved and deseeded|cut into small chunks|cut into chunks))?$/, "pepper"],
  [/^(?:large |small )?(?:red |green |yellow |orange )?peppers?(?:,? (?:deseeded and )?(?:sliced|diced|finely sliced|finely chopped|halved and deseeded|cut into small chunks|cut into chunks))?$/, "pepper"],
  [/^(?:medium )?poblano peppers?$/, "pepper"],
  [/^(?:large )?aubergines?(?:,? (?:halved lengthways and |peeled,? )?(?:thinly sliced|cut into thin rounds|cut into 1cm cubes|cut into chunks))?$/, "eggplant"],
  [/^(?:big )?handfuls? (?:of )?rocket(?: leaves)?$/, "arugula"],
  [/^(?:baby leaf salad|baby spring mix)$/, "arugula"],
  [/^(?:crisp )?lettuce leaves from an iceberg lettuce$/, "lettuce"],
  [/^(?:little gem|iceberg) lettuces?(?:,? .*)?$/, "lettuce"],
  [/^asparagus(?: \([^)]*\))?(?:,? .*)?$/, "asparagus"],
  [/^baby corn(?:,? .*)?$/, "baby-corn"],
  [/^(?:large )?(?:boneless,? ?)?(?:skinless,? ?)?chicken breasts?(?: fillets?)?(?:,? .*)?$/, "chicken"],
  [/^(?:boneless,? ?)?(?:skinless,? ?)?chicken thighs?(?: fillets?)?(?:,? .*)?$/, "chicken-thigh"],
  [/^(?:head of |heads of |long-stem |frozen )?broccoli(?: florets?)?(?:,? .*)?$/, "broccoli"],
  [/^(?:frozen )?peas?$/, "peas"],
  [/^(?:frozen )?cauliflower$/, "cauliflower"],
  [/^(?:frozen )?(?:sweetcorn|corn)(?: \([^)]*\))?$/, "corn"],
  [/^(?:extra virgin )?olive oil(?: .*)?$/, "olive-oil"],
  [/^(?:white|red wine|rice|cider|apple cider|balsamic) vinegar$/, "vinegar"],
  [/^(?:chicken|beef|vegetable) stock cubes?(?: .*)?$/, "bouillon"],
  [/^(?:chicken|beef) (?:broth|stock)(?: .*)?$/, "broth"],
  [/^tomatoes? cut into wedges$/, "tomato"],
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
  [/^(?:(?:x \d+g )?pots? )?(?:plain )?bio yogurt(?:,? .*)?$/, "yogurt"],
  [/^(?:fat-free|full fat) greek yogurt(?:,? .*)?$/, "yogurt"],
  [/^(?:chopped )?cilantro$/, "greens"],
  [/^(?:green onions?|spring onions?)(?:,? .*)?$/, "onion"],
  [/^(?:large )?(?:sliced )?(?:english |seedless |baby )?cucumbers?(?:,? .*)?$/, "cucumber"],
  [/^(?:large |cherry |roma |vine )?tomatoes?(?:,? .*)?$/, "tomato"],
  [/^(?:large )?(?:cherry |vine-ripened )?tomatoes?(?:,? (?:halved|quartered|roughly chopped|finely chopped))?(?: \([^)]*\))?$/, "tomato"],
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
  [/^turkey thigh mince$/, "turkey-mince"],
  [/^ground chicken(?: \(?(?:93\/7|95\/5|97\/3)\)?)?$/, "chicken-mince"],
  [/^ground chicken thighs?$/, "chicken-mince"],
  [/^(?:ground pork 90\/10|90\/10 ground pork|pork mince)$/, "pork-mince"],
  [/^ground beef(?: \(?(?:93\/7)\)?)?$/, "beef-mince"],
  [/^cooked basmati rice$/, "rice-cooked"],
  [/^cooked (?:brown |brown basmati |basmati )?rice(?: to serve(?: \(optional\))?)?$/, "rice-cooked"],
  [/^(?:cooked spaghetti|leftover pasta shapes?)(?:,? .*)?$/, "pasta-cooked"],
  [/^(?:rigatoni|farfalle(?: \(pasta bows\))?|long pasta|rice sticks)$/, "pasta"],
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
  [/^(?:can |canned )?(?:cannellini|butter|borlotti|great northern|white kidney|white) beans?(?:,? (?:rinsed and drained|drained))?$/, "white-beans"],
  [/^(?:frozen )?(?:broad|fava) beans?(?:,? .*)?$/, "broad-beans"],
  [/^(?:frozen (?:cut )?)?green beans?(?:,? .*)?$/, "green-beans"],
  [/^(?:ready-)?cooked beetroot(?: \([^)]*\))?(?:,? (?:cut into wedges|diced))?$/, "beetroot-cooked"],
  [/^(?:wholemeal )?giant couscous$/, "giant-couscous"],
  [/^(?:dried )?bulgur(?: wheat)?$/, "bulgur"],
  [/^couscous$/, "couscous"],
  [/^(?:chunky )?cod loins?(?: \([^)]*\))?$/, "cod"],
  [/^(?:frozen,? skinless )?wild salmon fillets?(?: \([^)]*\))?$/, "salmon"],
  [/^(?:fresh )?apricots?(?: \([^)]*\))?$/, "apricot"],
  [/^(?:toasted )?(?:flaked |chopped )?almonds?$/, "almonds"],
  [/^(?:toasted )?pine nuts?$/, "pine-nuts"],
  [/^(?:fresh |frozen )?(?:strawberries|blueberries)$/, "berries"],
  [/^(?:fresh |frozen )?cherries$/, "cherries"],
  [/^white wine vinegar$/, "vinegar"],
];

function canonicalFromSourceName(alias: string): CanonicalIngredient | undefined {
  const direct = canonicalByAlias.get(alias);
  if (direct) return direct;
  // Some source names start with a broken multiplier ("x 400g cans …").
  // It is presentation metadata, never product identity.
  const compact = alias
    .replace(/^x\s+\d+(?:\.\d+)?(?:g|ml)\s+(?:cans?|packs?|pots?)\s+/, "")
    .replace(/^and\s+\d+(?:\.\d+)?g\s+cans?\s+/, "");
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
  "src-teriyaki-tray": { sourceSlug: "sheet-pan-teriyaki-chicken-and-vegetables", sourceIngredientCount: 16 },
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

// These recipes already passed the production-catalog gate and have complete
// Mise ingredient quantities. They are deliberately limited to modular meals:
// every ingredient has a canonical mapping and a role that is safe to vary.
// Recipes with baking geometry or unknown packaged components stay legacy-only.
const catalogRoleOverrides: Record<string, Record<string, RecipeIngredientRole>> = {
  "src-lemon-chicken": familyRoles({ protein: ["chicken-thigh"], carb: ["potato"], vegetable: ["carrot"], fat: ["butter"], sauce: ["milk", "mustard"] }),
  "src-curry-fried-rice": familyRoles({ protein: ["chicken-thigh"], carb: ["rice"], vegetable: ["onion", "pepper", "zucchini"], sauce: ["yogurt"] }),
  "src-fajita-rice": familyRoles({ protein: ["chicken-thigh"], carb: ["rice"], vegetable: ["onion", "pepper"], flavour_fixed: ["lime"] }),
  "src-japanese-beef-curry": familyRoles({ protein: ["beef-mince"], carb: ["rice", "potato"], vegetable: ["carrot", "onion", "peas"], sauce: ["soy"] }),
  "src-gochujang-beef": familyRoles({ protein: ["beef-mince"], carb: ["rice"], vegetable: ["cabbage", "carrot", "pepper"], sauce: ["gochujang", "soy"] }),
  "src-beefy-cheese-potatoes": familyRoles({ protein: ["beef-mince", "cottage"], carb: ["potato"], vegetable: ["zucchini", "onion", "pepper", "mushrooms"], fat: ["cheese"], sauce: ["tomato-passata", "milk"] }),
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

export type RecipeFamilyDerivationIssue = {
  recipeId: string;
  source: "pilot" | "catalog" | "raw";
  ingredientId?: string;
  reason: string;
};

const derivationIssues = new Map<string, RecipeFamilyDerivationIssue>();

function noteDerivationIssue(
  recipeId: string,
  source: "pilot" | "catalog" | "raw",
  ingredientId: string | undefined,
  reason: string,
): null {
  derivationIssues.set(`${source}:${recipeId}:${ingredientId ?? ""}`, { recipeId, source, ingredientId, reason });
  return null;
}

/**
 * Why a recipe ended up without a Recipe Family. `recipeToFamily` used to
 * return a bare `null`, so one unmapped ingredient silently dropped a whole
 * recipe out of the deterministic engine with nothing to look at.
 */
export function recipeFamilyDerivationIssues(): RecipeFamilyDerivationIssue[] {
  return [...derivationIssues.values()];
}

/**
 * Largest safe multiple of the editorial base recipe that fits in one vessel.
 * Every entry needs an editor-confirmed vessel/geometry mapping — an absent
 * entry means "not modelled yet", and `solveRecipeBatch` reports it as such
 * instead of quietly claiming one pan is enough.
 */
export const familyGeometryLimits: Readonly<Record<string, number>> = Object.freeze({
  "src-cottage-bake": 1,
  "src-chicken-buckwheat": 1,
  "src-chicken-rice-veg": 1,
  "src-chicken-bean-bowl": 4,
  "src-salmon-rice-veg": 3,
  "src-turkey-meatballs": 1,
  "src-taco-mac": 5,
  "src-teriyaki-tray": 5,
  "src-halal-chicken": 6,
  "src-crispy-beef-noodles": 5,
  "src-mediterranean-wrap": 6,
  "src-creamy-chicken-pasta": 5,
  "src-sausage-pepper-pasta": 5,
  "src-honey-lime-steak": 5,
  "src-light-stroganoff": 10,
  "src-bbq-burger-bowl": 5,
  "src-red-pepper-chicken-dip": 5,
  "src-lemon-chicken": 5,
  "src-curry-fried-rice": 5,
  "src-fajita-rice": 5,
  "src-japanese-beef-curry": 5,
  "src-gochujang-beef": 5,
  "src-beefy-cheese-potatoes": 5,
});

export function recipeToFamily(
  recipe: LegacyRecipeForEngine,
  source: "pilot" | "catalog" = "pilot",
): RecipeFamily | null {
  const roleOverrides = source === "pilot"
    ? pilotRoleOverrides[recipe.id]
    : catalogRoleOverrides[recipe.id];
  if (!roleOverrides) return noteDerivationIssue(recipe.id, source, undefined, "Нет карты ролей ингредиентов для рецепта.");
  const ingredients: RecipeFamilyIngredient[] = [];
  for (const ingredient of recipe.ingredients) {
    // canonicalByAlias is keyed by normalized aliases; looking up a raw id
    // happened to work only while every legacy id was already lower-case.
    const canonical = canonicalByAlias.get(normalizedAlias(ingredient.id));
    if (!canonical) return noteDerivationIssue(recipe.id, source, ingredient.id, "Ингредиент не сопоставлен с каноническим справочником.");
    const role = roleOverrides[ingredient.id];
    if (!role) return noteDerivationIssue(recipe.id, source, ingredient.id, "Для ингредиента не задана роль в семействе.");
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
  for (const item of ingredients) {
    if (!item.scalable) continue;
    const step = amountStep(item);
    const gridMin = Math.ceil(item.minAmount / step) * step;
    const gridMax = canonicalIngredients[item.canonicalIngredientId].unit.structuralDiscrete
      ? Math.ceil(item.maxAmount / step) * step
      : Math.floor(item.maxAmount / step) * step;
    // No rounding step lands inside the allowed range, so the amount can never
    // move. Reporting it as scalable made the search churn on it and told the
    // UI the dish had flexibility it does not have.
    if (gridMin > gridMax) item.scalable = false;
  }
  const calculated = nutritionForFamily({ ingredients });
  const reach = nutritionReachForIngredients(ingredients);
  const nutritionRecord = source === "pilot" ? pilotNutritionRecords[recipe.id] : undefined;
  const editorialAudit: RecipeFamilyEditorialAudit = nutritionRecord
    ? editorialAuditFor(recipe.id, ingredients)
    : {
        ingredientMapping: {
          source: "recipe_catalog",
          reviewedAt: editorialReviewedAt,
          sourceIngredientCount: ingredients.length,
          note: "Recipe Family derived from the production catalog's existing Mise quantities; it is not a replacement for source-level editorial mapping.",
        },
        nutrition: {
          scope: "unavailable",
          quantitativeCoverage: "incomplete",
          comparableToMise: false,
          reviewedAt: editorialReviewedAt,
          note: "Current Mise recipe data is sufficient for deterministic portions, but no source-serving comparison is asserted here.",
        },
      };
  const sourceNutrition = nutritionRecord
    ? nutritionRecord.declaredNutrition === undefined ? recipe.macros : nutritionRecord.declaredNutrition
    : null;
  const sourceServingRatio = nutritionRecord?.miseServingToSourceServingRatio ?? 1;
  const comparisonNutrition = nutritionRecord?.comparableToMise && nutritionRecord.quantitativeCoverage === "verified" && sourceNutrition
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
  const needsNutritionReview = Boolean(nutritionRecord) && (!nutritionDelta || !nutritionThresholds ||
    (Object.keys(nutritionDelta) as (keyof Nutrition)[])
      .some((key) => Math.abs(nutritionDelta[key]) > nutritionThresholds[key]));
  const sourceUrl = typeof recipe.provenance.sourceUrl === "string" ? recipe.provenance.sourceUrl : undefined;
  const imageUrl = typeof recipe.provenance.imageUrl === "string" ? recipe.provenance.imageUrl : undefined;
  const mealLike = recipe.slot === "lunch" || recipe.slot === "dinner";
  // The working range is what the ingredient bounds can actually reach, not an
  // editorial band. A hard-coded 400–780 declared targets the solver could not
  // hit (so they failed as `constraints_unsatisfied` instead of an honest
  // `outside_calorie_range`) and cut off every target outside the band even
  // when the dish scaled there perfectly well.
  const minViableCalories = Math.ceil(reach.minKcal);
  const maxViableCalories = Math.floor(Math.max(reach.maxKcal + 12, reach.maxKcal / 0.975));
  const desiredProteinFloor = mealLike
    ? Math.min(35, Math.max(24, Math.floor(recipe.macros.protein * 0.68)))
    : Math.max(16, Math.floor(recipe.macros.protein * 0.65));
  // A floor the dish physically cannot reach turns every target non-viable.
  const minimumProtein = Math.min(desiredProteinFloor, Math.floor(reach.maxProtein));
  return {
    id: recipe.id,
    title: recipe.title,
    mealSlots: [recipe.slot],
    provenance: recipe.provenance,
    image: { imageUrl, source: recipe.provenance.sourceTitle, sourceUrl, usageStatus: imageUrl ? "reference_only" : "unknown", license: undefined, fetchedAt: undefined, confidenceMatch: imageUrl ? 1 : 0, manuallyApproved: false, photoType: imageUrl ? "source" : "fallback" },
    ingredients,
    minViableCalories,
    maxViableCalories,
    geometryLockedMax: familyGeometryLimits[recipe.id],
    minimumProtein,
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
    activeTime: Number.isFinite(Number(recipe.effort.activeMinutes))
      ? Number(recipe.effort.activeMinutes)
      : recipe.time,
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

export function deriveRecipeFamilyFromCatalog(recipe: LegacyRecipeForEngine) {
  return recipeToFamily(recipe, "catalog");
}

/**
 * Converts an audit-ready parsed source card to a solver family without
 * pretending it is one of the hand-authored pilot families. Every measured,
 * mapped source ingredient is retained; unresolved/replaced or unmeasured
 * caloric components reject the derivation and leave a visible issue.
 */
function rawRoleForCanonical(canonical: CanonicalIngredient): RecipeIngredientRole {
  const { category, nutritionPer100g, id } = canonical;
  if (/(?:oil|butter|ghee|coconut_oil)/.test(id)) return "fat_cooking";
  if (
    category === "meat" ||
    category === "fish" ||
    category === "seafood" ||
    category === "egg" ||
    category === "legume" ||
    category === "protein"
  )
    return "protein";
  if (category === "grain") return "carb";
  if (category === "vegetable" || category === "fruit") return "vegetable";
  if (category === "dairy") return nutritionPer100g.protein >= nutritionPer100g.fat ? "protein" : "fat";
  if (category === "fat" || category === "nut") return "fat";
  if (category === "sweetener") return "flavour";
  if (category === "dairy-alternative")
    return nutritionPer100g.protein >= nutritionPer100g.fat ? "protein" : "fat";
  if (category === "sauce") return "sauce";
  // A mapped caloric component must stay adjustable rather than being frozen
  // as if it were salt or a bay leaf. This catches documented supplements and
  // packaged components whose taxonomy is more specific than the role list.
  if (nutritionPer100g.kcal >= 50) return "flavour";
  return "flavour_fixed";
}

// These source recipes explicitly yield divisible gram-based portions. A
// smaller container is therefore a portion-size change, not an ingredient
// substitution. Keep the exception narrow and auditable instead of lowering
// every recipe's role bounds globally.
const rawPortionFloorRatios: Readonly<Record<string, number>> = Object.freeze({
  "tmpm-26965": 0.45,
});

type RawFamilyMeasurement = { amount: number; unit: RecipeUnit; basis: string };

const rawFamilyCupWeights: Record<string, number> = {
  // These source cards state a volume only. The factor is a declared
  // household conversion, backed by metric examples elsewhere in the same
  // corpus (rather than a made-up finished serving weight).
  oat_flour_raw: 90,
  cheese_processed: 112,
};

function rawFamilyNumber(value: string): number | null {
  const compact = value.trim().replace(",", ".");
  if (/^\d+(?:\.\d+)?$/.test(compact)) return Number(compact);
  const glyphs: Record<string, number> = { "¼": .25, "½": .5, "¾": .75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": .125, "⅜": .375, "⅝": .625, "⅞": .875 };
  const mixed = compact.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = compact.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  let remaining = compact;
  let total = 0;
  for (const [glyph, amount] of Object.entries(glyphs)) {
    if (remaining.includes(glyph)) {
      total += amount;
      remaining = remaining.replaceAll(glyph, "");
    }
  }
  const whole = remaining.match(/\d+(?:\.\d+)?/)?.[0];
  if (whole) total += Number(whole);
  return total > 0 ? total : null;
}

/**
 * Converts only source quantities that have an explicit metric, a standard
 * household conversion, or a count supported by the canonical ingredient.
 * It intentionally returns null for a volume with no documented mass basis.
 */
function rawFamilyMeasurement(source: { original?: unknown }, canonical: CanonicalIngredient): RawFamilyMeasurement | null {
  const original = String(source.original ?? "").replaceAll(" ", " ").trim();
  const metric = [...original.matchAll(/([\d\s.,/¼½¾⅓⅔⅛⅜⅝⅞]+)\s*(kg|g|ml|l|lbs?|pounds?|oz|ounces?)\b/gi)].at(-1);
  if (metric) {
    const amount = rawFamilyNumber(metric[1]);
    if (!amount) return null;
    const unit = metric[2].toLowerCase();
    if (unit === "kg") return { amount: amount * 1000, unit: "g", basis: "source_metric" };
    if (unit === "l") return { amount: amount * 1000, unit: "ml", basis: "source_metric" };
    if (/^(?:lb|lbs|pound|pounds)$/.test(unit)) return { amount: amount * 453.59237, unit: "g", basis: "standard_imperial" };
    if (/^(?:oz|ounce|ounces)$/.test(unit)) return { amount: amount * 28.3495, unit: "g", basis: "standard_imperial" };
    return { amount, unit: unit === "ml" ? "ml" : "g", basis: "source_metric" };
  }
  // Some source pages expose a parenthesised metric number but the importer
  // loses the trailing `g`; its placement after a household measure is still
  // an explicit source fact (for example: "5 tbsp (70) butter").
  const parenthesised = original.match(/\(\s*([\d.]+)\s*\)/)?.[1];
  if (parenthesised && /\b(?:cup|cups|tbsp|tablespoons?|tsp|teaspoons?)\b/i.test(original)) {
    const amount = Number(parenthesised);
    if (Number.isFinite(amount) && amount > 0) return { amount, unit: "g", basis: "source_parenthesised_metric" };
  }
  const leading = original.match(/^([\d\s.,/¼½¾⅓⅔⅛⅜⅝⅞-]+)/)?.[1];
  const amount = leading ? rawFamilyNumber(leading) : null;
  if (!amount) return null;
  if (/\b(?:tbsp|tablespoons?|tsp|teaspoons?)\b/i.test(original)) {
    const millilitres = amount * (/\b(?:tbsp|tablespoons?)\b/i.test(original) ? 15 : 5);
    if (canonical.densityGPerMl) return { amount: millilitres, unit: "ml", basis: "standard_household_volume" };
    const gramsPerCup = rawFamilyCupWeights[canonical.id];
    if (gramsPerCup) return { amount: gramsPerCup * (millilitres / 240), unit: "g", basis: "documented_household_mass" };
    return null;
  }
  if (/\b(?:cup|cups?)\b/i.test(original)) {
    const gramsPerCup = rawFamilyCupWeights[canonical.id];
    if (gramsPerCup) return { amount: gramsPerCup * amount, unit: "g", basis: "documented_household_mass" };
    if (canonical.densityGPerMl) return { amount: amount * 240, unit: "ml", basis: "standard_household_volume" };
    return null;
  }
  if (/\b(?:egg|eggs|tortillas?|lime|lemon|jalape(?:ñ|n)o|onion|peppers?|potato|stalks?)\b/i.test(original) && canonical.unit.gramsPerUnit > 0) {
    return { amount, unit: "piece", basis: "source_count" };
  }
  return null;
}

function rawOptionalSourceIngredient(source: { original?: unknown }): boolean {
  return /\b(?:optional|for garnish)\b/i.test(String(source.original ?? ""));
}

function rawRecipeInstructions(candidate: Record<string, unknown>, ingredientIds: string[]): RecipeInstruction[] {
  const supplied = Array.isArray(candidate.paraphrasedInstructionDraft)
    ? candidate.paraphrasedInstructionDraft as RecipeInstruction[]
    : [];
  return [
    { id: "step-measure", text: "Отмерьте рассчитанные Mise количества ингредиентов для всей готовки.", ingredientIds, action: "measure", dependsOn: [] },
    ...supplied.map((step, index) => ({
      ...step,
      id: step.id || `source-step-${index + 1}`,
      ingredientIds: step.ingredientIds?.length ? step.ingredientIds : ingredientIds,
      dependsOn: step.dependsOn?.length ? step.dependsOn : [index ? (supplied[index - 1].id || `source-step-${index}`) : "step-measure"],
    })),
  ];
}

export function deriveRecipeFamilyFromAuditedCandidate(
  candidate: Record<string, unknown> & { id: string; sourceUrl: string },
  context: { publisher: string; accessedAt: string },
): RecipeFamily | null {
  const draft = normalizeRawRecipeCandidate(candidate, context);
  const servings = Number(candidate.servings);
  if (!Number.isFinite(servings) || servings <= 0) return noteDerivationIssue(candidate.id, "raw", undefined, "Нет положительного выхода исходной карточки.");
  const ingredients: RecipeFamilyIngredient[] = [];
  const skippedOptionalSourceIngredients: string[] = [];
  const inferredMeasurements: { sourceName: string; amount: number; unit: RecipeUnit; basis: string }[] = [];
  for (const [index, mapping] of draft.ingredientMappings.entries()) {
    if (mapping.status === "ignored_microcomponent" || mapping.status === "ignored_noncaloric") continue;
    if (mapping.status !== "mapped" || !mapping.canonicalIngredientId) {
      return noteDerivationIssue(candidate.id, "raw", mapping.sourceName, "Исходный компонент не имеет прямого измеримого canonical mapping.");
    }
    const sourceIngredient = draft.sourceIngredients[index] as { amountMetric?: unknown; unitMetric?: unknown; original?: unknown };
    if (rawOptionalSourceIngredient(sourceIngredient) && !mapping.sourceAmount) {
      skippedOptionalSourceIngredients.push(mapping.sourceName);
      continue;
    }
    const canonical = canonicalIngredients[mapping.canonicalIngredientId];
    if (!canonical) return noteDerivationIssue(candidate.id, "raw", mapping.sourceName, "Canonical ingredient отсутствует в Recipe Family.");
    const original = String(sourceIngredient?.original ?? "");
    const originalMetric = original.match(/(\d+(?:\.\d+)?)\s*(g|ml)\b/i);
    const inferredMeasurement = rawFamilyMeasurement(sourceIngredient, canonical);
    const sourceAmount = mapping.sourceAmount ?? (originalMetric ? Number(originalMetric[1]) : inferredMeasurement?.amount ?? null);
    const sourceUnit = mapping.sourceUnit ?? (originalMetric ? originalMetric[2].toLowerCase() : inferredMeasurement?.unit ?? null);
    if (!sourceAmount || sourceAmount <= 0 || !sourceUnit) {
      return noteDerivationIssue(candidate.id, "raw", mapping.sourceName, "Для исходного компонента нет положительного измеримого количества.");
    }
    const unit = sourceUnit === "ml" ? "ml" : sourceUnit === "piece" || sourceUnit === "шт." ? "piece" : sourceUnit === "g" || sourceUnit === "г" ? "g" : null;
    if (!unit) return noteDerivationIssue(candidate.id, "raw", mapping.sourceName, "Единица исходного компонента не поддерживается Recipe Family.");
    if (!mapping.sourceAmount && !originalMetric && inferredMeasurement) {
      inferredMeasurements.push({ sourceName: mapping.sourceName, amount: sourceAmount, unit, basis: inferredMeasurement.basis });
    }
    const baseAmount = sourceAmount / servings;
    const sourceIngredientId = `source-ingredient-${index + 1}`;
    const role = rawRoleForCanonical(canonical);
    const ingredientBounds = bounds(baseAmount, role);
    const portionFloor = rawPortionFloorRatios[candidate.id];
    if (portionFloor && role !== "fat_cooking")
      ingredientBounds.minAmount = Math.min(
        ingredientBounds.minAmount,
        baseAmount * portionFloor,
      );
    ingredients.push({
      sourceIngredientId,
      canonicalIngredientId: canonical.id,
      baseAmount,
      unit,
      role,
      ...ingredientBounds,
      substitutions: [],
      optional: false,
    });
  }
  if (!ingredients.length) return noteDerivationIssue(candidate.id, "raw", undefined, "Для Recipe Family нужен хотя бы один измеримый компонент.");
  const calculated = nutritionForFamily({ ingredients });
  const reach = nutritionReachForIngredients(ingredients);
  const macros = (candidate.macros ?? candidate.sourceNutrition ?? {}) as Partial<Nutrition>;
  const sourceNutritionKeys: (keyof Nutrition)[] = ["kcal", "protein", "fat", "carbs"];
  const sourceNutrition: Nutrition | null = sourceNutritionKeys.every((key) => Number.isFinite(Number(macros[key])))
    ? { kcal: Number(macros.kcal), protein: Number(macros.protein), fat: Number(macros.fat), carbs: Number(macros.carbs) }
    : null;
  const nutritionDelta = sourceNutrition
    ? { kcal: round(calculated.kcal - sourceNutrition.kcal), protein: round(calculated.protein - sourceNutrition.protein), fat: round(calculated.fat - sourceNutrition.fat), carbs: round(calculated.carbs - sourceNutrition.carbs) }
    : null;
  const title = String(candidate.titleRu ?? candidate.title ?? candidate.sourceTitle ?? candidate.id);
  const time = (candidate.time ?? candidate.sourceTimes ?? {}) as Record<string, unknown>;
  const totalTime = Number(time.totalMinutes);
  const storage = (candidate.storage ?? {}) as Record<string, unknown>;
  const sourceTitle = typeof candidate.sourceTitle === "string" ? candidate.sourceTitle : undefined;
  const imageUrl = typeof candidate.imageUrl === "string" ? candidate.imageUrl : undefined;
  return {
    id: `raw-${candidate.id}`,
    title,
    mealSlots: [String(candidate.slot ?? "lunch")],
    provenance: { sourceTitle, sourceUrl: candidate.sourceUrl, publisher: context.publisher, parsedCandidateId: candidate.id },
    image: { imageUrl, source: sourceTitle, sourceUrl: candidate.sourceUrl, usageStatus: imageUrl ? "reference_only" : "unknown", license: undefined, fetchedAt: context.accessedAt, confidenceMatch: imageUrl ? 1 : 0, manuallyApproved: false, photoType: imageUrl ? "source" : "fallback" },
    ingredients,
    minViableCalories: Math.ceil(reach.minKcal),
    maxViableCalories: Math.floor(Math.max(reach.maxKcal + 12, reach.maxKcal / 0.975)),
    // The publisher's demonstrated batch is the largest vessel load we can
    // defend without inventing cookware dimensions. Larger Mise sessions are
    // split into repeated physical runs by the cooking-run planner.
    geometryLockedMax: servings,
    // Parsed source cards include side dishes and condiments. Enforcing a
    // meal-level protein floor here would make a well-defined low-protein
    // family falsely unsatisfiable; the caller can add a separate protein dish.
    minimumProtein: 0,
    sourceNutrition,
    comparisonNutrition: sourceNutrition,
    legacyEditorialNutrition: sourceNutrition ?? calculated,
    miseCalculatedNutrition: calculated,
    nutritionDelta,
    nutritionDeltaKcal: nutritionDelta?.kcal ?? null,
    editorialAudit: {
      ingredientMapping: {
        source: "raw_candidate",
        reviewedAt: context.accessedAt,
        sourceIngredientCount: draft.sourceIngredients.length,
        sourceSlug: candidate.id,
        ...(skippedOptionalSourceIngredients.length ? { skippedOptionalSourceIngredients } : {}),
        ...(inferredMeasurements.length ? { inferredMeasurements } : {}),
      },
      nutrition: { scope: "per_serving", sourceServings: servings, miseServingToSourceServingRatio: 1, quantitativeCoverage: "verified", comparableToMise: true, reviewedAt: context.accessedAt, note: "Все измеримые mapped-компоненты исходной карточки входят в вычисляемую Recipe Family; source delta хранится как audit fact." },
    },
    miseInstructions: rawRecipeInstructions(candidate, ingredients.map((ingredient) => ingredient.sourceIngredientId)),
    storage,
    freezing: { freezable: Boolean(storage.freezable), storageDays: Number(storage.refrigeratorDays) || 0 },
    complexity: {},
    activeTime: Number.isFinite(totalTime) ? totalTime : 0,
    totalTime: Number.isFinite(totalTime) ? totalTime : 0,
    equipment: [],
    localization: (candidate.localization ?? {}) as Record<string, unknown>,
    substitutions: {},
    reviewStatus: "pilot",
  };
}

function amountStep(ingredient: RecipeFamilyIngredient) {
  const canonical = canonicalIngredients[ingredient.canonicalIngredientId];
  if (canonical.unit.structuralDiscrete) return 1;
  return ingredient.unit === "piece" ? 0.1 : Math.max(1, canonical.unit.roundTo);
}

type SolverIngredientView = {
  id: string;
  perUnit: Nutrition;
  center: number;
  scale: number;
  priority: number;
  step: number;
  gridMin: number;
  gridMax: number;
  baseAmount: number;
  minAmount: number;
  maxAmount: number;
  scalable: boolean;
};

/**
 * Flattens a family into the numeric form the search actually needs. Building
 * it once per solve removes a canonical-ingredient lookup and an object
 * allocation from every candidate evaluation.
 */
function solverView(family: Pick<RecipeFamily, "ingredients">): SolverIngredientView[] {
  return family.ingredients.map((ingredient) => {
    const canonical = canonicalIngredients[ingredient.canonicalIngredientId];
    const step = amountStep(ingredient);
    const gridMin = Math.ceil(ingredient.minAmount / step) * step;
    // Structural whole units cannot be safely truncated (2.9 eggs is three
    // eggs in practice); ordinary measured ingredients remain hard-clamped.
    const gridMax = canonical.unit.structuralDiscrete
      ? Math.ceil(ingredient.maxAmount / step) * step
      : Math.floor(ingredient.maxAmount / step) * step;
    return {
      id: ingredient.sourceIngredientId,
      perUnit: nutritionForAmount(ingredient, 1),
      center: (ingredient.preferredMin + ingredient.preferredMax) / 2,
      scale: 1 / Math.max(1, ingredient.baseAmount),
      priority: ingredient.scalingPriority,
      step,
      gridMin,
      gridMax,
      baseAmount: ingredient.baseAmount,
      minAmount: ingredient.minAmount,
      maxAmount: ingredient.maxAmount,
      // An ingredient whose rounding grid holds no point inside its own bounds
      // cannot move at all. Treating it as scalable made the search waste
      // every iteration on it and reported a flexibility the dish never had.
      scalable: ingredient.scalable && gridMin <= gridMax,
    };
  });
}

function normalizedForView(view: SolverIngredientView, value: number) {
  if (!view.scalable) return view.baseAmount;
  return round(
    Math.max(view.gridMin, Math.min(view.gridMax, Math.round(value / view.step) * view.step)),
    view.step < 1 ? 1 : 0,
  );
}

function totalsForView(views: SolverIngredientView[], amounts: number[]) {
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (let index = 0; index < views.length; index += 1) {
    const { perUnit } = views[index];
    const amount = amounts[index];
    totals.kcal += perUnit.kcal * amount;
    totals.protein += perUnit.protein * amount;
    totals.fat += perUnit.fat * amount;
    totals.carbs += perUnit.carbs * amount;
  }
  return totals;
}

function deviationTerm(view: SolverIngredientView, amount: number) {
  const relative = (amount - view.center) * view.scale;
  return relative * relative * view.priority;
}

function deviationForView(views: SolverIngredientView[], amounts: number[]) {
  let deviation = 0;
  for (let index = 0; index < views.length; index += 1)
    deviation += deviationTerm(views[index], amounts[index]);
  return deviation;
}

type SolveTargets = {
  minimumProtein: number;
  targetCalories: number;
  targetProtein?: number;
  targetCarbs?: number;
  targetFat?: number;
};

function scoreFor(totals: Nutrition, deviation: number, targets: SolveTargets) {
  const kcal = round(totals.kcal);
  const protein = round(totals.protein);
  const fat = round(totals.fat);
  const carbs = round(totals.carbs);
  const proteinFloor = Math.max(targets.minimumProtein, targets.targetProtein ?? 0);
  const shortfall = Math.max(0, proteinFloor - protein);
  // A target of exactly 0 g of protein is a target, not an absent one.
  const proteinError = targets.targetProtein === undefined ? 0 : Math.abs(targets.targetProtein - protein);
  const carbError = targets.targetCarbs === undefined ? 0 : Math.abs(targets.targetCarbs - carbs);
  const fatError = targets.targetFat === undefined ? 0 : Math.abs(targets.targetFat - fat);
  // Calories are a ceiling. A candidate above the target is never selected as
  // a viable portion, so crossing it must be substantially worse than a
  // similarly sized deficit while the search is moving through local states.
  const calorieError = kcal > targets.targetCalories
    ? (kcal - targets.targetCalories) * 1000
    : targets.targetCalories - kcal;
  return calorieError * 10 + shortfall * 150 + proteinError * 2 + carbError * 8 + fatError * 10 + deviation * 50;
}

export function nutritionReachForIngredients(ingredients: RecipeFamilyIngredient[]) {
  const views = solverView({ ingredients });
  const low = totalsForView(views, views.map((view) => normalizedForView(view, view.minAmount)));
  const high = totalsForView(views, views.map((view) => normalizedForView(view, view.maxAmount)));
  return {
    minKcal: round(low.kcal),
    maxKcal: round(high.kcal),
    maxProtein: round(high.protein),
  };
}

function hillClimb(
  family: RecipeFamily,
  seed: "min" | "base" | "preferred",
  targets: SolveTargets,
) {
  const views = solverView(family);
  const amounts = views.map((view) =>
    normalizedForView(view, seed === "min" ? view.minAmount : seed === "preferred" ? view.center : view.baseAmount),
  );
  let totals = totalsForView(views, amounts);
  let deviation = deviationForView(views, amounts);
  let score = scoreFor(totals, deviation, targets);

  type Move = { indexes: number[]; values: number[]; score: number };
  const moveScore = (indexes: number[], values: number[]) => {
    let kcal = totals.kcal, protein = totals.protein, fat = totals.fat, carbs = totals.carbs;
    let nextDeviation = deviation;
    for (let slot = 0; slot < indexes.length; slot += 1) {
      const view = views[indexes[slot]];
      const delta = values[slot] - amounts[indexes[slot]];
      kcal += view.perUnit.kcal * delta;
      protein += view.perUnit.protein * delta;
      fat += view.perUnit.fat * delta;
      carbs += view.perUnit.carbs * delta;
      nextDeviation += deviationTerm(view, values[slot]) - deviationTerm(view, amounts[indexes[slot]]);
    }
    return scoreFor({ kcal, protein, fat, carbs }, nextDeviation, targets);
  };

  for (let iteration = 0; iteration < 2000; iteration += 1) {
    let best: Move | null = null;
    for (let index = 0; index < views.length; index += 1) {
      const view = views[index];
      if (!view.scalable) continue;
      for (const direction of [-1, 1]) {
        const next = normalizedForView(view, amounts[index] + direction * view.step);
        if (next === amounts[index]) continue;
        const nextScore = moveScore([index], [next]);
        if (nextScore + 0.0001 < (best?.score ?? score)) best = { indexes: [index], values: [next], score: nextScore };
      }
    }
    for (let leftIndex = 0; leftIndex < views.length; leftIndex += 1) {
      const left = views[leftIndex];
      if (!left.scalable) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < views.length; rightIndex += 1) {
        const right = views[rightIndex];
        if (!right.scalable) continue;
        const leftCalories = left.perUnit.kcal;
        const rightCalories = right.perUnit.kcal;
        if (leftCalories <= 0 || rightCalories <= 0) continue;
        for (const direction of [-1, 1]) {
          const leftAmount = normalizedForView(left, amounts[leftIndex] + direction * left.step);
          const leftDelta = leftAmount - amounts[leftIndex];
          if (!leftDelta) continue;
          const desiredRightDelta = -(leftDelta * leftCalories) / rightCalories;
          const rightAmount = normalizedForView(
            right,
            amounts[rightIndex] + Math.round(desiredRightDelta / right.step) * right.step,
          );
          if (rightAmount === amounts[rightIndex]) continue;
          const nextScore = moveScore([leftIndex, rightIndex], [leftAmount, rightAmount]);
          if (nextScore + 0.0001 < (best?.score ?? score))
            best = { indexes: [leftIndex, rightIndex], values: [leftAmount, rightAmount], score: nextScore };
        }
      }
    }
    if (!best) break;
    for (let slot = 0; slot < best.indexes.length; slot += 1) amounts[best.indexes[slot]] = best.values[slot];
    // Recomputed from scratch once per accepted move so the incremental
    // candidate arithmetic cannot accumulate drift across 2000 iterations.
    totals = totalsForView(views, amounts);
    deviation = deviationForView(views, amounts);
    score = scoreFor(totals, deviation, targets);
  }

  const solvedAmounts: Record<string, number> = {};
  for (let index = 0; index < views.length; index += 1) solvedAmounts[views[index].id] = amounts[index];
  return { amounts: solvedAmounts, nutrition: nutritionForFamily(family, solvedAmounts), score };
}

export type SolveRecipeFamilyInput = {
  targetCalories: number;
  targetProtein?: number;
  targetCarbs?: number;
  targetFat?: number;
  hardExclusions?: string[];
  /**
   * Share of the recipe's pan/form fat that belongs to THIS portion. Cooking
   * fat is bought and used once per cooking session, so a portion that is one
   * of N carries 1/N of it. Leaving it at 1 makes every portion of a batch
   * claim the whole pan's oil, which is the default only for a lone portion.
   */
  cookingFatShare?: number;
};

const solveCache = new Map<string, SolvedRecipeVariant>();
const SOLVE_CACHE_LIMIT = 4000;
const familyFingerprints = new WeakMap<object, string>();

function familyFingerprint(family: RecipeFamily) {
  const cached = familyFingerprints.get(family);
  if (cached) return cached;
  const fingerprint = [
    family.id,
    family.minViableCalories,
    family.maxViableCalories,
    family.minimumProtein,
    family.ingredients
      .map((ingredient) => `${ingredient.sourceIngredientId}:${ingredient.canonicalIngredientId}:${ingredient.baseAmount}:${ingredient.minAmount}:${ingredient.maxAmount}:${ingredient.scalable ? 1 : 0}`)
      .join(","),
  ].join("|");
  familyFingerprints.set(family, fingerprint);
  return fingerprint;
}

function cloneVariant(variant: SolvedRecipeVariant): SolvedRecipeVariant {
  return { ...variant, amounts: { ...variant.amounts }, explanation: [...variant.explanation] };
}

/** Clears the memoized solutions. Only needed by tests and hot reloads. */
export function resetRecipeSolverCache() {
  solveCache.clear();
}

export function solveRecipeFamily(
  family: RecipeFamily,
  input: SolveRecipeFamilyInput,
): SolvedRecipeVariant {
  const targetCalories = Math.round(input.targetCalories);
  const cookingFatShare = input.cookingFatShare === undefined
    ? 1
    : Math.min(1, Math.max(0, input.cookingFatShare));
  const exclusions = [...new Set(input.hardExclusions ?? [])].sort().join(",");
  // The solve is deterministic in these inputs, so memoizing it is safe and
  // removes the repeated full search the catalog filter used to run per render.
  const cacheKey = `${familyFingerprint(family)}|${targetCalories}|${input.targetProtein ?? ""}|${input.targetCarbs ?? ""}|${input.targetFat ?? ""}|${cookingFatShare}|${exclusions}`;
  const cached = solveCache.get(cacheKey);
  if (cached) return cloneVariant(cached);
  const solved = solveRecipeFamilyUncached(family, input, targetCalories, cookingFatShare);
  if (solveCache.size >= SOLVE_CACHE_LIMIT) solveCache.clear();
  solveCache.set(cacheKey, solved);
  return cloneVariant(solved);
}

function solveRecipeFamilyUncached(
  family: RecipeFamily,
  input: SolveRecipeFamilyInput,
  targetCalories: number,
  cookingFatShare: number,
): SolvedRecipeVariant {
  if (targetCalories < family.minViableCalories || targetCalories > family.maxViableCalories) return { familyId: family.id, targetCalories, targetProtein: input.targetProtein, amounts: {}, nutrition: n(0, 0, 0, 0), viable: false, reason: "outside_calorie_range", explanation: [`Цель ${targetCalories} ккал вне рабочего диапазона ${family.minViableCalories}–${family.maxViableCalories} ккал.`] };
  const exclusions = new Set(input.hardExclusions ?? []);
  const conflict = family.ingredients.find((ingredient) => canonicalIngredients[ingredient.canonicalIngredientId].allergens.some((allergen) => exclusions.has(allergen)));
  if (conflict) return { familyId: family.id, targetCalories, targetProtein: input.targetProtein, amounts: {}, nutrition: n(0, 0, 0, 0), viable: false, reason: "hard_exclusion", explanation: [`Ингредиент ${conflict.canonicalIngredientId} конфликтует с жёстким исключением.`] };
  const solvedFamily = cookingFatShare === 1 || !family.ingredients.some((ingredient) => ingredient.role === "fat_cooking")
    ? family
    : familyWithCookingFatShare(family, cookingFatShare);
  const targets: SolveTargets = {
    minimumProtein: family.minimumProtein,
    targetCalories,
    targetProtein: input.targetProtein,
    targetCarbs: input.targetCarbs,
    targetFat: input.targetFat,
  };
  const candidates = (["min", "base", "preferred"] as const)
    .map((seed) => hillClimb(solvedFamily, seed, targets))
    .sort((a, b) => a.score - b.score);
  // Prefer an under-ceiling candidate even if the unconstrained score would
  // have selected an overage. This remains deterministic for a non-viable
  // result too, so the explanation can show the closest constrained attempt.
  const best = candidates.find((candidate) => candidate.nutrition.kcal <= targetCalories) ?? candidates[0];
  const calorieTolerance = Math.max(12, targetCalories * 0.025);
  const proteinFloor = Math.max(family.minimumProtein, input.targetProtein ?? 0);
  const viable =
    best.nutrition.kcal <= targetCalories &&
    targetCalories - best.nutrition.kcal <= calorieTolerance &&
    best.nutrition.protein + 0.2 >= proteinFloor;
  const changed = solvedFamily.ingredients.filter((ingredient) => Math.abs(best.amounts[ingredient.sourceIngredientId] - ingredient.baseAmount) > (amountStep(ingredient) < 1 ? 0.05 : 0.5)).sort((a, b) => a.scalingPriority - b.scalingPriority);
  return {
    familyId: family.id,
    targetCalories,
    targetProtein: input.targetProtein,
    targetCarbs: input.targetCarbs,
    targetFat: input.targetFat,
    amounts: best.amounts,
    nutrition: best.nutrition,
    viable,
    reason: viable ? undefined : "constraints_unsatisfied",
    explanation: viable
      ? [`Получено ${best.nutrition.kcal} ккал и ${best.nutrition.protein} г белка.`, ...changed.slice(0, 4).map((ingredient) => `${ingredient.role}: ${ingredient.sourceIngredientId} ${ingredient.baseAmount} → ${best.amounts[ingredient.sourceIngredientId]} ${ingredient.unit}.`)]
      : [`В пределах ингредиентных ограничений получено ${best.nutrition.kcal} ккал и ${best.nutrition.protein} г белка; блюдо не деформируется ради цели.`],
  };
}

export function requiredGeometryBatches(
  family: Pick<RecipeFamily, "geometryLockedMax" | "ingredients">,
  portionAmounts: Record<string, number>[],
) {
  const lockedMax = family.geometryLockedMax;
  if (!lockedMax || lockedMax <= 0 || !portionAmounts.length) return 1;
  const largestScale = Math.max(
    1,
    ...family.ingredients
      .filter((ingredient) => ingredient.role !== "fat_cooking" && ingredient.baseAmount > 0)
      .map((ingredient) =>
        portionAmounts.reduce(
          (sum, amounts) => sum + (amounts[ingredient.sourceIngredientId] ?? 0),
          0,
        ) / ingredient.baseAmount,
      ),
  );
  return Math.ceil(largestScale / lockedMax);
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

export function solveRecipeBatch(
  family: RecipeFamily,
  portions: { id: string; targetCalories: number; targetProtein?: number; targetCarbs?: number; targetFat?: number; hardExclusions?: string[] }[],
) {
  const cookingFats = family.ingredients.filter((ingredient) => ingredient.role === "fat_cooking");
  const totalTargetCalories = portions.reduce((sum, portion) => sum + Math.max(0, portion.targetCalories), 0);
  const equalShare = portions.length ? 1 / portions.length : 0;
  const solved = portions.map((portion) => {
    const share = totalTargetCalories > 0
      ? Math.max(0, portion.targetCalories) / totalTargetCalories
      : equalShare;
    return {
      id: portion.id,
      variant: solveRecipeFamily(family, {
        ...portion,
        cookingFatShare: cookingFats.length ? share : 1,
      }),
    };
  });
  const portionsViable = solved.every((item) => item.variant.viable);
  const geometryBatchCount = portionsViable
    ? requiredGeometryBatches(family, solved.map((item) => item.variant.amounts))
    : 1;
  // Until the caller turns `geometryBatchCount` into separately scheduled
  // cooking runs, reject an over-capacity batch rather than silently giving
  // one pan/form unsafe scaled quantities.
  const geometryFits = geometryBatchCount === 1;
  // `geometryLockedMax` is editorial data most families do not have yet, so an
  // unmodelled family must not read as a confirmed "one pan is enough".
  const geometryModelled = typeof family.geometryLockedMax === "number" && family.geometryLockedMax > 0;
  const viable = portionsViable && geometryFits;
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
    reason: !portionsViable ? "constraints_unsatisfied" : geometryFits ? undefined : "geometry_capacity_exceeded",
    geometryBatchCount,
    geometryStatus: !geometryModelled ? "unmodelled" as const : geometryFits ? "fits" as const : "exceeded" as const,
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
      // Pan and form fat is used once per cooking session regardless of how
      // many days the session covers. The matching half of that rule lives in
      // `SolveRecipeFamilyInput.cookingFatShare`: a portion that is one of N
      // must carry 1/N of this amount, or the plan counts the oil N times.
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
      const name = displayNames[ingredient.sourceIngredientId] ?? canonical.canonicalName;
      const amount = round(amounts[ingredient.sourceIngredientId] ?? ingredient.baseAmount);
      if (ingredient.unit === "piece") {
        const grams = round(amount * canonical.unit.gramsPerUnit);
        // "0.4 шт." is not a measurement anyone can act on; below a whole unit
        // the weight is the only usable instruction.
        return canonical.unit.structuralDiscrete || amount >= 1
          ? `${name} — ${grams} г (${amount} шт.)`
          : `${name} — ${grams} г`;
      }
      const unit = ingredient.unit === "ml" ? "мл" : "г";
      return `${name} — ${amount} ${unit}`;
    });
    return `${step.text} ${lines.join("; ")}.`;
  });
}
