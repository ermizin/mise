"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  NotificationSetupPanel,
  type NotificationPlan,
} from "./notification-setup";
import { Icon, type IconName } from "./ui/icon";
import { Note } from "./ui/note";
import { ActionBar } from "./ui/action-bar";
import { plural, withPlural, FORMS } from "@/lib/plural";
import { MacroNumberInput } from "@/components/macro-number-input";
import {
  allocateComponentDish,
  allocateMixedDish,
  type PersonAllocation,
} from "@/domain/portion-allocation";
import {
  materializeInstructions,
  recipeToFamily,
  solveRecipeFamily,
  type RecipeFamily,
} from "@/domain/recipe-engine";
import {
  ACTIVITY_FACTORS,
  NUTRITION_CONFIG,
  calculateMealPlanTargets,
  calculateNutritionTarget,
  capMacrosAtCalories,
  macroCalories as nutritionMacroCalories,
  macrosForCalories as nutritionMacrosForCalories,
  normalizeNutritionTargetMode,
  recalculateDailyMacros as nutritionRecalculateDailyMacros,
  togglePersonMealSlot as togglePersonMealSlotSelection,
  type ActivityKey,
  type MacroKey,
  type MacroPreset,
  type MacroPresetOption,
  type Macros,
  type MealSlot,
  type NutritionCalculation,
  type NutritionGoal,
  type NutritionTargetMode,
  type NutritionWizardInput,
  type Sex,
} from "../lib/nutrition-engine-v2";

type Tab = "week" | "recipes" | "builder" | "shopping" | "profile";
type MenuStyle = "protein" | "budget" | "paleo" | "keto";
type RecipeOrigin = "parsed" | "generated";
type Allergen =
  | "milk"
  | "egg"
  | "gluten"
  | "fish"
  | "soy"
  | "peanut"
  | "treeNuts"
  | "sesame"
  | "mustard"
  | "molluscs";

type Ingredient = {
  id: string;
  name: string;
  quantity: number;
  unit: "г" | "мл" | "шт.";
  group: string;
  allergens: Allergen[];
  checkLabel: boolean;
};
type RecipeProvenance =
  | {
      kind: "parsed";
      sourceTitle: string;
      sourceUrl: string;
      sourceQuery: string;
      adaptation?: string;
      imageUrl?: string;
      imageAlt?: string;
    }
  | { kind: "generated"; basedOn?: string[] };
type RecipeStorage = {
  refrigerator: string;
  ambient?: string;
  freezer: string;
  thaw: string;
  freezerDays?: number;
  freezeParts: string;
};
type RecipeFlex = {
  protein: [number, number];
  fat: [number, number];
  carbs: [number, number];
};
type RecipeEffort = {
  level: "low" | "high";
  knifeActions: number;
  cookware: number;
  activeActions: number;
  activeMinutes: number;
};
type RecipeLocalization = {
  fit: "familiar" | "adapted" | "niche";
  availability: "common" | "specialty";
  note?: string;
};
type RecipePacking = { portion: string; separate?: string; label: string };
type Recipe = {
  id: string;
  slot: MealSlot;
  title: string;
  emoji: string;
  time: number;
  macros: Macros;
  servingWeight: number;
  cost: number;
  tags: MenuStyle[];
  ingredients: Ingredient[];
  allergens: Allergen[];
  steps: string[];
  storageDays: number;
  freezable: boolean;
  provenance: RecipeProvenance;
  storage: RecipeStorage;
  packing: RecipePacking;
  flex: RecipeFlex;
  effort: RecipeEffort;
  localization: RecipeLocalization;
};
type RecipeTuning = { protein: number; fat: number; carbs: number };
type Person = {
  id: string;
  name: string;
  daily: Macros;
  macroPreset?: MacroPreset;
  includedSlots: MealSlot[];
  estimate?: NutritionWizardInput;
  nutritionTargetMode?: NutritionTargetMode;
  dislikes?: string[];
  hardExclusions?: Allergen[];
};
type Batch = {
  id: string;
  index: number;
  start: string;
  end: string;
  days: number;
};
type ShoppingItem = Ingredient & { key: string; checked: boolean };
type ActivePlan = {
  id: string;
  createdAt: string;
  start: string;
  end: string;
  periodDays: number;
  cookEveryDays: number;
  menuStyle: MenuStyle;
  mealSlots: MealSlot[];
  people: Person[];
  batches: Batch[];
  selections: Record<string, string>;
  pinnedSelectionKeys?: string[];
  tuning?: Record<string, RecipeTuning>;
  shopping: ShoppingItem[];
};
type RecipeContext = {
  recipe: Recipe;
  batch?: Batch;
  slot?: MealSlot;
  plan?: ActivePlan;
};
type BuilderMode = "onboarding" | "settings";
type BuilderEntry = {
  step: number;
  batchId?: string;
  returnTab?: Exclude<Tab, "builder">;
  repeat?: boolean;
  mode?: BuilderMode;
  flowId?: string;
  startedAt?: number;
  isNextPlan?: boolean;
};
type BuilderDraft = {
  planId: string | null;
  savedAt: number;
  step: number;
  choiceIndex: number;
  start: string;
  end: string;
  mealSlots: MealSlot[];
  menuStyle: MenuStyle;
  people: Person[];
  cookEveryDays: number;
  remainderDecision: "separate" | "extend" | "shorten" | null;
  selections: Record<string, string>;
  pinnedSelectionKeys?: string[];
};
type OnboardingStep =
  | "welcome"
  | "batches"
  | "reminders"
  /* Инструктаж: не блокирует, открывается из профиля и из карточки готовки. */
  | "rules"
  | "kitchen"
  | "done";
/* Какие напоминания человек выбрал ещё в онбординге. Разрешение здесь не
   запрашивается — это только дефолты для панели напоминаний готового плана. */
type ReminderDefaults = {
  cooking: boolean;
  thaw: boolean;
  "next-plan": boolean;
};
type ClientAnalyticsEvent =
  | "first_open"
  | "onboarding_completed"
  | "plan_create_started"
  | "plan_created"
  | "blocking_error"
  | "shopping_opened"
  | "shopping_item_checked"
  | "cooking_instructions_opened"
  | "cooking_confirmed"
  | "reminders_enabled"
  | "saved_plan_reopened"
  | "next_plan_created";
type ClientAnalyticsFields = {
  flowId?: string;
  durationMs?: number;
  errorCode?:
    | "plan_load"
    | "plan_save"
    | "shopping_save"
    | "reminder_enable";
  pilotEligible?: boolean;
};

const onboardingStorageKey = "mise-onboarding-v3";
const reminderDefaultsKey = "mise-reminder-defaults-v1";
const builderDraftKey = "mise-builder-draft-v3";
const analyticsStoragePrefix = "mise-analytics-v1";

const mealMeta: Record<
  MealSlot,
  { label: string; short: string; icon: string }
> = {
  breakfast: { label: "Завтрак", short: "Завтрак", icon: "☀️" },
  lunch: { label: "Обед", short: "Обед", icon: "🥗" },
  dinner: { label: "Ужин", short: "Ужин", icon: "🌙" },
  snack1: { label: "Перекус 1", short: "Перекус 1", icon: "🍏" },
  snack2: { label: "Перекус 2", short: "Перекус 2", icon: "🥛" },
};
const allMealSlots: MealSlot[] = [
  "breakfast",
  "snack1",
  "lunch",
  "snack2",
  "dinner",
];
const styleMeta: Record<MenuStyle, { label: string; description: string }> = {
  protein: {
    label: "Высокобелковое",
    description: "Больше белка для сытости и восстановления",
  },
  budget: {
    label: "Бюджетное",
    description: "Простые продукты и разумная стоимость",
  },
  paleo: {
    label: "Палео",
    description: "Мясо, рыба, овощи — без зерновых",
  },
  keto: {
    label: "Кето",
    description: "Меньше углеводов, больше полезных жиров",
  },
};
const macroLabels: Record<MacroKey, string> = {
  kcal: "К",
  protein: "Б",
  fat: "Ж",
  carbs: "У",
};
const macroPresetMeta: Record<
  MacroPresetOption,
  {
    label: string;
    description: string;
    protein: number;
    fat: number;
    carbs: number;
  }
> = {
  balanced: {
    label: "Сбалансировано",
    description: "Б 30% · Ж 30% · У 40%",
    protein: 0.3,
    fat: 0.3,
    carbs: 0.4,
  },
  protein: {
    label: "Больше белка",
    description: "Б 35% · Ж 30% · У 35%",
    protein: 0.35,
    fat: 0.3,
    carbs: 0.35,
  },
  carbs: {
    label: "Больше углеводов",
    description: "Б 25% · Ж 25% · У 50%",
    protein: 0.25,
    fat: 0.25,
    carbs: 0.5,
  },
  fat: {
    label: "Больше жиров",
    description: "Б 30% · Ж 40% · У 30%",
    protein: 0.3,
    fat: 0.4,
    carbs: 0.3,
  },
};
const defaultMacros: Macros = { kcal: 2100, protein: 158, fat: 70, carbs: 210 };
const defaultNutritionEstimate: NutritionWizardInput = {
  sex: "male",
  age: 30,
  height: 178,
  weight: 78,
  activity: "medium",
  musclePriority: false,
  goal: "loss",
  monthlyWeightChangeKg: 1,
};
const activityMeta: Record<ActivityKey, { label: string; factor: number }> = {
  low: { label: "Сидячий образ жизни", factor: ACTIVITY_FACTORS.low },
  light: { label: "1–2 тренировки в неделю", factor: ACTIVITY_FACTORS.light },
  medium: { label: "3–4 тренировки в неделю", factor: ACTIVITY_FACTORS.medium },
  high: { label: "5–6 тренировок в неделю", factor: ACTIVITY_FACTORS.high },
  athlete: {
    label: "Ежедневные нагрузки или физический труд",
    factor: ACTIVITY_FACTORS.athlete,
  },
};
const goalMeta: Record<NutritionGoal, { label: string }> = {
  loss: { label: "Снижение веса" },
  maintenance: { label: "Поддержание веса" },
  gain: { label: "Набор массы" },
};
const allergenMeta: Record<Allergen, { label: string; short: string }> = {
  milk: { label: "Молоко и молочные продукты", short: "Молоко" },
  egg: { label: "Яйца", short: "Яйца" },
  gluten: { label: "Глютен", short: "Глютен" },
  fish: { label: "Рыба", short: "Рыба" },
  soy: { label: "Соя", short: "Соя" },
  peanut: { label: "Арахис", short: "Арахис" },
  treeNuts: { label: "Орехи", short: "Орехи" },
  sesame: { label: "Кунжут", short: "Кунжут" },
  mustard: { label: "Горчица", short: "Горчица" },
  molluscs: { label: "Моллюски", short: "Моллюски" },
};
const dislikeOptions = [
  { id: "fish", label: "Рыба", ingredientIds: ["salmon", "cod", "tuna"] },
  { id: "cottage", label: "Творог", ingredientIds: ["cottage"] },
  { id: "egg", label: "Яйца", ingredientIds: ["egg"] },
  { id: "tofu", label: "Тофу", ingredientIds: ["tofu"] },
  { id: "broccoli", label: "Брокколи", ingredientIds: ["broccoli"] },
  { id: "buckwheat", label: "Гречка", ingredientIds: ["buckwheat"] },
  {
    id: "legumes",
    label: "Бобовые",
    ingredientIds: [
      "lentils",
      "white-beans",
      "red-beans",
      "black-beans",
      "green-beans",
      "beans",
      "peas",
      "chickpeas",
    ],
  },
  { id: "avocado", label: "Авокадо", ingredientIds: ["avocado"] },
  {
    id: "coconut",
    label: "Кокос",
    ingredientIds: ["coconut-milk", "coconut-oil", "coconut-flakes"],
  },
  {
    id: "turkey",
    label: "Индейка",
    ingredientIds: ["turkey", "turkey-mince", "turkey-slices"],
  },
] as const;
const ingredientAllergens: Record<string, Allergen[]> = {
  almond: ["treeNuts"],
  "almond-flour": ["treeNuts"],
  "almond-paste": ["treeNuts"],
  bread: ["gluten"],
  bouillon: ["soy", "gluten"],
  bulgur: ["gluten"],
  butter: ["milk"],
  cheese: ["milk"],
  cod: ["fish"],
  cottage: ["milk"],
  cream: ["milk"],
  "cream-cheese": ["milk"],
  egg: ["egg"],
  feta: ["milk"],
  flatbread: ["gluten"],
  gochujang: ["soy", "gluten"],
  hummus: ["sesame"],
  kefir: ["milk"],
  mayonnaise: ["egg"],
  milk: ["milk"],
  mozzarella: ["milk"],
  mustard: ["mustard"],
  "oyster-sauce": ["molluscs", "soy", "gluten"],
  oats: ["gluten"],
  parmesan: ["milk"],
  pasta: ["gluten"],
  "peanut-butter": ["peanut"],
  "protein-powder": ["milk"],
  salmon: ["fish"],
  soy: ["soy", "gluten"],
  tahini: ["sesame"],
  tofu: ["soy"],
  tortilla: ["gluten"],
  tuna: ["fish"],
  worcestershire: ["fish"],
  walnut: ["treeNuts"],
  yogurt: ["milk"],
};
const packagedIngredientIds = new Set([
  "bbq-sauce",
  "bread",
  "bouillon",
  "broth",
  "cheese",
  "cream-cheese",
  "flatbread",
  "gochujang",
  "hot-sauce",
  "hummus",
  "mayonnaise",
  "mustard",
  "oyster-sauce",
  "oats",
  "pasta",
  "peanut-butter",
  "pickles",
  "protein-powder",
  "salsa",
  "soy",
  "sriracha",
  "tahini",
  "tomato-passata",
  "tomato-paste",
  "tortilla",
  "worcestershire",
  "yogurt",
]);
const i = (
  id: string,
  name: string,
  quantity: number,
  unit: Ingredient["unit"],
  group: string,
): Ingredient => ({
  id,
  name,
  quantity,
  unit,
  group,
  allergens: [...(ingredientAllergens[id] ?? [])],
  checkLabel: packagedIngredientIds.has(id),
});
const noKnifeIngredientIds = new Set([
  "oats",
  "buckwheat",
  "rice",
  "brown-rice",
  "quinoa",
  "lentils",
  "white-beans",
  "red-beans",
  "pasta",
  "bulgur",
  "chia",
  "seeds",
  "cocoa",
  "milk",
  "kefir",
  "yogurt",
  "cottage",
  "cream",
  "egg",
  "oil",
  "olive-oil",
  "coconut-oil",
  "soy",
  "tomato-passata",
  "coconut-milk",
  "protein-powder",
]);
function estimateEffort(
  title: string,
  time: number,
  ingredients: Ingredient[],
  steps: string[],
): RecipeEffort {
  const knifeActions = ingredients.filter(
    (ingredient) =>
      !noKnifeIngredientIds.has(ingredient.id) && ingredient.group !== "Крупы",
  ).length;
  const text = `${title} ${steps.join(" ")}`.toLowerCase();
  const noCook = !/(?:вар|жар|печ|духов|туш|сковород|кастрюл)/.test(text);
  const onePot = /(?:одной кастрюл|одной форм|блендер)/.test(text);
  const cookware =
    noCook || onePot
      ? 1
      : /(?:духов|запек).*(?:вар|сковород)|(?:вар|сковород).*(?:духов|запек)/.test(
            text,
          )
        ? 3
        : 2;
  const activeActions = steps.length + knifeActions;
  const activeMinutes = Math.min(
    time,
    Math.max(3, steps.length * 3 + knifeActions * 2),
  );
  return {
    level: knifeActions + cookware + activeActions <= 9 ? "low" : "high",
    knifeActions,
    cookware,
    activeActions,
    activeMinutes,
  };
}
type RecipeMeta = {
  provenance?: RecipeProvenance;
  storage?: Partial<RecipeStorage>;
  packing?: Partial<RecipePacking>;
  flex?: Partial<RecipeFlex>;
  effort?: Partial<RecipeEffort>;
  localization?: Partial<RecipeLocalization>;
  allergens?: Allergen[];
};

function ingredientAmount(ingredient: Ingredient) {
  return `${ingredient.name} — ${ingredient.quantity} ${ingredient.unit}`;
}

function generatedRecipeSteps(
  title: string,
  ingredients: Ingredient[],
  totalMinutes: number,
) {
  const text = title.toLowerCase();
  const ingredientIds = new Set(ingredients.map((ingredient) => ingredient.id));
  const rawProteinIds = new Set([
    "chicken",
    "chicken-thigh",
    "chicken-mince",
    "turkey",
    "turkey-mince",
    "beef",
    "beef-mince",
    "pork-mince",
    "salmon",
    "cod",
  ]);
  const rawProteins = ingredients.filter((ingredient) =>
    rawProteinIds.has(ingredient.id),
  );
  const produce = ingredients.filter(
    (ingredient) => ingredient.group === "Овощи и фрукты",
  );
  const measured = `На одну базовую порцию отмерьте: ${ingredients.map(ingredientAmount).join("; ")}.`;
  const finish =
    "Разделите готовое блюдо на равные порции по числу контейнеров; точная масса каждой порции указана во вкладке «Разложить».";

  if (/смузи/.test(text))
    return [
      measured,
      "Сложите все компоненты в чашу блендера и пробейте до однородности; при необходимости добавляйте воду по 1 столовой ложке.",
      "Перелейте порцию в бутылку с плотной крышкой и сразу уберите в холодильник.",
    ];
  if (/чиа|пудинг|крем с какао/.test(text))
    return [
      measured,
      "Смешайте жидкую основу с сухими компонентами венчиком, оставьте на 5 минут и перемешайте ещё раз, разбивая комки.",
      "Разложите по порционным банкам, добавки держите сверху или отдельно и дайте смеси загустеть в холодильнике.",
    ];
  if (/йогурт с|творог с огур|моцарелла с|яблоко с|яблочные дольки/.test(text))
    return [
      measured,
      "Вымойте и обсушите свежие продукты; нарежьте их непосредственно перед раскладкой.",
      "Разложите основную часть и влажные либо хрустящие добавки по разным отделениям контейнера, чтобы смешать перед едой.",
    ];
  if (/тунец с хрустящ|ролл|рулет|тост/.test(text) && !/омлет-ролл/.test(text))
    return [
      measured,
      "Подготовьте начинку: сырое мясо сначала приготовьте, готовые белковые продукты нарежьте; овощи обсушите и нарежьте тонко.",
      "Хлеб, лепёшку или внешнюю оболочку держите отдельно от влажной начинки и собирайте перед едой.",
      finish,
    ];
  if (/домашний хумус/.test(text))
    return [
      measured,
      "Промойте нут, затем пробейте его с тахини, лимонным соком, оливковым маслом и чесноком до однородности.",
      "Добавьте 15 мл воды и ещё раз взбейте; переложите хумус в маленькую банку, а лепёшку держите отдельно.",
      finish,
    ];
  if (/конфет|шарик|жир-бомб|батончик/.test(text))
    return rawProteins.length
      ? [
          measured,
          `Приготовьте ${rawProteins.map((ingredient) => ingredient.name.toLowerCase()).join(" и ")} до полной готовности, остудите и очень мелко нарежьте.`,
          "Смешайте белковую часть с остальными компонентами, сформуйте одинаковые шарики или батончики и охладите до плотности.",
          finish,
        ]
      : [
          measured,
          "Измельчите сухие компоненты, затем вмешайте связующую основу до пластичной массы; если масса мягкая, охладите её 10 минут.",
          "Сформуйте одинаковые шарики или утрамбуйте массу пластом и разрежьте на равные батончики.",
          finish,
        ];
  if (/сырник|панкейк|оладь/.test(text))
    return [
      measured,
      "Измельчите хлопья, если они используются, и смешайте их с остальными компонентами до густого однородного теста.",
      "Сформуйте одинаковые заготовки и готовьте на антипригарной сковороде небольшими партиями до устойчивой формы и румяной поверхности с обеих сторон.",
      "Полностью остудите на решётке; крем, йогурт и свежие добавки упакуйте отдельно.",
      finish,
    ];
  if (/омлет-ролл/.test(text))
    return [
      measured,
      "Приготовьте и мелко нарежьте начинку, яйца размешайте до однородности.",
      "Вылейте яйца тонким слоем на антипригарную сковороду, распределите начинку и сверните плотный рулет, когда основа схватится.",
      "Остудите рулет швом вниз, нарежьте поперёк и разложите поровну.",
      finish,
    ];
  if (/авокад.*яйц/.test(text))
    return [
      measured,
      "Разрежьте авокадо пополам, удалите косточку и ложкой немного расширьте углубление.",
      "Положите половинки в небольшую форму, в каждое углубление аккуратно добавьте яйцо и запекайте при 180 °C до желаемой плотности.",
      "Остудите и упакуйте без переворачивания; это блюдо готовьте только для холодильника.",
    ];
  if (
    /омлет|фриттат|маффин|запеканк|брауни|печень|квадратик|суфле|крекер|запечённ.*яйц/.test(
      text,
    )
  ) {
    const preparation = rawProteins.length
      ? `Мелко нарежьте ${rawProteins.map((ingredient) => ingredient.name.toLowerCase()).join(" и ")} и приготовьте до полной готовности; овощи измельчите, яйца размешайте отдельно.`
      : produce.length
        ? `Нарежьте или натрите ${produce.map((ingredient) => ingredient.name.toLowerCase()).join(" и ")}; яйца и жидкие компоненты перемешайте отдельно.`
        : ingredientIds.has("egg")
          ? "Смешайте сухие компоненты, отдельно размешайте яйца, затем соедините обе части до однородности."
          : "Смешайте сухие и жидкие компоненты отдельно, затем соедините их до однородности.";
    return [
      measured,
      preparation,
      "Распределите смесь ровным слоем в форме или одинаково по ячейкам и запекайте при 180 °C до плотной середины и румяных краёв.",
      "Дайте заготовке остыть, выньте из формы и разделите на одинаковые части.",
      finish,
    ];
  }
  if (/тефтел|котлет|голубц|наггетс/.test(text))
    return [
      measured,
      "Если есть крупа или картофель, приготовьте их отдельно; овощи мелко нарежьте или натрите.",
      "Смешайте фарш с компонентами для связки, сформуйте одинаковые тефтели, котлеты или наггетсы и приготовьте их до полной готовности выбранным способом.",
      "Соус прогрейте отдельно, затем соедините с мясной частью; гарнир оставьте в соседнем отделении контейнера.",
      finish,
    ];
  if (/карри|похл[её]б|чечевиц|туш[её]н|плов|фасол|сливочном соусе/.test(text))
    return [
      measured,
      "Промойте крупу или бобовые; мясо и овощи нарежьте одинаковыми небольшими кусочками.",
      "Подрумяньте мясную часть, добавьте овощи, затем крупу или бобовые и жидкую основу; готовьте под крышкой до мягкости всех компонентов.",
      "Отрегулируйте густоту небольшим количеством воды, перемешайте и разделите блюдо поровну.",
      finish,
    ];
  if (/паста|лапш|гречк|булгур|киноа|рис/.test(text))
    return [
      measured,
      "Отдельно приготовьте крупу, пасту или лапшу; мясо и овощи нарежьте удобными для одного укуса кусочками.",
      "Приготовьте белковую часть, добавьте овощи и соус, затем соедините с гарниром или оставьте компоненты рядом в контейнере.",
      "Дайте пару выйти в неглубокой посуде и разделите блюдо поровну, не утрамбовывая гарнир.",
      finish,
    ];
  if (/пюре/.test(text))
    return [
      measured,
      "Нарежьте овощи, предназначенные для пюре, одинаковыми кусочками и приготовьте до мягкости; белковую часть подготовьте отдельно.",
      "Разомните овощи до нужной текстуры, а мясо или рыбу приготовьте до полной готовности.",
      "В контейнер положите пюре с одной стороны, белковую часть — с другой, не смешивая до разогрева.",
      finish,
    ];
  if (/лосос|треск|рыб|куриц|индейк|говядин|стейк|свинин|тофу/.test(text))
    return [
      measured,
      "Нарежьте овощи одинаковыми кусочками, белковую часть обсушите и приправьте по вкусу.",
      `Приготовьте овощи и белковую часть на противне, сковороде или в сотейнике так, чтобы уложиться примерно в ${totalMinutes} минут общего времени.`,
      "Соус и свежие добавки держите отдельно; горячие компоненты разделите поровну.",
      finish,
    ];
  return [
    measured,
    "Подготовьте каждый компонент отдельно: промойте, обсушите и нарежьте продукты одинаковыми кусочками.",
    "Приготовьте компоненты до нужной текстуры, соединяя их только там, где это предусмотрено названием блюда.",
    finish,
  ];
}

function packingFor(
  title: string,
  ingredients: Ingredient[],
  servingWeight: number,
): RecipePacking {
  const text = title.toLowerCase();
  const ids = new Set(ingredients.map((ingredient) => ingredient.id));
  const label = `${title} · около ${servingWeight} г · дата и приём пищи`;
  if (/смузи/.test(text))
    return {
      portion: `Одна порция — бутылка примерно на ${servingWeight} мл с запасом для взбалтывания.`,
      label,
    };
  if (/чиа|пудинг|крем с какао|йогурт с/.test(text))
    return {
      portion: `Одна порция — банка объёмом не меньше ${Math.ceil(servingWeight / 50) * 50} мл.`,
      separate:
        "Ягоды, семечки и хрустящие добавки положить в маленький сухой отсек.",
      label,
    };
  if (
    /маффин|сырник|панкейк|олад|котлет|тефтел|наггетс|шарик|рулет|ролл|батончик|квадратик|печень|крекер|брауни|запеканк|фриттат|омлет/.test(
      text,
    )
  )
    return {
      portion:
        "Сначала посчитайте все готовые изделия или куски, затем разделите их поровну между контейнерами.",
      separate:
        ids.has("yogurt") || ids.has("cream-cheese") || ids.has("hummus")
          ? "Соус или крем — в отдельную маленькую ёмкость; лепёшку и свежие овощи не прижимать к влажной начинке."
          : undefined,
      label,
    };
  const hasFresh = [
    "avocado",
    "cucumber",
    "tomato",
    "greens",
    "lettuce",
    "berries",
  ].some((id) => ids.has(id));
  const hasBase = [
    "rice",
    "brown-rice",
    "buckwheat",
    "quinoa",
    "pasta",
    "bulgur",
    "potato",
    "sweet-potato",
  ].some((id) => ids.has(id));
  const mixedDish =
    /паста|макарон|лапш|карри|плов|похл[её]б|туш[её]н|чечевиц|фасол|запеканк/.test(
      text,
    );
  return {
    portion: `Одна готовая порция — ориентировочно ${servingWeight} г; при нескольких контейнерах сначала взвесьте всё блюдо и разделите массу поровну.`,
    separate:
      hasBase && !mixedDish
        ? "Гарнир занимает одно отделение, белковая часть и приготовленные овощи — другое."
        : hasFresh
          ? "Свежие добавки держите в отдельном отсеке и добавляйте после разогрева основной части."
          : undefined,
    label,
  };
}

function storageFor(
  storageDays: number,
  freezable: boolean,
  ingredients: Ingredient[],
): RecipeStorage {
  const freshIds = new Set([
    "avocado",
    "cucumber",
    "tomato",
    "greens",
    "lettuce",
    "berries",
    "yogurt",
    "hummus",
  ]);
  const separate = ingredients.some((ingredient) =>
    freshIds.has(ingredient.id),
  );
  if (!freezable)
    return {
      refrigerator: `В закрытом контейнере при ≤4 °C — ориентировочно до ${storageDays} суток.`,
      freezer:
        "Не замораживать: после разморозки заметно пострадает текстура блюда.",
      thaw: "Разморозка не предусмотрена; готовьте только объём для холодильного хранения.",
      freezeParts: "Заморозка не предусмотрена.",
    };
  return {
    refrigerator: `В закрытом контейнере при ≤4 °C — ориентировочно до ${storageDays} суток.`,
    freezer:
      "Разложить в неглубокие порционные контейнеры, охладить в холодильнике и перенести предназначенные для заморозки порции в морозилку.",
    thaw: "Переложить порцию в холодильник накануне; после размораживания разогреть перед подачей.",
    freezerDays: 60,
    freezeParts: separate
      ? "Замораживать приготовленную основу; свежие овощи, зелень, ягоды и холодные соусы упаковать отдельно и не замораживать вместе с ней."
      : "Замораживать готовую порцию целиком в подписанном контейнере.",
  };
}

const r = (
  id: string,
  slot: MealSlot,
  title: string,
  emoji: string,
  time: number,
  macros: Macros,
  servingWeight: number,
  cost: number,
  tags: MenuStyle[],
  ingredients: Ingredient[],
  suppliedSteps: string[],
  storageDays = 3,
  freezable = true,
  meta: RecipeMeta = {},
): Recipe => {
  const steps = suppliedSteps.length
    ? [
        `На одну базовую порцию отмерьте: ${ingredients.map(ingredientAmount).join("; ")}.`,
        ...suppliedSteps,
        ...(suppliedSteps.some((step) =>
          /контейнер|порци|банк|бутылк|замороз/i.test(step),
        )
          ? []
          : [
              "Разделите готовое блюдо на равные порции; практическая схема упаковки указана во вкладке «Разложить».",
            ]),
      ]
    : generatedRecipeSteps(title, ingredients, time);
  const packing = packingFor(title, ingredients, servingWeight);
  const allergens = [
    ...new Set([
      ...ingredients.flatMap((ingredient) => ingredient.allergens),
      ...(meta.allergens ?? []),
    ]),
  ];
  return {
    id,
    slot,
    title,
    emoji,
    time,
    macros,
    servingWeight,
    cost,
    tags,
    ingredients,
    allergens,
    steps,
    storageDays,
    freezable,
    provenance: meta.provenance ?? { kind: "generated" },
    localization: {
      fit: "familiar",
      availability: "common",
      ...meta.localization,
    },
    flex: {
      protein: [0.8, 1.25],
      fat: [0.8, 1.2],
      carbs: [0.7, 1.3],
      ...meta.flex,
    },
    effort: {
      ...estimateEffort(title, time, ingredients, steps),
      ...meta.effort,
    },
    storage: {
      ...storageFor(storageDays, freezable, ingredients),
      ...meta.storage,
    },
    packing: { ...packing, ...meta.packing },
  };
};
const commonSteps: string[] = [];

const recipeSources = {
  cottageBake: {
    title: "ПП творожная запеканка",
    url: "https://food.ru/recipes/66774-pp-tvorozhnaja-zapekanka",
    query: "пп питание",
  },
  syrniki: {
    title: "Диетические сырники из творога",
    url: "https://food.ru/recipes/1301-dieticheskie-syrniki-iz-tvoroga",
    query: "рецепты для похудения",
  },
  proteinOats: {
    title: "Protein overnight oats",
    url: "https://www.bbcgoodfood.com/recipes/protein-overnight-oats",
    query: "mealprep recipes",
    imageUrl:
      "https://images.immediate.co.uk/production/volatile/sites/30/2025/02/OvernightOats-bf5484f.jpg?quality=90&resize=708%2C643",
    imageAlt: "Ночная овсянка с ягодами",
  },
  chickenBuckwheat: {
    title: "Гречка с курицей ПП для похудения",
    url: "https://food.ru/recipes/106546-grechka-s-kuritsei-pp-dlia-pokhudeniia-1643971324",
    query: "рецепты для похудения",
  },
  chickenRice: {
    title: "Рис с курицей и овощами в рукаве",
    url: "https://food.ru/recipes/58187-ris-kuricei-i-ovoshchami-v-rukave",
    query: "пп питание",
  },
  chickenBowl: {
    title: "Naked Chicken Burrito Bowl Meal Prep",
    url: "https://www.myprotein.com/thezone/recipe/naked-chicken-burrito-bowl-meal-prep/",
    query: "меню на массу",
  },
  salmonPrep: {
    title: "Quick Spicy Cajun Salmon & Garlicky Veg",
    url: "https://us.myprotein.com/thezone/recipe/healthy-meals/salmon-meal-prep-spicy-cajun-salmon/",
    query: "меню на сушку",
  },
  turkeyMeatballs: {
    title: "Тефтели из индейки",
    url: "https://food.ru/recipes/125276-tefteli-iz-indeiki-1646231123",
    query: "пп питание",
  },
  onePotChicken: {
    title: "One-pot chicken & rice",
    url: "https://www.bbcgoodfood.com/recipes/one-pot-chicken-rice",
    query: "mealprep recipes",
  },
  berrySmoothie: {
    title: "Berry protein smoothie",
    url: "https://www.bbcgoodfood.com/recipes/berry-protein-smoothie",
    query: "mealprep recipes",
  },
  frozenYogurt: {
    title: "Instant frozen berry yogurt",
    url: "https://www.bbcgoodfood.com/recipes/instant-frozen-berry-yogurt",
    query: "рецепты для похудения",
  },
  tacoMac: {
    title: "Taco Mac",
    url: "https://mealprepmanual.com/taco-mac/",
    query: "mealprep recipes",
    imageUrl:
      "https://mealprepmanual.com/wp-content/uploads/2026/01/Taco-Mac-806x1024.jpg",
    imageAlt: "Макароны с говядиной, томатами и сыром в контейнере",
  },
  teriyakiTray: {
    title: "Sheet Pan Teriyaki Chicken and Vegetables",
    url: "https://mealprepmanual.com/sheet-pan-teriyaki-chicken-and-vegetables/",
    query: "mealprep recipes",
    imageUrl:
      "https://mealprepmanual.com/wp-content/uploads/2026/02/Sheet-Pan-Teriyaki-Chicken-807x1024.jpg",
    imageAlt: "Курица терияки с рисом, бататом и брокколи",
  },
  halalChicken: {
    title: "Halal Cart Style Chicken Buffet Prep",
    url: "https://mealprepmanual.com/halal-cart-style-chicken-buffet-prep/",
    query: "mealprep recipes",
    imageUrl:
      "https://mealprepmanual.com/wp-content/uploads/2025/05/Halal-Cart-Chicken-807x1024.jpg",
    imageAlt: "Пряная курица с золотым рисом, овощами и белым соусом",
  },
} as const;
type RecipeSource = {
  title: string;
  url: string;
  query: string;
  imageUrl?: string;
  imageAlt?: string;
};
const parsed = (
  source: RecipeSource,
  adaptation?: string,
): RecipeProvenance => ({
  kind: "parsed",
  sourceTitle: source.title,
  sourceUrl: source.url,
  sourceQuery: source.query,
  adaptation,
  imageUrl: source.imageUrl,
  imageAlt: source.imageAlt,
});
const mealPrepManualParsed = (
  title: string,
  slug: string,
  imageUrl: string,
  imageAlt: string,
  adaptation?: string,
): RecipeProvenance =>
  parsed(
    {
      title,
      url: `https://mealprepmanual.com/${slug}/`,
      query: "mealprep recipes",
      imageUrl,
      imageAlt,
    },
    adaptation,
  );

const recipes: Recipe[] = [
  r(
    "oats-berry",
    "breakfast",
    "Овсянка с ягодами и творогом",
    "🫐",
    12,
    { kcal: 430, protein: 32, fat: 11, carbs: 52 },
    360,
    145,
    ["protein", "budget"],
    [
      i("oats", "Овсяные хлопья", 60, "г", "Крупы"),
      i("cottage", "Творог 5%", 120, "г", "Молочное"),
      i("berries", "Ягоды", 80, "г", "Овощи и фрукты"),
    ],
    commonSteps,
    3,
    false,
  ),
  r(
    "omelet-green",
    "breakfast",
    "Омлет со шпинатом и фетой",
    "🍳",
    15,
    { kcal: 410, protein: 31, fat: 27, carbs: 9 },
    300,
    170,
    ["protein", "keto"],
    [
      i("egg", "Яйца", 3, "шт.", "Молочное"),
      i("spinach", "Шпинат", 70, "г", "Овощи и фрукты"),
      i("feta", "Фета", 45, "г", "Молочное"),
    ],
    commonSteps,
    3,
    false,
  ),
  r(
    "syrniki",
    "breakfast",
    "Сырники с йогуртом",
    "🥞",
    25,
    { kcal: 455, protein: 38, fat: 16, carbs: 40 },
    330,
    155,
    ["protein", "budget"],
    [
      i("cottage", "Творог 5%", 220, "г", "Молочное"),
      i("egg", "Яйца", 1, "шт.", "Молочное"),
      i("yogurt", "Греческий йогурт", 80, "г", "Молочное"),
    ],
    commonSteps,
    4,
    true,
  ),
  r(
    "chia-coconut",
    "breakfast",
    "Чиа-пудинг с кокосом",
    "🥥",
    8,
    { kcal: 390, protein: 18, fat: 27, carbs: 18 },
    310,
    195,
    ["keto", "paleo"],
    [
      i("chia", "Семена чиа", 35, "г", "Бакалея"),
      i("coconut-milk", "Кокосовое молоко", 180, "мл", "Бакалея"),
      i("berries", "Ягоды", 60, "г", "Овощи и фрукты"),
    ],
    commonSteps,
    4,
    false,
  ),
  r(
    "turkey-toast",
    "breakfast",
    "Тост с индейкой и авокадо",
    "🥑",
    10,
    { kcal: 440, protein: 34, fat: 20, carbs: 31 },
    320,
    205,
    ["protein"],
    [
      i("turkey", "Филе индейки", 120, "г", "Мясо и рыба"),
      i("bread", "Цельнозерновой хлеб", 70, "г", "Хлеб"),
      i("avocado", "Авокадо", 0.5, "шт.", "Овощи и фрукты"),
    ],
    commonSteps,
    2,
    false,
  ),
  r(
    "panang",
    "lunch",
    "Пананг карри с курицей",
    "🍛",
    25,
    { kcal: 540, protein: 54, fat: 19, carbs: 44 },
    430,
    245,
    ["protein"],
    [
      i("brown-rice", "Коричневый рис", 55, "г", "Крупы"),
      i("chicken", "Куриное филе", 200, "г", "Мясо и рыба"),
      i("pepper", "Болгарский перец", 0.5, "шт.", "Овощи и фрукты"),
      i("beans", "Стручковая фасоль", 70, "г", "Овощи и фрукты"),
      i("coconut-milk", "Кокосовое молоко", 75, "мл", "Бакалея"),
    ],
    commonSteps,
    3,
    true,
  ),
  r(
    "korean-bowl",
    "lunch",
    "Куриный боул по-корейски",
    "🥗",
    22,
    { kcal: 510, protein: 48, fat: 14, carbs: 52 },
    420,
    225,
    ["protein", "budget"],
    [
      i("chicken", "Куриное филе", 180, "г", "Мясо и рыба"),
      i("rice", "Рис", 60, "г", "Крупы"),
      i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"),
      i("carrot", "Морковь", 0.5, "шт.", "Овощи и фрукты"),
      i("soy", "Соевый соус", 20, "мл", "Бакалея"),
    ],
    commonSteps,
    3,
    true,
  ),
  r(
    "turkey-veg",
    "lunch",
    "Индейка с печёными овощами",
    "🥘",
    30,
    { kcal: 485, protein: 46, fat: 17, carbs: 37 },
    430,
    215,
    ["protein", "paleo"],
    [
      i("turkey", "Филе индейки", 190, "г", "Мясо и рыба"),
      i("potato", "Картофель", 180, "г", "Овощи и фрукты"),
      i("tomato", "Томаты", 1, "шт.", "Овощи и фрукты"),
      i("zucchini", "Кабачок", 120, "г", "Овощи и фрукты"),
    ],
    commonSteps,
    4,
    true,
  ),
  r(
    "salmon-quinoa",
    "lunch",
    "Лосось с киноа и брокколи",
    "🐟",
    28,
    { kcal: 560, protein: 42, fat: 28, carbs: 34 },
    400,
    365,
    ["protein"],
    [
      i("salmon", "Филе лосося", 170, "г", "Мясо и рыба"),
      i("quinoa", "Киноа", 55, "г", "Крупы"),
      i("broccoli", "Брокколи", 160, "г", "Овощи и фрукты"),
    ],
    commonSteps,
    2,
    true,
  ),
  r(
    "lentil-stew",
    "lunch",
    "Чечевица с курицей и томатами",
    "🫘",
    35,
    { kcal: 525, protein: 44, fat: 12, carbs: 58 },
    450,
    155,
    ["budget", "protein"],
    [
      i("chicken", "Куриное филе", 140, "г", "Мясо и рыба"),
      i("lentils", "Красная чечевица", 75, "г", "Крупы"),
      i("tomato", "Томаты", 1, "шт.", "Овощи и фрукты"),
      i("onion", "Лук", 0.5, "шт.", "Овощи и фрукты"),
    ],
    commonSteps,
    4,
    true,
  ),
  r(
    "aji-chicken",
    "dinner",
    "Курица ахи-верде с картофелем",
    "🍗",
    30,
    { kcal: 520, protein: 50, fat: 18, carbs: 39 },
    420,
    240,
    ["protein", "paleo"],
    [
      i("chicken", "Куриное филе", 190, "г", "Мясо и рыба"),
      i("potato", "Картофель", 190, "г", "Овощи и фрукты"),
      i("greens", "Зелень", 30, "г", "Овощи и фрукты"),
      i("yogurt", "Греческий йогурт", 45, "г", "Молочное"),
    ],
    commonSteps,
    3,
    true,
  ),
  r(
    "beef-wok",
    "dinner",
    "Говядина вок с овощами",
    "🥩",
    24,
    { kcal: 500, protein: 43, fat: 25, carbs: 24 },
    390,
    285,
    ["protein", "keto", "paleo"],
    [
      i("beef", "Постная говядина", 180, "г", "Мясо и рыба"),
      i("pepper", "Болгарский перец", 0.5, "шт.", "Овощи и фрукты"),
      i("broccoli", "Брокколи", 130, "г", "Овощи и фрукты"),
      i("soy", "Соевый соус", 18, "мл", "Бакалея"),
    ],
    commonSteps,
    3,
    true,
  ),
  r(
    "cod-potato",
    "dinner",
    "Треска с молодым картофелем",
    "🐟",
    26,
    { kcal: 455, protein: 47, fat: 13, carbs: 38 },
    410,
    255,
    ["protein", "paleo"],
    [
      i("cod", "Филе трески", 210, "г", "Мясо и рыба"),
      i("potato", "Картофель", 185, "г", "Овощи и фрукты"),
      i("greens", "Зелень", 25, "г", "Овощи и фрукты"),
    ],
    commonSteps,
    2,
    true,
  ),
  r(
    "turkey-meatballs",
    "dinner",
    "Тефтели из индейки в томатах",
    "🍅",
    35,
    { kcal: 480, protein: 49, fat: 17, carbs: 32 },
    430,
    205,
    ["protein", "budget", "paleo"],
    [
      i("turkey", "Филе индейки", 200, "г", "Мясо и рыба"),
      i("tomato-passata", "Томатная пассата", 130, "мл", "Бакалея"),
      i("zucchini", "Кабачок", 150, "г", "Овощи и фрукты"),
    ],
    commonSteps,
    4,
    true,
  ),
  r(
    "tofu-curry",
    "dinner",
    "Тофу карри с цветной капустой",
    "🥦",
    25,
    { kcal: 440, protein: 28, fat: 29, carbs: 18 },
    390,
    175,
    ["budget", "keto"],
    [
      i("tofu", "Тофу", 220, "г", "Бакалея"),
      i("cauliflower", "Цветная капуста", 190, "г", "Овощи и фрукты"),
      i("coconut-milk", "Кокосовое молоко", 80, "мл", "Бакалея"),
    ],
    commonSteps,
    4,
    true,
  ),
  r(
    "yogurt-berries",
    "snack1",
    "Йогурт с ягодами и семенами",
    "🥣",
    5,
    { kcal: 230, protein: 24, fat: 7, carbs: 18 },
    250,
    115,
    ["protein", "budget"],
    [
      i("yogurt", "Греческий йогурт", 200, "г", "Молочное"),
      i("berries", "Ягоды", 70, "г", "Овощи и фрукты"),
      i("seeds", "Семечки", 12, "г", "Бакалея"),
    ],
    commonSteps,
    3,
    false,
  ),
  r(
    "cottage-cucumber",
    "snack1",
    "Творог с огурцом и зеленью",
    "🥒",
    6,
    { kcal: 215, protein: 29, fat: 8, carbs: 7 },
    240,
    105,
    ["protein", "budget", "keto"],
    [
      i("cottage", "Творог 5%", 180, "г", "Молочное"),
      i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"),
      i("greens", "Зелень", 15, "г", "Овощи и фрукты"),
    ],
    commonSteps,
    3,
    false,
  ),
  r(
    "egg-hummus",
    "snack1",
    "Яйца с хумусом и овощами",
    "🥚",
    10,
    { kcal: 260, protein: 17, fat: 16, carbs: 12 },
    230,
    125,
    ["budget"],
    [
      i("egg", "Яйца", 2, "шт.", "Молочное"),
      i("hummus", "Хумус", 45, "г", "Бакалея"),
      i("carrot", "Морковь", 1, "шт.", "Овощи и фрукты"),
    ],
    commonSteps,
    3,
    false,
  ),
  r(
    "protein-pudding",
    "snack1",
    "Шоколадный протеин-пудинг",
    "🍫",
    7,
    { kcal: 245, protein: 30, fat: 8, carbs: 13 },
    240,
    165,
    ["protein", "keto"],
    [
      i("yogurt", "Греческий йогурт", 190, "г", "Молочное"),
      i("cocoa", "Какао", 10, "г", "Бакалея"),
      i("chia", "Семена чиа", 15, "г", "Бакалея"),
    ],
    commonSteps,
    4,
    false,
  ),
  r(
    "apple-almond",
    "snack1",
    "Яблоко с миндальной пастой",
    "🍎",
    3,
    { kcal: 235, protein: 7, fat: 12, carbs: 26 },
    220,
    135,
    ["paleo", "budget"],
    [
      i("apple", "Яблоко", 1, "шт.", "Овощи и фрукты"),
      i("almond-paste", "Миндальная паста", 24, "г", "Бакалея"),
    ],
    commonSteps,
    5,
    false,
  ),
  r(
    "kefir-smoothie",
    "snack2",
    "Кефирный смузи с ягодами",
    "🥤",
    5,
    { kcal: 220, protein: 19, fat: 6, carbs: 23 },
    320,
    110,
    ["protein", "budget"],
    [
      i("kefir", "Кефир", 250, "мл", "Молочное"),
      i("berries", "Ягоды", 80, "г", "Овощи и фрукты"),
      i("cottage", "Творог 5%", 60, "г", "Молочное"),
    ],
    commonSteps,
    2,
    false,
  ),
  r(
    "tuna-crisp",
    "snack2",
    "Тунец с хрустящими овощами",
    "🐟",
    8,
    { kcal: 240, protein: 32, fat: 8, carbs: 9 },
    250,
    180,
    ["protein", "keto", "paleo"],
    [
      i("tuna", "Тунец", 130, "г", "Мясо и рыба"),
      i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"),
      i("pepper", "Болгарский перец", 0.5, "шт.", "Овощи и фрукты"),
    ],
    commonSteps,
    2,
    false,
  ),
  r(
    "mozzarella-tomato",
    "snack2",
    "Моцарелла с томатами",
    "🧀",
    5,
    { kcal: 265, protein: 21, fat: 18, carbs: 7 },
    230,
    190,
    ["keto"],
    [
      i("mozzarella", "Моцарелла", 110, "г", "Молочное"),
      i("tomato", "Томаты", 1, "шт.", "Овощи и фрукты"),
      i("greens", "Зелень", 15, "г", "Овощи и фрукты"),
    ],
    commonSteps,
    2,
    false,
  ),
  r(
    "turkey-roll",
    "snack2",
    "Роллы из индейки с творожным сыром",
    "🌯",
    8,
    { kcal: 250, protein: 31, fat: 12, carbs: 6 },
    210,
    175,
    ["protein", "keto"],
    [
      i("turkey-slices", "Ломтики индейки", 140, "г", "Мясо и рыба"),
      i("cream-cheese", "Творожный сыр", 45, "г", "Молочное"),
      i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"),
    ],
    commonSteps,
    3,
    false,
  ),
  r(
    "chia-cacao",
    "snack2",
    "Чиа-крем с какао",
    "🍮",
    6,
    { kcal: 255, protein: 14, fat: 18, carbs: 12 },
    230,
    150,
    ["keto", "paleo"],
    [
      i("chia", "Семена чиа", 30, "г", "Бакалея"),
      i("coconut-milk", "Кокосовое молоко", 160, "мл", "Бакалея"),
      i("cocoa", "Какао", 10, "г", "Бакалея"),
    ],
    commonSteps,
    4,
    false,
  ),
];

recipes.push(
  r(
    "src-cottage-bake",
    "breakfast",
    "Творожная запеканка без сахара",
    "🥧",
    55,
    { kcal: 385, protein: 43, fat: 18, carbs: 13 },
    330,
    135,
    ["protein", "budget", "keto"],
    [
      i("cottage", "Творог 5%", 250, "г", "Молочное"),
      i("egg", "Яйца", 2, "шт.", "Молочное"),
      i("milk", "Молоко 2,5%", 80, "мл", "Молочное"),
      i("butter", "Сливочное масло для формы", 2, "г", "Молочное"),
    ],
    [
      "Разотрите творог с желтками и молоком до однородности.",
      "Взбейте белки и аккуратно вмешайте в творожную массу.",
      "Выложите в форму и запекайте около 45 минут при 180 °C.",
      "Полностью остудите и разрежьте на порции.",
    ],
    3,
    true,
    {
      provenance: parsed(recipeSources.cottageBake),
      storage: {
        freezerDays: 30,
        freezeParts: "Замораживать порционными кусками без йогурта и ягод.",
      },
    },
  ),
  r(
    "src-oat-syrniki",
    "breakfast",
    "Сырники с овсяными хлопьями",
    "🥞",
    25,
    { kcal: 420, protein: 42, fat: 15, carbs: 29 },
    320,
    140,
    ["protein", "budget"],
    [
      i("cottage", "Творог 5%", 220, "г", "Молочное"),
      i("egg", "Яйца", 1, "шт.", "Молочное"),
      i("oats", "Овсяные хлопья", 30, "г", "Крупы"),
    ],
    [
      "Измельчите овсяные хлопья в муку.",
      "Смешайте творог, яйцо и овсяную муку.",
      "Сформуйте сырники и готовьте на антипригарной сковороде до готовности.",
      "Остудите на решётке перед упаковкой.",
    ],
    4,
    true,
    {
      provenance: parsed(recipeSources.syrniki),
      storage: {
        freezerDays: 30,
        freezeParts: "Замораживать без соуса, прокладывая сырники пергаментом.",
      },
    },
  ),
  r(
    "src-protein-oats",
    "breakfast",
    "Ночная овсянка с творогом и ягодами",
    "🫐",
    10,
    { kcal: 415, protein: 31, fat: 11, carbs: 49 },
    360,
    155,
    ["protein", "budget"],
    [
      i("oats", "Овсяные хлопья", 65, "г", "Крупы"),
      i("milk", "Молоко 2,5%", 140, "мл", "Молочное"),
      i("cottage", "Мягкий творог", 120, "г", "Молочное"),
      i("berries", "Замороженные ягоды", 70, "г", "Овощи и фрукты"),
    ],
    [
      "Смешайте хлопья с молоком и мягким творогом.",
      "Разложите по банкам и добавьте ягоды.",
      "Закройте и оставьте в холодильнике минимум на 6 часов.",
    ],
    2,
    false,
    {
      provenance: parsed(
        recipeSources.proteinOats,
        "Протеиновый порошок заменён на мягкий творог; кленовый сироп убран.",
      ),
      storage: { refrigerator: "В закрытой банке при ≤4 °C — до 2 суток." },
    },
  ),
  r(
    "src-chicken-buckwheat",
    "lunch",
    "Гречка с курицей и морковью",
    "🍛",
    30,
    { kcal: 480, protein: 49, fat: 12, carbs: 47 },
    420,
    135,
    ["protein", "budget"],
    [
      i("chicken", "Куриное филе", 180, "г", "Мясо и рыба"),
      i("buckwheat", "Гречка", 65, "г", "Крупы"),
      i("carrot", "Морковь", 1, "шт.", "Овощи и фрукты"),
      i("greens", "Зелень", 15, "г", "Овощи и фрукты"),
    ],
    [
      "Отварите гречку до готовности.",
      "Нарежьте курицу и морковь, тушите с небольшим количеством воды до готовности курицы.",
      "Добавьте гречку и зелень, прогрейте ещё 2–3 минуты.",
      "Быстро остудите и разложите по контейнерам.",
    ],
    4,
    true,
    {
      provenance: parsed(recipeSources.chickenBuckwheat),
      storage: { freezerDays: 60 },
    },
  ),
  r(
    "src-chicken-rice-veg",
    "lunch",
    "Курица с рисом и овощами",
    "🍚",
    45,
    { kcal: 515, protein: 46, fat: 14, carbs: 53 },
    440,
    155,
    ["protein", "budget"],
    [
      i("chicken", "Куриное филе", 180, "г", "Мясо и рыба"),
      i("rice", "Рис", 65, "г", "Крупы"),
      i("carrot", "Морковь", 0.5, "шт.", "Овощи и фрукты"),
      i("pepper", "Болгарский перец", 0.5, "шт.", "Овощи и фрукты"),
      i("peas", "Замороженный горошек", 60, "г", "Овощи и фрукты"),
    ],
    [
      "Промойте рис, курицу и овощи нарежьте небольшими кусочками.",
      "Выложите рис и овощи в форму, сверху распределите курицу и добавьте воду.",
      "Накройте и запекайте при 180 °C до готовности риса и курицы.",
      "Быстро остудите в неглубоких контейнерах.",
    ],
    4,
    true,
    {
      provenance: parsed(recipeSources.chickenRice),
      storage: { freezerDays: 60 },
    },
  ),
  r(
    "src-chicken-bean-bowl",
    "lunch",
    "Курица с рисом, фасолью и томатами",
    "🫘",
    30,
    { kcal: 560, protein: 48, fat: 13, carbs: 61 },
    450,
    185,
    ["protein", "budget"],
    [
      i("chicken", "Куриное филе", 170, "г", "Мясо и рыба"),
      i("rice", "Рис", 60, "г", "Крупы"),
      i("red-beans", "Красная фасоль", 100, "г", "Бакалея"),
      i("tomato-passata", "Протёртые томаты", 100, "мл", "Бакалея"),
      i("onion", "Лук", 0.5, "шт.", "Овощи и фрукты"),
      i("olive-oil", "Оливковое масло", 4, "г", "Бакалея"),
    ],
    [
      "Промойте рис и отварите его до готовности по инструкции на упаковке.",
      "Обжарьте лук, добавьте кубики курицы и паприку, готовьте до полной готовности.",
      "Добавьте фасоль и протёртые томаты, прогрейте 5 минут.",
      "Разложите с рисом по контейнерам и быстро охладите.",
    ],
    4,
    true,
    {
      provenance: parsed(
        recipeSources.chickenBowl,
        "Чёрная фасоль заменена на красную, сальса — на протёртые томаты, лайм и кинза убраны.",
      ),
      storage: { freezerDays: 60 },
    },
  ),
  r(
    "src-salmon-rice-veg",
    "dinner",
    "Лосось с рисом и печёными овощами",
    "🐟",
    40,
    { kcal: 555, protein: 41, fat: 23, carbs: 47 },
    410,
    330,
    ["protein", "paleo"],
    [
      i("salmon", "Филе лосося", 170, "г", "Мясо и рыба"),
      i("rice", "Рис", 55, "г", "Крупы"),
      i("broccoli", "Брокколи", 150, "г", "Овощи и фрукты"),
      i("zucchini", "Кабачок", 120, "г", "Овощи и фрукты"),
      i("garlic", "Чеснок", 5, "г", "Овощи и фрукты"),
      i("olive-oil", "Оливковое масло", 5, "г", "Бакалея"),
    ],
    [
      "Промойте рис и отварите его до готовности по инструкции на упаковке.",
      "Нарежьте овощи, посыпьте паприкой и сухими травами.",
      "Выложите лосось на овощи и запекайте до готовности рыбы.",
      "Остудите и разложите с рисом по трём контейнерам.",
    ],
    3,
    true,
    {
      provenance: parsed(
        recipeSources.salmonPrep,
        "Кускус заменён на рис, каджунская смесь — на паприку и сухие травы.",
      ),
      storage: {
        freezerDays: 30,
        freezeParts:
          "Замораживать рыбу с рисом; свежую зелень добавить после разогрева.",
      },
    },
  ),
  r(
    "src-turkey-meatballs",
    "dinner",
    "Тефтели из индейки с гречкой",
    "🍅",
    45,
    { kcal: 525, protein: 45, fat: 17, carbs: 48 },
    440,
    195,
    ["protein", "budget"],
    [
      i("turkey-mince", "Фарш индейки", 190, "г", "Мясо и рыба"),
      i("buckwheat", "Гречка", 60, "г", "Крупы"),
      i("onion", "Лук", 0.5, "шт.", "Овощи и фрукты"),
      i("carrot", "Морковь", 0.5, "шт.", "Овощи и фрукты"),
      i("tomato-passata", "Протёртые томаты", 100, "мл", "Бакалея"),
      i("egg", "Яйцо", 0.5, "шт.", "Молочное"),
      i("olive-oil", "Оливковое масло", 5, "г", "Бакалея"),
    ],
    [
      "Промойте гречку и отварите её до готовности по инструкции на упаковке.",
      "Смешайте фарш с мелко нарезанным луком и яйцом, сформуйте тефтели.",
      "Припустите морковь в отмеренном масле, добавьте протёртые томаты и тефтели, тушите до полной готовности мяса.",
      "Остудите и разложите с гречкой по контейнерам.",
    ],
    4,
    true,
    {
      provenance: parsed(
        recipeSources.turkeyMeatballs,
        "Рис внутри тефтелей убран; гречка подаётся отдельно, чтобы проще масштабировать порции. Яйцо сохранено как связующий аллергенный компонент, масло нормировано до фактически используемого количества.",
      ),
      storage: { freezerDays: 60 },
    },
  ),
  r(
    "src-one-pot-chicken",
    "dinner",
    "Курица с бурым рисом в одной кастрюле",
    "🥘",
    50,
    { kcal: 535, protein: 43, fat: 18, carbs: 52 },
    450,
    175,
    ["protein", "budget"],
    [
      i("chicken-thigh", "Филе куриного бедра", 180, "г", "Мясо и рыба"),
      i("brown-rice", "Бурый рис", 65, "г", "Крупы"),
      i("mixed-veg", "Замороженная овощная смесь", 160, "г", "Овощи и фрукты"),
      i("onion", "Лук", 0.5, "шт.", "Овощи и фрукты"),
    ],
    [
      "Обжарьте курицу с паприкой в глубокой кастрюле.",
      "Добавьте промытый рис, лук, сухие травы и горячую воду.",
      "Томите под крышкой до готовности риса и курицы, в конце добавьте овощи.",
      "Быстро остудите в неглубоких контейнерах.",
    ],
    4,
    true,
    {
      provenance: parsed(
        recipeSources.onePotChicken,
        "Лук-порей заменён на обычный репчатый лук.",
      ),
      storage: { freezerDays: 60 },
    },
  ),
  r(
    "src-berry-smoothie",
    "snack1",
    "Ягодный смузи с кефиром и творогом",
    "🥤",
    5,
    { kcal: 255, protein: 24, fat: 6, carbs: 28 },
    330,
    120,
    ["protein", "budget"],
    [
      i("kefir", "Кефир", 220, "мл", "Молочное"),
      i("berries", "Ягоды", 100, "г", "Овощи и фрукты"),
      i("cottage", "Мягкий творог", 80, "г", "Молочное"),
      i("oats", "Овсяные хлопья", 15, "г", "Крупы"),
    ],
    [
      "Положите все ингредиенты в блендер.",
      "Взбейте до однородности и перелейте в плотно закрывающуюся бутылку.",
      "Храните в холодильнике и взболтайте перед едой.",
    ],
    1,
    false,
    {
      provenance: parsed(
        recipeSources.berrySmoothie,
        "Растительное молоко и протеин заменены на кефир и мягкий творог; банан убран.",
      ),
      storage: {
        refrigerator: "В плотно закрытой бутылке при ≤4 °C — до 1 суток.",
      },
    },
  ),
  r(
    "src-frozen-yogurt",
    "snack2",
    "Замороженный йогурт с ягодами",
    "🍧",
    5,
    { kcal: 205, protein: 20, fat: 5, carbs: 19 },
    240,
    125,
    ["protein", "budget"],
    [
      i("yogurt", "Греческий йогурт", 200, "г", "Молочное"),
      i("berries", "Замороженные ягоды", 100, "г", "Овощи и фрукты"),
    ],
    [
      "Измельчите замороженные ягоды с йогуртом до густой однородной массы.",
      "Разложите по небольшим контейнерам и сразу уберите в морозилку.",
      "Перед едой дайте постоять 5–10 минут при комнатной температуре.",
    ],
    1,
    true,
    {
      provenance: parsed(
        recipeSources.frozenYogurt,
        "Мёд убран; берутся обычные замороженные ягоды.",
      ),
      storage: {
        refrigerator:
          "Не хранить как заготовку в холодильнике: после измельчения сразу заморозить или съесть.",
        freezer: "В плотно закрытом порционном контейнере при −18 °C.",
        thaw: "Не размораживать полностью: дать слегка размягчиться 5–10 минут.",
        freezerDays: 30,
      },
    },
  ),
  r(
    "src-taco-mac",
    "lunch",
    "Макароны с говядиной, томатами и сыром",
    "🍝",
    35,
    { kcal: 674, protein: 54, fat: 24, carbs: 61 },
    470,
    245,
    ["protein", "budget"],
    [
      i("beef-mince", "Постный говяжий фарш", 182, "г", "Мясо и рыба"),
      i("pasta", "Макароны из твёрдых сортов", 57, "г", "Крупы"),
      i("pepper", "Болгарский перец", 0.4, "шт.", "Овощи и фрукты"),
      i("tomato-passata", "Протёртые томаты", 84, "мл", "Бакалея"),
      i("milk", "Молоко 2,5%", 48, "мл", "Молочное"),
      i("cheese", "Полутвёрдый сыр", 17, "г", "Молочное"),
      i("broth", "Бульон", 96, "мл", "Бакалея"),
      i("olive-oil", "Оливковое масло", 3, "г", "Бакалея"),
    ],
    [
      "Нарежьте перец, обжарьте фарш в глубокой кастрюле и разомните его лопаткой.",
      "Добавьте перец, паприку и немного зиры; готовьте до мягкости овощей.",
      "Влейте протёртые томаты и бульон, всыпьте сухие макароны и готовьте под крышкой до мягкости.",
      "Снимите с огня, вмешайте молоко, разложите по контейнерам и посыпьте сыром.",
    ],
    4,
    true,
    {
      provenance: parsed(
        recipeSources.tacoMac,
        "Количество чили уменьшено; американский shredded cheese заменён обычным полутвёрдым сыром. Это горячее блюдо, а не салат из макарон.",
      ),
      localization: {
        fit: "adapted",
        availability: "common",
        note: "По формату близко к привычным макаронам с фаршем и томатной подливой.",
      },
      storage: {
        freezerDays: 45,
        freezeParts:
          "Замораживать готовое блюдо порционно; свежую зелень добавлять после разогрева.",
      },
      effort: {
        knifeActions: 2,
        cookware: 1,
        activeActions: 7,
        activeMinutes: 10,
        level: "low",
      },
    },
  ),
  r(
    "src-teriyaki-tray",
    "dinner",
    "Курица терияки с рисом, бататом и брокколи",
    "🍗",
    60,
    { kcal: 550, protein: 44, fat: 14, carbs: 62 },
    460,
    220,
    ["protein"],
    [
      i("chicken-thigh", "Филе куриного бедра", 182, "г", "Мясо и рыба"),
      i("rice", "Рис", 60, "г", "Крупы"),
      i("sweet-potato", "Батат", 60, "г", "Овощи и фрукты"),
      i("broccoli", "Брокколи", 90, "г", "Овощи и фрукты"),
      i("soy", "Соевый соус", 15, "мл", "Бакалея"),
      i("olive-oil", "Растительное масло", 6, "г", "Бакалея"),
      i("brown-sugar", "Коричневый сахар", 5, "г", "Бакалея"),
      i("vinegar", "Рисовый или белый уксус", 3, "мл", "Бакалея"),
      i("garlic", "Чеснок", 2, "г", "Овощи и фрукты"),
    ],
    [
      "Поставьте вариться рис.",
      "Нарежьте батат и брокколи; запекайте батат 10 минут, затем добавьте брокколи.",
      "Запеките куриные бёдра до полной готовности и нарежьте ломтиками.",
      "Смешайте соевый соус, воду, рисовый уксус, немного сахара и чеснок; уварите до лёгкого загустения.",
      "Покройте курицу соусом и разложите всё по контейнерам.",
    ],
    4,
    true,
    {
      provenance: parsed(
        recipeSources.teriyakiTray,
        "Мирин заменён доступной смесью рисового уксуса, воды и небольшого количества сахара.",
      ),
      localization: {
        fit: "adapted",
        availability: "specialty",
        note: "Батат оставлен, но его можно заменить картофелем; соус собран из доступных продуктов.",
      },
      storage: {
        freezerDays: 45,
        freezeParts:
          "Замораживать курицу, рис и овощи; лишний соус лучше хранить отдельно.",
      },
      effort: {
        knifeActions: 3,
        cookware: 3,
        activeActions: 11,
        activeMinutes: 20,
        level: "high",
      },
    },
  ),
  r(
    "src-halal-chicken",
    "lunch",
    "Пряная курица с золотым рисом и овощами",
    "🥙",
    75,
    { kcal: 705, protein: 52, fat: 29, carbs: 61 },
    520,
    235,
    ["protein"],
    [
      i("chicken-thigh", "Филе куриного бедра", 220, "г", "Мясо и рыба"),
      i("rice", "Рис басмати", 60, "г", "Крупы"),
      i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"),
      i("tomato", "Томаты", 1, "шт.", "Овощи и фрукты"),
      i("yogurt", "Греческий йогурт", 30, "г", "Молочное"),
      i("mayonnaise", "Майонез", 15, "г", "Бакалея"),
      i("butter", "Сливочное масло", 5, "г", "Молочное"),
      i("olive-oil", "Оливковое масло", 9, "г", "Бакалея"),
      i("lemon", "Лимонный сок", 6, "мл", "Овощи и фрукты"),
      i("onion", "Красный лук", 17, "г", "Овощи и фрукты"),
      i("vinegar", "Белый уксус", 5, "мл", "Бакалея"),
    ],
    [
      "Приготовьте рис с куркумой, зирой и небольшим количеством масла.",
      "Замаринуйте куриные бёдра в лимонном соке, паприке и специях, затем запеките до полной готовности.",
      "Нарежьте огурец и томаты; держите овощи отдельно от горячих компонентов.",
      "Смешайте йогурт, майонез, лимонный сок и чеснок для белого соуса.",
      "Храните рис, курицу, овощи и соус отдельными блоками и собирайте контейнер перед едой.",
    ],
    3,
    true,
    {
      provenance: parsed(
        recipeSources.halalChicken,
        "Buffet prep сохранён: компоненты хранятся отдельно. Вакуумные контейнеры не обязательны.",
      ),
      localization: {
        fit: "adapted",
        availability: "common",
        note: "По вкусу близко к пряной курице с рисом и свежим салатом; специфических продуктов нет.",
      },
      storage: {
        refrigerator:
          "Курицу и рис хранить при ≤4 °C до 3 суток; нарезанные овощи и соус — отдельно.",
        freezerDays: 45,
        freezeParts:
          "Замораживать только курицу и рис. Свежие овощи и белый соус не замораживать.",
      },
      effort: {
        knifeActions: 4,
        cookware: 3,
        activeActions: 13,
        activeMinutes: 30,
        level: "high",
      },
    },
  ),
);

recipes.push(
  r(
    "src-sheet-pan-pancakes",
    "breakfast",
    "Белковый овсяный блин на противне",
    "🥞",
    35,
    { kcal: 414, protein: 31.5, fat: 6, carbs: 58.8 },
    330,
    145,
    ["protein", "budget"],
    [
      i("oats", "Овсяная мука", 60, "г", "Крупы"),
      i("milk", "Молоко 2,5%", 60, "мл", "Молочное"),
      i("egg", "Яичный белок", 68, "г", "Молочное"),
      i("cottage", "Творог 5%", 75, "г", "Молочное"),
      i("apple-puree", "Яблочное пюре без сахара", 15, "г", "Бакалея"),
    ],
    [
      "Пробейте молоко, творог и яблочное пюре блендером до гладкости.",
      "Взбейте белок венчиком до пены, затем аккуратно соедините с творожной смесью.",
      "Вмешайте овсяную муку, разрыхлитель и щепотку соли.",
      "Распределите тесто тонким ровным слоем по противню с пергаментом и выпекайте около 20 минут при 190 °C.",
      "Полностью остудите, разрежьте на 12 квадратов и кладите по 3 штуки в порцию.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Sheet Pan Protein Pancakes",
        "sheet-pan-protein-pancakes",
        "https://mealprepmanual.com/wp-content/uploads/2024/11/Sheet-Pan-Protein-Pancakes-Berry.jpg",
        "Квадраты овсяного белкового блина с ягодами",
        "Сухое обезжиренное молоко убрано; одна порция Mise — 3 квадрата, а не 1 маленький кусок.",
      ),
      storage: {
        freezerDays: 45,
        freezeParts:
          "Замораживать квадраты сначала отдельно, затем складывать порциями по три.",
      },
      effort: {
        knifeActions: 1,
        cookware: 3,
        activeActions: 9,
        activeMinutes: 15,
        level: "high",
      },
    },
  ),

  r(
    "src-pumpkin-oat-bake",
    "breakfast",
    "Тыквенная овсяная запеканка",
    "🎃",
    45,
    { kcal: 440, protein: 24, fat: 13, carbs: 57 },
    390,
    175,
    ["protein", "budget"],
    [
      i("oats", "Овсяные хлопья", 40, "г", "Крупы"),
      i("protein-powder", "Ванильный протеин", 10, "г", "Бакалея"),
      i("pumpkin", "Тыквенное пюре", 71, "г", "Овощи и фрукты"),
      i("egg", "Яйцо", 0.5, "шт.", "Молочное"),
      i("milk", "Молоко 2,5%", 40, "мл", "Молочное"),
      i("cottage", "Творог 5%", 38, "г", "Молочное"),
      i("cream-cheese", "Творожный сыр", 17, "г", "Молочное"),
      i("yogurt", "Греческий йогурт", 17, "г", "Молочное"),
    ],
    [
      "Пробейте тыквенное пюре, молоко, творог, яйца, протеин, корицу и немного подсластителя до однородности.",
      "Всыпьте хлопья в форму, залейте тыквенной смесью и тщательно перемешайте.",
      "Запекайте при 180 °C до плотной середины, затем дайте запеканке остыть.",
      "Смешайте творожный сыр с йогуртом; храните крем отдельно.",
      "Разрежьте запеканку на 6 порций и добавляйте крем после разогрева.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Pumpkin Pie Baked Oatmeal",
        "pumpkin-pie-baked-oatmeal",
        "https://mealprepmanual.com/wp-content/uploads/2024/10/Pumpkin-Pie-Baked-Oatmeal.jpg",
        "Тыквенная овсяная запеканка с кремом",
        "Pumpkin pie spice заменена корицей, имбирём и мускатным орехом; кленовый сироп не обязателен.",
      ),
      storage: {
        freezerDays: 45,
        freezeParts: "Замораживать куски без йогуртового крема.",
      },
      effort: {
        knifeActions: 1,
        cookware: 3,
        activeActions: 10,
        activeMinutes: 15,
        level: "high",
      },
    },
  ),

  r(
    "src-waffle-french-toast",
    "breakfast",
    "Белковая вафля-френч-тост с ягодами",
    "🧇",
    25,
    { kcal: 435, protein: 46, fat: 3, carbs: 56 },
    360,
    210,
    ["protein"],
    [
      i("oats", "Овсяная мука", 40, "г", "Крупы"),
      i("protein-powder", "Сывороточный протеин", 16, "г", "Бакалея"),
      i("egg", "Яичный белок", 135, "г", "Молочное"),
      i("yogurt", "Греческий йогурт", 75, "г", "Молочное"),
      i("milk", "Молоко 2,5%", 15, "мл", "Молочное"),
      i("berries", "Клубника или другие ягоды", 100, "г", "Овощи и фрукты"),
    ],
    [
      "Смешайте овсяную муку, протеин, половину белка, йогурт и немного воды в густое тесто.",
      "Испеките одну большую вафлю до плотной золотистой корочки.",
      "Оставшийся белок смешайте с молоком, ванилью и корицей.",
      "Разрежьте вафлю, быстро окуните кусочки в яичную смесь и подрумяньте на сковороде с двух сторон.",
      "Ягоды разогрейте до появления сока и подавайте отдельно, чтобы вафля не размокла.",
    ],
    2,
    true,
    {
      provenance: mealPrepManualParsed(
        "Cinnamon Protein Waffle French Toast",
        "cinnamon-protein-waffle-french-toast",
        "https://mealprepmanual.com/wp-content/uploads/2024/03/Cinnamon-Protein-Waffle-French-Toast.jpg",
        "Белковая вафля с ягодами",
        "Фирменная смесь для панкейков заменена овсяной мукой и доступным сывороточным протеином.",
      ),
      localization: {
        fit: "adapted",
        availability: "common",
        note: "Формат десертного завтрака понятен, но нужна вафельница.",
      },
      storage: {
        freezerDays: 30,
        freezeParts:
          "Замораживать только готовые вафли; ягоды хранить отдельно.",
      },
      effort: {
        knifeActions: 1,
        cookware: 4,
        activeActions: 11,
        activeMinutes: 15,
        level: "high",
      },
    },
  ),

  r(
    "src-banana-oat-bake",
    "breakfast",
    "Банановая овсяная запеканка для набора",
    "🍌",
    70,
    { kcal: 490, protein: 21, fat: 22, carbs: 52 },
    360,
    170,
    ["protein", "budget"],
    [
      i("oats", "Овсяные хлопья", 40, "г", "Крупы"),
      i("protein-powder", "Ванильный протеин", 12, "г", "Бакалея"),
      i("banana", "Спелый банан", 40, "г", "Овощи и фрукты"),
      i("egg", "Яйцо", 0.4, "шт.", "Молочное"),
      i("milk", "Молоко 3,2%", 84, "мл", "Молочное"),
      i("butter", "Сливочное масло", 6, "г", "Молочное"),
      i("walnut", "Грецкий орех", 11, "г", "Бакалея"),
      i("peanut-butter", "Арахисовая паста", 5, "г", "Бакалея"),
    ],
    [
      "Смешайте хлопья, протеин, разрыхлитель и щепотку соли.",
      "Разомните банан, добавьте яйца, молоко и растопленное масло.",
      "Соедините обе смеси, вмешайте рубленые орехи и переложите в форму.",
      "Запекайте 55–60 минут при 180 °C, затем полностью остудите.",
      "Разрежьте на 10 умеренных порций; арахисовую пасту добавляйте при подаче.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Big Boy Baked Oatmeal",
        "big-boy-baked-oatmeal",
        "https://mealprepmanual.com/wp-content/uploads/2023/10/Big-Boy-Baked-Oatmeal.jpg",
        "Банановая овсяная запеканка с орехами",
        "Исходная порция на 980 ккал разделена пополам: Mise показывает более практичную порцию около 490 ккал.",
      ),
      localization: {
        fit: "familiar",
        availability: "common",
        note: "Высококалорийный вариант для набора; жиры удобно регулировать орехами и пастой.",
      },
      storage: {
        freezerDays: 45,
        freezeParts: "Замораживать порционные куски без арахисовой пасты.",
      },
      effort: {
        knifeActions: 2,
        cookware: 3,
        activeActions: 10,
        activeMinutes: 12,
        level: "high",
      },
    },
  ),

  r(
    "src-breakfast-rolls",
    "breakfast",
    "Завтрачные роллы со свининой, яйцом и картофелем",
    "🌯",
    90,
    { kcal: 447, protein: 26.7, fat: 15.3, carbs: 47.7 },
    360,
    190,
    ["protein", "budget"],
    [
      i("pork-mince", "Постный свиной фарш", 68, "г", "Мясо и рыба"),
      i("potato", "Картофель", 45, "г", "Овощи и фрукты"),
      i("cottage", "Творог 5%", 23, "г", "Молочное"),
      i("cheese", "Полутвёрдый сыр", 9, "г", "Молочное"),
      i("egg", "Яйцо", 0.5, "шт.", "Молочное"),
      i("pepper", "Болгарский перец", 8, "г", "Овощи и фрукты"),
      i("tortilla", "Маленькая пшеничная тортилья", 3, "шт.", "Хлеб"),
    ],
    [
      "Отварите картофель до мягкости, очистите и разомните вилкой, оставляя небольшие кусочки.",
      "Смешайте фарш с паприкой, чесноком и сухими травами, расплющите на противне и запеките до полной готовности.",
      "Мелко нарежьте перец и приготовьте с ним мягкую яичницу-болтунью.",
      "Соедините картофель, творог, сыр и яйца; мясо нарежьте полосками.",
      "Прогрейте тортильи, распределите начинку, добавьте мясо и плотно сверните.",
      "Сначала заморозьте роллы отдельно, затем сложите по 3 штуки в пакеты или контейнеры.",
    ],
    3,
    true,
    {
      provenance: mealPrepManualParsed(
        "Cheesy Potato and Sausage Breakfast Taquitos",
        "cheesy-potato-and-sausage-breakfast-taquitos",
        "https://mealprepmanual.com/wp-content/uploads/2025/02/Untitled-design-8.png",
        "Завтрачные роллы с мясом, картофелем и яйцом",
        "Corn tortillas заменены маленькими пшеничными тортильями; одна порция Mise — 3 ролла.",
      ),
      localization: {
        fit: "adapted",
        availability: "common",
        note: "По сути это замораживаемые рулетики из лаваша с привычной начинкой.",
      },
      storage: {
        freezerDays: 60,
        freezeParts:
          "Замораживать готовые роллы по отдельности; затем объединять в порции.",
      },
      effort: {
        knifeActions: 4,
        cookware: 5,
        activeActions: 16,
        activeMinutes: 60,
        level: "high",
      },
    },
  ),

  r(
    "src-chicken-nuggets",
    "snack1",
    "Куриные наггетсы с бататом без панировки",
    "🍗",
    60,
    { kcal: 178, protein: 20.4, fat: 4.8, carbs: 13.8 },
    180,
    115,
    ["protein", "budget"],
    [
      i("chicken-mince", "Куриный фарш", 91, "г", "Мясо и рыба"),
      i("sweet-potato", "Батат", 48, "г", "Овощи и фрукты"),
      i("egg", "Яйцо", 0.2, "шт.", "Молочное"),
      i("oats", "Овсяная мука", 4, "г", "Крупы"),
      i("green-onion", "Зелёный лук", 3, "г", "Овощи и фрукты"),
    ],
    [
      "Очистите батат и измельчите его в комбайне до мелкой крошки, похожей на рис.",
      "Смешайте батат с фаршем, яйцом, овсяной мукой, зелёным луком и сухими специями.",
      "Влажными руками сформуйте небольшие плоские наггетсы и выложите на пергамент.",
      "Запекайте при 200 °C около 8 минут, переверните и доведите до полной готовности ещё 4–6 минут.",
      "Остудите на решётке и разложите по 6 штук на перекус.",
    ],
    3,
    true,
    {
      provenance: mealPrepManualParsed(
        "Chicken Nuggets for Snack City",
        "chicken-nuggets-for-snack-city",
        "https://mealprepmanual.com/wp-content/uploads/2025/03/Untitled-design-9.png",
        "Запечённые куриные наггетсы без панировки",
        "КБЖУ исходника указаны на один наггетс; Mise пересчитал карточку на порцию из 6 штук.",
      ),
      localization: {
        fit: "familiar",
        availability: "common",
        note: "Батат оставлен; при необходимости его можно заменить тыквой, но КБЖУ потребуется пересчитать.",
      },
      storage: {
        freezerDays: 60,
        freezeParts:
          "Сначала заморозить наггетсы одним слоем, затем сложить по 6 штук.",
      },
      effort: {
        knifeActions: 2,
        cookware: 3,
        activeActions: 11,
        activeMinutes: 30,
        level: "high",
      },
    },
  ),

  r(
    "src-cinnamon-granola",
    "snack2",
    "Гранола с корицей и изюмом",
    "🥜",
    27,
    { kcal: 280, protein: 7.5, fat: 8.9, carbs: 42.5 },
    70,
    95,
    ["budget"],
    [
      i("oats", "Овсяные хлопья", 32, "г", "Крупы"),
      i("peanut-butter", "Арахисовая паста", 13, "г", "Бакалея"),
      i("maple-syrup", "Сироп или мёд", 12, "г", "Бакалея"),
      i("raisins", "Изюм", 10, "г", "Бакалея"),
    ],
    [
      "Слегка прогрейте арахисовую пасту с мёдом или сиропом, добавьте корицу и щепотку соли.",
      "Перемешайте смесь с хлопьями так, чтобы они равномерно покрылись.",
      "Распределите тонким слоем по противню и выпекайте при 180 °C около 20 минут, один раз перемешав.",
      "Полностью остудите: гранола станет хрустящей только после остывания.",
      "Вмешайте изюм и разложите по сухим порционным банкам.",
    ],
    14,
    false,
    {
      provenance: mealPrepManualParsed(
        "Cinnamon Raisin Granola",
        "cinnamon-raisin-granola",
        "https://mealprepmanual.com/wp-content/uploads/2023/08/Cinnamon-Raisin-Granola.jpg",
        "Домашняя гранола с корицей и изюмом",
        "Парсер ошибочно отнёс гранолу к обедам; в Mise это второй перекус. Кленовый сироп можно заменить мёдом.",
      ),
      storage: {
        refrigerator:
          "После смешивания с йогуртом хранить при ≤4 °C не дольше 1 суток.",
        ambient:
          "В сухой герметичной банке при комнатной температуре — ориентировочно до 14 суток; не убирать тёплой.",
      },
      flex: { protein: [1, 1], fat: [0.7, 1.3], carbs: [0.7, 1.3] },
      effort: {
        knifeActions: 0,
        cookware: 2,
        activeActions: 5,
        activeMinutes: 7,
        level: "low",
      },
    },
  ),

  r(
    "src-crispy-beef-noodles",
    "lunch",
    "Острая лапша с хрустящим говяжьим фаршем",
    "🍜",
    35,
    { kcal: 617, protein: 47, fat: 23, carbs: 55 },
    450,
    260,
    ["protein"],
    [
      i("beef-mince", "Постный говяжий фарш", 182, "г", "Мясо и рыба"),
      i("pasta", "Яичная или рисовая лапша", 45, "г", "Крупы"),
      i("broccoli", "Брокколи", 45, "г", "Овощи и фрукты"),
      i("cabbage", "Капуста", 36, "г", "Овощи и фрукты"),
      i("carrot", "Морковь", 23, "г", "Овощи и фрукты"),
      i("soy", "Соевый соус", 9, "мл", "Бакалея"),
      i("gochujang", "Паста кочудян", 6, "г", "Бакалея"),
      i("olive-oil", "Оливковое масло", 9, "г", "Бакалея"),
      i("honey", "Мёд", 8.4, "г", "Бакалея"),
      i("oyster-sauce", "Устричный соус", 9, "г", "Бакалея"),
      i("garlic", "Чеснок", 4, "г", "Овощи и фрукты"),
      i("onion", "Зелёный лук", 20, "г", "Овощи и фрукты"),
    ],
    [
      "Приготовьте лапшу по инструкции и сохраните немного воды от варки.",
      "Нарежьте брокколи и капусту, морковь натрите длинными полосками.",
      "Хорошо подрумяньте фарш на сильном огне, разбивая его на мелкие хрустящие кусочки, затем временно переложите.",
      "Быстро обжарьте овощи, верните мясо и добавьте лапшу.",
      "Смешайте соевый и устричный соусы, кочудян, мёд и воду от лапши; влейте и прогрейте до загустения.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Crispy Chili Beef Noodles",
        "crispy-chili-beef-noodles",
        "https://mealprepmanual.com/wp-content/uploads/2026/02/Crispy-Chili-Beef-Noodles.jpg",
        "Острая лапша с говядиной и овощами",
        "Острота снижена; паста кочудян оставлена как управляемый нишевый ингредиент.",
      ),
      localization: {
        fit: "adapted",
        availability: "specialty",
        note: "Кочудян продаётся на маркетплейсах; для мягкого варианта можно взять сладкий чили и паприку.",
      },
      storage: { freezerDays: 30 },
      effort: {
        knifeActions: 4,
        cookware: 3,
        activeActions: 13,
        activeMinutes: 20,
        level: "high",
      },
    },
  ),

  r(
    "src-mediterranean-wrap",
    "lunch",
    "Ролл с пряной курицей, овощами и хумусом",
    "🌯",
    60,
    { kcal: 494, protein: 34, fat: 19, carbs: 47 },
    430,
    240,
    ["protein"],
    [
      i("chicken-thigh", "Филе куриного бедра", 151, "г", "Мясо и рыба"),
      i("tortilla", "Большая пшеничная тортилья", 1, "шт.", "Хлеб"),
      i("hummus", "Хумус", 16, "г", "Бакалея"),
      i("cucumber", "Огурец", 33, "г", "Овощи и фрукты"),
      i("tomato", "Томаты", 40, "г", "Овощи и фрукты"),
      i("lettuce", "Салат романо", 57, "г", "Овощи и фрукты"),
      i("feta", "Фета", 7, "г", "Молочное"),
      i("onion", "Красный лук", 33, "г", "Овощи и фрукты"),
      i("olive-oil", "Оливковое масло", 5, "г", "Бакалея"),
      i("lemon", "Лимонный сок", 5, "мл", "Овощи и фрукты"),
      i("vinegar", "Уксус", 5, "мл", "Бакалея"),
    ],
    [
      "Смешайте лимонный сок, масло, зиру, орегано, чеснок и паприку; замаринуйте курицу минимум на 30 минут.",
      "Запеките курицу до полной готовности и румяной поверхности, дайте отдохнуть и нарежьте полосками.",
      "Нарежьте огурец и томаты, удалив лишний сок; салат держите сухим.",
      "Храните курицу, овощи, тортильи и хумус отдельными компонентами.",
      "Перед едой смажьте тортилью хумусом, добавьте курицу, овощи и фету, затем плотно сверните.",
    ],
    3,
    true,
    {
      provenance: mealPrepManualParsed(
        "Mediterranean Chicken Wraps",
        "mediterranean-chicken-wraps",
        "https://mealprepmanual.com/wp-content/uploads/2021/04/mediterranean-chicken-wraps-3-e1617688079573.png",
        "Ролл с курицей, овощами и хумусом",
        "Компоненты не собираются заранее, чтобы тортилья и салат не размокали.",
      ),
      localization: {
        fit: "familiar",
        availability: "common",
        note: "Формат близок к привычному роллу в лаваше; все продукты доступны.",
      },
      storage: {
        refrigerator:
          "Курицу хранить при ≤4 °C до 3 суток; овощи, салат и тортильи — отдельно.",
        freezerDays: 45,
        freezeParts:
          "Замораживать только готовую курицу. Свежие овощи, хумус и тортилью не замораживать вместе.",
      },
      effort: {
        knifeActions: 4,
        cookware: 2,
        activeActions: 12,
        activeMinutes: 25,
        level: "high",
      },
    },
  ),

  r(
    "src-creamy-chicken-pasta",
    "lunch",
    "Сливочная паста с курицей и овощным соусом",
    "🍝",
    60,
    { kcal: 557, protein: 47, fat: 16, carbs: 56 },
    470,
    225,
    ["protein", "budget"],
    [
      i("chicken-thigh", "Филе куриного бедра", 136, "г", "Мясо и рыба"),
      i("pasta", "Спагетти из твёрдых сортов", 56, "г", "Крупы"),
      i(
        "cauliflower",
        "Замороженная цветная капуста",
        45,
        "г",
        "Овощи и фрукты",
      ),
      i("pumpkin", "Замороженная тыква", 45, "г", "Овощи и фрукты"),
      i("cottage", "Творог 5%", 45, "г", "Молочное"),
      i("milk", "Молоко 2,5%", 72, "мл", "Молочное"),
      i("parmesan", "Пармезан", 11, "г", "Молочное"),
      i("olive-oil", "Растительное масло", 4.5, "г", "Бакалея"),
      i("lemon", "Лимонный сок", 2, "мл", "Овощи и фрукты"),
      i("bouillon", "Сухой куриный бульон", 2, "г", "Бакалея"),
    ],
    [
      "Нарежьте курицу небольшими кусочками и распределите по дну глубокой формы.",
      "Прогрейте замороженные овощи и пробейте их с творогом, молоком, водой, чесноком и сухими травами.",
      "Выложите сухие спагетти поверх курицы слоями, каждый слой полностью покрывайте соусом.",
      "Плотно накройте форму и запекайте около 45 минут при 190 °C.",
      "Перемешайте пасту, дайте соусу загустеть 10–15 минут и посыпьте сыром.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Easy Dump and Bake Creamy Chicken Pasta",
        "easy-dump-and-bake-creamy-chicken-pasta",
        "https://mealprepmanual.com/wp-content/uploads/2025/10/One-Dish-Baked-Pasta.jpg",
        "Запечённая паста с курицей в сливочном овощном соусе",
        "Butternut squash заменён обычной замороженной тыквой; это горячая паста, не салат.",
      ),
      localization: {
        fit: "familiar",
        availability: "common",
        note: "Формат запеканки привычный, а овощи скрыты в соусе.",
      },
      storage: {
        freezerDays: 30,
        thaw: "Размораживать в холодильнике; при разогреве добавить 1–2 ложки молока.",
      },
      effort: {
        knifeActions: 1,
        cookware: 3,
        activeActions: 9,
        activeMinutes: 15,
        level: "high",
      },
    },
  ),

  r(
    "src-lemon-chicken",
    "dinner",
    "Лимонная курица с картофельным пюре и морковью",
    "🍋",
    70,
    { kcal: 642, protein: 42, fat: 31, carbs: 50 },
    520,
    235,
    ["protein"],
    [
      i("chicken-thigh", "Филе куриного бедра", 182, "г", "Мясо и рыба"),
      i("potato", "Картофель", 182, "г", "Овощи и фрукты"),
      i("carrot", "Морковь", 136, "г", "Овощи и фрукты"),
      i("butter", "Сливочное масло", 14, "г", "Молочное"),
      i("milk", "Молоко 2,5%", 24, "мл", "Молочное"),
      i("mustard", "Дижонская горчица", 5, "г", "Бакалея"),
    ],
    [
      "Отварите картофель с чесноком до мягкости, слейте воду и разомните с молоком и маслом.",
      "Смешайте лимонный сок, горчицу, орегано, базилик и чеснок; покройте маринадом полоски курицы.",
      "Обжарьте курицу небольшими партиями до румяной корочки и полной готовности.",
      "Нарежьте морковь крупными кусочками и запеките с небольшим количеством масла до мягкости.",
      "Разложите пюре, морковь и курицу по контейнерам, не закрывая их до прекращения пара.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Lemon Herb Chicken",
        "lemon-herb-chicken",
        "https://mealprepmanual.com/wp-content/uploads/2025/01/Lemon-Herb-Chicken.jpg",
        "Лимонная курица с пюре и печёной морковью",
        "Состав оставлен почти без изменений: продукты и формат блюда привычны для России.",
      ),
      storage: { freezerDays: 45 },
      effort: {
        knifeActions: 4,
        cookware: 4,
        activeActions: 13,
        activeMinutes: 30,
        level: "high",
      },
    },
  ),

  r(
    "src-curry-fried-rice",
    "lunch",
    "Жареный рис с карри и курицей",
    "🍛",
    50,
    { kcal: 491, protein: 40, fat: 20, carbs: 37 },
    430,
    210,
    ["protein", "budget"],
    [
      i("chicken-thigh", "Филе куриного бедра", 182, "г", "Мясо и рыба"),
      i("rice", "Рис, сухой вес", 35, "г", "Крупы"),
      i("onion", "Лук", 40, "г", "Овощи и фрукты"),
      i("pepper", "Болгарский перец", 30, "г", "Овощи и фрукты"),
      i("zucchini", "Кабачок", 30, "г", "Овощи и фрукты"),
      i("yogurt", "Греческий йогурт", 6, "г", "Молочное"),
    ],
    [
      "Сварите рис заранее, быстро охладите и уберите в холодильник — подсушенный рис лучше обжаривается.",
      "Смешайте йогурт, лимонный сок, карри, зиру и паприку; замаринуйте тонкие полоски курицы.",
      "Обжарьте курицу партиями до румяности и временно переложите.",
      "На той же сковороде обжарьте лук, перец и кабачок, затем добавьте чеснок и немного томатной пасты.",
      "Вмешайте холодный рис и курицу, хорошо прогрейте и сразу разложите по неглубоким контейнерам.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Curried Chicken Fried Rice",
        "curried-chicken-fried-rice",
        "https://mealprepmanual.com/wp-content/uploads/2024/11/Curried-Chicken-Fried-Rice.jpg",
        "Жареный рис с курицей карри и овощами",
        "Кинза оставлена необязательной; остальные продукты доступны.",
      ),
      localization: {
        fit: "adapted",
        availability: "common",
        note: "Карри уже привычный вкус; остроту можно полностью убрать.",
      },
      storage: { freezerDays: 45 },
      effort: {
        knifeActions: 4,
        cookware: 3,
        activeActions: 13,
        activeMinutes: 25,
        level: "high",
      },
    },
  ),

  r(
    "src-fajita-rice",
    "lunch",
    "Жареный рис с курицей и сладким перцем",
    "🫑",
    50,
    { kcal: 481, protein: 40, fat: 18, carbs: 41 },
    430,
    205,
    ["protein", "budget"],
    [
      i("chicken-thigh", "Филе куриного бедра", 182, "г", "Мясо и рыба"),
      i("rice", "Рис, сухой вес", 35, "г", "Крупы"),
      i("onion", "Лук", 40, "г", "Овощи и фрукты"),
      i("pepper", "Болгарский перец", 60, "г", "Овощи и фрукты"),
      i("lime", "Лайм или лимон", 0.2, "шт.", "Овощи и фрукты"),
    ],
    [
      "Заранее сварите рис, быстро охладите и храните в холодильнике до готовки.",
      "Нарежьте курицу тонкими полосками и смешайте с паприкой, зирой, кориандром, чесноком и соком лайма.",
      "Обжарьте курицу небольшими партиями и переложите на тарелку.",
      "Нарежьте лук и перец полосками, обжарьте их на той же сковороде до лёгкой румяности.",
      "Добавьте холодный рис, курицу и ещё немного цитрусового сока; прогрейте и разделите на порции.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Chicken Fajita Fried Rice",
        "chicken-fajita-fried-rice",
        "https://mealprepmanual.com/wp-content/uploads/2023/10/Chicken-Fajita-Fried-Rice.jpg",
        "Жареный рис с курицей и сладким перцем",
        "Poblano заменён обычным зелёным болгарским перцем; кинза необязательна.",
      ),
      localization: {
        fit: "adapted",
        availability: "common",
        note: "По формату близко к рису с курицей и овощами.",
      },
      storage: { freezerDays: 45 },
      effort: {
        knifeActions: 4,
        cookware: 3,
        activeActions: 13,
        activeMinutes: 25,
        level: "high",
      },
    },
  ),

  r(
    "src-japanese-beef-curry",
    "lunch",
    "Говяжье карри с картофелем и рисом",
    "🍛",
    60,
    { kcal: 719, protein: 46, fat: 31, carbs: 65 },
    540,
    280,
    ["protein"],
    [
      i("beef-mince", "Говяжий фарш 85/15", 182, "г", "Мясо и рыба"),
      i("rice", "Рис, сухой вес", 45, "г", "Крупы"),
      i("potato", "Картофель", 50, "г", "Овощи и фрукты"),
      i("carrot", "Морковь", 30, "г", "Овощи и фрукты"),
      i("onion", "Лук", 25, "г", "Овощи и фрукты"),
      i("peas", "Замороженный горошек", 45, "г", "Овощи и фрукты"),
      i("soy", "Соевый соус", 6, "мл", "Бакалея"),
    ],
    [
      "Поставьте вариться рис и подготовьте овощи: картофель кубиками, морковь тонкими ломтиками, лук мелко.",
      "Подрумяньте фарш в глубокой кастрюле; в вытопившемся жире обжарьте лук, чеснок и имбирь.",
      "Добавьте мягкую смесь карри и немного муки, прогрейте и постепенно влейте бульон, размешивая комки.",
      "Добавьте картофель и морковь, накройте и тушите до мягкости овощей.",
      "Вмешайте горошек и соевый соус, скорректируйте вкус и разложите с рисом.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Japanese Ground Beef Curry",
        "japanese-ground-beef-curry",
        "https://mealprepmanual.com/wp-content/uploads/2024/02/Japanese-Ground-Beef-Curry.jpg",
        "Густое говяжье карри с картофелем и рисом",
        "Количество карри и гарам масалы уменьшено; вустерский соус можно не покупать.",
      ),
      localization: {
        fit: "adapted",
        availability: "common",
        note: "По текстуре это знакомое мясное рагу; специи остаются регулируемыми.",
      },
      storage: { freezerDays: 60 },
      effort: {
        knifeActions: 4,
        cookware: 2,
        activeActions: 11,
        activeMinutes: 20,
        level: "high",
      },
    },
  ),

  r(
    "src-gochujang-beef",
    "lunch",
    "Говядина кочудян с капустой и рисом",
    "🥩",
    50,
    { kcal: 572, protein: 42, fat: 22, carbs: 52 },
    460,
    265,
    ["protein", "budget"],
    [
      i("beef-mince", "Постный говяжий фарш", 182, "г", "Мясо и рыба"),
      i("rice", "Рис, сухой вес", 40, "г", "Крупы"),
      i("cabbage", "Белокочанная капуста", 45, "г", "Овощи и фрукты"),
      i("carrot", "Морковь", 30, "г", "Овощи и фрукты"),
      i("pepper", "Болгарский перец", 30, "г", "Овощи и фрукты"),
      i("gochujang", "Паста кочудян", 9, "г", "Бакалея"),
      i("soy", "Соевый соус", 6, "мл", "Бакалея"),
    ],
    [
      "Сварите рис и нарежьте перец, лук, капусту и морковь тонкой соломкой.",
      "Подрумяньте фарш на широкой сковороде и временно переложите.",
      "Быстро обжарьте овощи, сохраняя лёгкий хруст, затем верните мясо.",
      "Смешайте кочудян, соевый соус, воду, немного мёда, чеснок и имбирь.",
      "Влейте соус, прогрейте до блеска и разделите между контейнерами с рисом.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Gochujang Glazed Beef & Vegetables",
        "gochujang-glazed-beef-vegetables",
        "https://mealprepmanual.com/wp-content/uploads/2024/01/High-Volume-Korean-Beef-Bowls.jpg",
        "Говядина кочудян с капустой, морковью и рисом",
        "Кочудян оставлен, но его количество ограничено; капуста обычная белокочанная.",
      ),
      localization: {
        fit: "adapted",
        availability: "specialty",
        note: "Специально оставленный нишевый соус; остальные продукты максимально обычные.",
      },
      storage: { freezerDays: 45 },
      effort: {
        knifeActions: 4,
        cookware: 3,
        activeActions: 12,
        activeMinutes: 20,
        level: "high",
      },
    },
  ),

  r(
    "src-peanut-turkey",
    "dinner",
    "Индейка с овощами в арахисовом соусе",
    "🥜",
    30,
    { kcal: 632, protein: 42, fat: 26, carbs: 57 },
    480,
    235,
    ["protein", "budget"],
    [
      i("turkey-mince", "Фарш индейки", 182, "г", "Мясо и рыба"),
      i("rice", "Рис, сухой вес", 40, "г", "Крупы"),
      i("mixed-veg", "Замороженная овощная смесь", 136, "г", "Овощи и фрукты"),
      i("peanut-butter", "Арахисовая паста", 11, "г", "Бакалея"),
      i("soy", "Соевый соус", 9, "мл", "Бакалея"),
      i("honey", "Мёд", 17, "г", "Бакалея"),
    ],
    [
      "Сварите рис; замороженные овощи прогрейте отдельно и слейте лишнюю воду.",
      "Подрумяньте фарш индейки на широкой сковороде до почти полной готовности.",
      "Смешайте тёплую арахисовую пасту, мёд, соевый соус, рисовый уксус и немного воды.",
      "Добавьте овощи к индейке, затем влейте соус и готовьте 1–2 минуты до загустения.",
      "Разложите рис и индейку по контейнерам; соус при разогреве можно разбавить ложкой воды.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Peanut Turkey Stir Fry",
        "peanut-turkey-stir-fry",
        "https://mealprepmanual.com/wp-content/uploads/2024/04/Peanut-Turkey-Stir-Fry.jpg",
        "Индейка с замороженными овощами и арахисовым соусом",
        "Chinese cooking wine заменено рисовым или обычным мягким уксусом; острота снижена.",
      ),
      localization: {
        fit: "familiar",
        availability: "common",
        note: "Низкая сложность за счёт замороженных овощей и одной сковороды.",
      },
      storage: { freezerDays: 45 },
      effort: {
        knifeActions: 0,
        cookware: 2,
        activeActions: 6,
        activeMinutes: 10,
        level: "low",
      },
    },
  ),

  r(
    "src-hot-honey-pork",
    "dinner",
    "Свинина с рисом, фасолью и острым мёдом",
    "🍯",
    35,
    { kcal: 616, protein: 43, fat: 25, carbs: 55 },
    470,
    220,
    ["protein", "budget"],
    [
      i("pork-mince", "Постный свиной фарш", 182, "г", "Мясо и рыба"),
      i("rice", "Рис, сухой вес", 40, "г", "Крупы"),
      i("green-beans", "Стручковая фасоль", 68, "г", "Овощи и фрукты"),
      i("pepper", "Болгарский перец", 30, "г", "Овощи и фрукты"),
      i("honey", "Мёд", 17, "г", "Бакалея"),
      i("soy", "Соевый соус", 9, "мл", "Бакалея"),
      i("chili-oil", "Масло чили", 6, "мл", "Бакалея"),
    ],
    [
      "Сварите рис, а перец и стручковую фасоль нарежьте небольшими кусочками.",
      "Подрумяньте фарш на сильном огне и уберите лишний вытопившийся жир.",
      "Добавьте овощи и готовьте до мягкости с лёгким хрустом.",
      "Смешайте мёд, соевый соус, уксус и масло чили; начните с половины острого компонента.",
      "Влейте соус к мясу, прогрейте до глазировки и разложите с рисом по контейнерам.",
    ],
    4,
    true,
    {
      provenance: mealPrepManualParsed(
        "Hot Honey Pork Stir Fry",
        "hot-honey-pork-stir-fry",
        "https://mealprepmanual.com/wp-content/uploads/2023/09/Hot-Honey-Pork-Stir-Fry.jpg",
        "Свинина с овощами в медово-остром соусе",
        "Crunchy chili garlic oil заменено обычным маслом чили; остроту можно свести к нулю.",
      ),
      localization: {
        fit: "adapted",
        availability: "common",
        note: "Основа блюда привычная: фарш, рис и овощи; необычен только сладко-острый соус.",
      },
      storage: { freezerDays: 45 },
      effort: {
        knifeActions: 2,
        cookware: 3,
        activeActions: 10,
        activeMinutes: 15,
        level: "high",
      },
    },
  ),
);

recipes.push(
  r("src-sausage-pepper-pasta", "lunch", "Паста со свиным фаршем, перцем и шпинатом", "🍝", 50, { kcal: 681, protein: 51, fat: 29, carbs: 55 }, 520, 230, ["protein", "budget"], [
    i("pork-mince", "Постный свиной фарш", 182, "г", "Мясо и рыба"), i("pasta", "Короткая паста, сухой вес", 56, "г", "Крупы"), i("onion", "Репчатый лук", 40, "г", "Овощи и фрукты"), i("pepper", "Болгарский перец", 30, "г", "Овощи и фрукты"), i("spinach", "Шпинат", 20, "г", "Овощи и фрукты"), i("tomato-passata", "Протёртые томаты", 84, "мл", "Бакалея"), i("tomato-paste", "Томатная паста", 9, "г", "Бакалея"), i("cream", "Сливки 10%", 12, "мл", "Молочное"), i("parmesan", "Твёрдый сыр", 8, "г", "Молочное"), i("olive-oil", "Растительное масло", 6, "г", "Бакалея"), i("garlic", "Чеснок", 3, "г", "Овощи и фрукты"),
  ], [
    "Подрумяньте фарш в широкой кастрюле, разминая его на небольшие кусочки; добавьте паприку, орегано и растёртые семена фенхеля.",
    "Освободите середину кастрюли, добавьте мелко нарезанные лук и перец и готовьте до лёгкой румяности.",
    "Вмешайте томатную пасту и протёртые томаты, затем добавьте сухую пасту и столько горячей воды, чтобы она почти покрывала макароны.",
    "Готовьте под крышкой до состояния аль денте, периодически перемешивая и при необходимости подливая воду.",
    "Снимите с огня, вмешайте шпинат, сливки и сыр; дайте пару выйти и разложите по неглубоким контейнерам.",
  ], 4, true, { provenance: mealPrepManualParsed("One Pot Sausage and Pepper Pasta", "one-pot-sausage-and-pepper-pasta", "https://mealprepmanual.com/wp-content/uploads/2025/09/One-Pot-Sausage-and-Pepper-Pasta.jpg", "Горячая паста со свиным фаршем, перцем и шпинатом", "Italian sausage заменена постным свиным фаршем с фенхелем и паприкой; half-and-half — обычными сливками 10%."), localization: { fit: "familiar", availability: "common", note: "Это горячая паста из одной кастрюли, а не непривычный для России макаронный салат." }, storage: { refrigerator: "В закрытом контейнере при ≤4 °C — ориентировочно до 4 суток.", freezerDays: 45, freezeParts: "Замораживать готовую пасту порционно; сыр для подачи можно добавить уже после разогрева." }, effort: { knifeActions: 4, cookware: 1, activeActions: 10, activeMinutes: 20, level: "high" } }),

  r("src-honey-lime-steak", "lunch", "Говядина с лаймом, рисом, фасолью и кукурузой", "🥩", 60, { kcal: 605, protein: 41, fat: 17, carbs: 73 }, 500, 320, ["protein"], [
    i("beef", "Постная говядина", 136, "г", "Мясо и рыба"), i("rice", "Рис, сухой вес", 54, "г", "Крупы"), i("pepper", "Болгарский перец", 30, "г", "Овощи и фрукты"), i("corn", "Замороженная кукуруза", 20, "г", "Овощи и фрукты"), i("black-beans", "Консервированная фасоль", 84, "г", "Бакалея"), i("salsa", "Томатная сальса", 24, "г", "Бакалея"), i("lime", "Лайм или лимон", 0.2, "шт.", "Овощи и фрукты"), i("honey", "Мёд", 4, "г", "Бакалея"), i("soy", "Соевый соус", 3, "мл", "Бакалея"), i("olive-oil", "Растительное масло", 7.5, "г", "Бакалея"), i("lime-juice", "Сок лайма", 6, "мл", "Овощи и фрукты"),
  ], [
    "Сварите рис; мелко нарезанную зелень и острый перец добавляйте только по желанию, чтобы вкус можно было оставить нейтральным.",
    "Нарежьте говядину тонкими полосками поперёк волокон и ненадолго смешайте с цитрусовым соком, соевым соусом, паприкой и чесноком.",
    "Обжарьте мясо двумя небольшими партиями на хорошо разогретой сковороде, затем верните всё мясо и покройте тонким слоем мёдово-цитрусовой глазировки.",
    "Отдельно прогрейте перец и кукурузу, фасоль промойте и обсушите.",
    "Разложите рис, мясо, фасоль и овощи отдельными секторами; сальсу держите в маленькой ёмкости до подачи.",
  ], 3, true, { provenance: mealPrepManualParsed("Honey Lime Steak Burrito Bowls", "honey-lime-steak-burrito-bowls", "https://mealprepmanual.com/wp-content/uploads/2025/08/Honey-Lime-Steak-Burrito-Bowls.jpg", "Говядина с цитрусовым рисом, фасолью и кукурузой", "Jalapeño и кинза сделаны необязательными; чёрная фасоль заменяется любой консервированной фасолью."), localization: { fit: "adapted", availability: "common", note: "Формат боула оставлен, но все компоненты знакомы и хранятся раздельно." }, storage: { refrigerator: "Мясо, рис, фасоль и приготовленные овощи при ≤4 °C — ориентировочно до 3 суток; сальсу хранить отдельно.", freezerDays: 30, freezeParts: "Замораживать мясо, рис, фасоль и приготовленные овощи. Сальсу и свежую зелень не замораживать." }, packing: { separate: "Сальса и свежая зелень — в маленькую ёмкость; добавлять после разогрева." }, effort: { knifeActions: 4, cookware: 3, activeActions: 13, activeMinutes: 30, level: "high" } }),

  r("src-chile-lime-chicken", "lunch", "Курица с лаймом, золотым рисом и брокколи", "🍋", 65, { kcal: 537, protein: 46, fat: 17, carbs: 50 }, 470, 215, ["protein", "budget"], [
    i("chicken-thigh", "Филе куриного бедра", 182, "г", "Мясо и рыба"), i("rice", "Рис, сухой вес", 36, "г", "Крупы"), i("pasta", "Вермишель, сухой вес", 20, "г", "Крупы"), i("broccoli", "Брокколи", 45, "г", "Овощи и фрукты"), i("butter", "Сливочное масло", 6, "г", "Молочное"), i("lime", "Лайм или лимон", 0.2, "шт.", "Овощи и фрукты"), i("broth", "Куриный бульон", 96, "мл", "Бакалея"),
  ], [
    "Поломайте вермишель на короткие кусочки и слегка подрумяньте её в масле, не допуская потемнения.",
    "Добавьте промытый рис, куркуму, чеснок и бульон; доведите до активного кипения, затем готовьте под плотной крышкой и дайте настояться.",
    "Смешайте куриные бёдра с цитрусовым соком, паприкой, орегано и небольшим количеством масла.",
    "Запеките курицу до полной готовности, дайте ей отдохнуть и нарежьте; соки с противня вмешайте обратно в мясо.",
    "Брокколи быстро приготовьте на пару и разложите вместе с рисом и курицей, не закрывая контейнеры до выхода пара.",
  ], 4, true, { provenance: mealPrepManualParsed("Chile Lime Chicken with Golden Rice", "chile-lime-chicken-with-golden-rice", "https://mealprepmanual.com/wp-content/uploads/2025/03/Untitled-design-10.png", "Курица с цитрусовыми специями, золотым рисом и брокколи", "Fideo заменена обычной тонкой вермишелью, broccolini — брокколи, MSG оставлен необязательным."), localization: { fit: "adapted", availability: "common", note: "Золотой рис с вермишелью непривычен только названием; по продуктам это обычный гарнир к курице." }, storage: { refrigerator: "В закрытом контейнере при ≤4 °C — ориентировочно до 4 суток.", freezerDays: 45, freezeParts: "Курицу и рис можно замораживать вместе; брокколи лучше заморозить отдельно или приготовить свежей." }, effort: { knifeActions: 3, cookware: 3, activeActions: 12, activeMinutes: 25, level: "high" } }),

  r("src-light-stroganoff", "lunch", "Говядина по-строгановски с грибами и пастой", "🍲", 260, { kcal: 507, protein: 40, fat: 11, carbs: 62.5 }, 480, 260, ["protein"], [
    i("beef", "Постная говядина для тушения", 114, "г", "Мясо и рыба"), i("pasta", "Короткая паста, сухой вес", 68, "г", "Крупы"), i("carrot", "Морковь", 45, "г", "Овощи и фрукты"), i("mushrooms", "Шампиньоны", 23, "г", "Овощи и фрукты"), i("onion", "Репчатый лук", 20, "г", "Овощи и фрукты"), i("cream-cheese", "Творожный сыр", 15, "г", "Молочное"), i("yogurt", "Греческий йогурт", 15, "г", "Молочное"), i("broth", "Говяжий бульон", 60, "мл", "Бакалея"), i("mustard", "Дижонская горчица", 1.5, "г", "Бакалея"), i("worcestershire", "Вустерширский соус", 1.5, "г", "Бакалея"), i("starch", "Кукурузный крахмал", 2.4, "г", "Бакалея"),
  ], [
    "Нарежьте говядину небольшими кусочками, лук и морковь — мелко, шампиньоны — пластинками.",
    "Сложите мясо, овощи, бульон, паприку и немного горчицы в медленноварку или тяжёлую кастрюлю и тушите до мягкости мяса.",
    "Отдельно сварите пасту до состояния аль денте и сохраните немного воды от варки.",
    "Смешайте творожный сыр и йогурт с частью горячего соуса, затем верните смесь к мясу, не доводя до бурного кипения.",
    "Соедините нужную на сегодня часть соуса с пастой; порции для заморозки оставьте без пасты.",
  ], 4, true, { provenance: mealPrepManualParsed("Slow Cooker Big Boy Beef Stroganoff", "slow-cooker-big-boy-beef-stroganoff", "https://mealprepmanual.com/wp-content/uploads/2024/12/Big-Boy-Beef-Stroganoff-.jpg", "Тушёная говядина с грибами, морковью и сливочным соусом", "Исходная порция на 1013 ккал разделена пополам; cream cheese подаётся как творожный сыр, крахмал — обычный кукурузный."), localization: { fit: "familiar", availability: "common", note: "Знакомый бефстроганов; необычна только долгая готовка, активных действий немного." }, storage: { refrigerator: "Мясной соус и готовую пасту хранить раздельно при ≤4 °C — ориентировочно до 4 суток.", freezerDays: 45, freezeParts: "Замораживать мясной соус без йогурта и без пасты; молочную часть добавить после разморозки, пасту сварить свежей." }, packing: { separate: "Мясной соус и пасту держать в соседних отделениях; для заморозки упаковывать только соус." }, effort: { knifeActions: 3, cookware: 2, activeActions: 10, activeMinutes: 20, level: "high" } }),

  r("src-sriracha-lime-chicken", "dinner", "Курица в соусе шрирача с бататом, рисом и брокколи", "🌶️", 60, { kcal: 498, protein: 41, fat: 14, carbs: 52 }, 450, 225, ["protein", "budget"], [
    i("chicken-thigh", "Филе куриного бедра", 182, "г", "Мясо и рыба"), i("rice", "Рис, сухой вес", 25, "г", "Крупы"), i("sweet-potato", "Батат", 80, "г", "Овощи и фрукты"), i("broccoli", "Брокколи", 91, "г", "Овощи и фрукты"), i("sriracha", "Соус шрирача", 9, "г", "Бакалея"), i("honey", "Мёд", 11, "г", "Бакалея"), i("lime", "Лайм или лимон", 0.2, "шт.", "Овощи и фрукты"),
  ], [
    "Сварите рис; батат нарежьте кубиками, брокколи разделите на небольшие соцветия.",
    "Смешайте шрирачу, мёд, цитрусовый сок, чеснок и немного воды; для неострой версии замените часть шрирачи томатным соусом.",
    "Покройте куриные бёдра частью соуса и запекайте до полной готовности.",
    "На втором противне запеките батат, а брокколи добавьте ближе к концу, чтобы она не пересохла.",
    "Нарежьте курицу, смешайте с оставшимся соусом и разложите с рисом и овощами по контейнерам.",
  ], 4, true, { provenance: mealPrepManualParsed("Sriracha Lime Chicken Bowls", "sriracha-lime-chicken-bowls", "https://mealprepmanual.com/wp-content/uploads/2024/09/Sriracha-Lime-Chicken-Bowls.jpg", "Курица в сладко-остром соусе с бататом, рисом и брокколи", "Japanese sweet potato заменён обычным бататом; количество шрирачи регулируется вплоть до полной замены томатным соусом."), localization: { fit: "adapted", availability: "specialty", note: "Шрирача продаётся не везде, но блюдо не зависит от неё: остроту можно убрать без смены формата." }, storage: { refrigerator: "В закрытом контейнере при ≤4 °C — ориентировочно до 4 суток.", freezerDays: 45, freezeParts: "Замораживать курицу, рис и батат; брокколи лучше держать отдельно, чтобы не размокла." }, effort: { knifeActions: 3, cookware: 3, activeActions: 11, activeMinutes: 20, level: "high" } }),

  r("src-bbq-burger-bowl", "dinner", "Говяжий боул с картофелем, сыром и BBQ-соусом", "🍔", 45, { kcal: 663, protein: 49, fat: 30, carbs: 49 }, 500, 280, ["protein"], [
    i("beef-mince", "Постный говяжий фарш", 182, "г", "Мясо и рыба"), i("potato", "Картофель", 182, "г", "Овощи и фрукты"), i("cabbage", "Капуста или кейл", 30, "г", "Овощи и фрукты"), i("tomato", "Томат", 20, "г", "Овощи и фрукты"), i("pickles", "Маринованные огурцы", 30, "г", "Овощи и фрукты"), i("cheese", "Полутвёрдый сыр", 17, "г", "Молочное"), i("bbq-sauce", "BBQ-соус", 30, "г", "Бакалея"), i("olive-oil", "Растительное масло", 9, "г", "Бакалея"),
  ], [
    "Нарежьте картофель крупными кубиками, перемешайте с небольшим количеством масла и запекайте до румяной корочки.",
    "Капусту или кейл очень мелко нашинкуйте и коротко помните руками, чтобы она стала мягче.",
    "Подрумяньте фарш на широкой сковороде, затем вмешайте капусту и готовьте до её мягкости.",
    "Остудите горячие компоненты; томат и маринованные огурцы нарежьте отдельно.",
    "В контейнер положите мясо и картофель, сыр — сверху; свежие добавки и BBQ-соус держите отдельно до разогрева.",
  ], 3, true, { provenance: mealPrepManualParsed("BBQ Cheddar Burger Bowls", "bbq-cheddar-burger-bowls", "https://mealprepmanual.com/wp-content/uploads/2025/08/BBQ-Cheddar-Burger-Bowls.jpg", "Говяжий боул с запечённым картофелем, сыром и соусом", "Kale можно заменить белокочанной капустой; американский cheddar — обычным полутвёрдым сыром."), localization: { fit: "adapted", availability: "common", note: "Вкус напоминает бургер, но хлеб заменён запечённым картофелем; компоненты остаются раздельными." }, storage: { refrigerator: "Мясо и картофель при ≤4 °C — ориентировочно до 3 суток; томат, огурцы и соус хранить отдельно.", freezerDays: 45, freezeParts: "Замораживать только мясо и картофель. Сыр, томат, огурцы и BBQ-соус добавить после разморозки." }, packing: { separate: "Томат, огурцы и BBQ-соус — в холодный отдельный отсек; сыр можно положить на мясо." }, effort: { knifeActions: 4, cookware: 3, activeActions: 12, activeMinutes: 25, level: "high" } }),

  r("src-red-pepper-chicken-dip", "snack1", "Куриный дип с запечённым перцем", "🫑", 50, { kcal: 218, protein: 29.2, fat: 9.2, carbs: 4.8 }, 180, 145, ["protein", "keto"], [
    i("chicken", "Куриное филе", 91, "г", "Мясо и рыба"), i("cottage", "Творог 5%", 48, "г", "Молочное"), i("roasted-pepper", "Запечённый болгарский перец", 35, "г", "Овощи и фрукты"), i("milk", "Молоко 2,5%", 18, "мл", "Молочное"), i("cream-cheese", "Творожный сыр", 12, "г", "Молочное"), i("parmesan", "Твёрдый сыр", 6, "г", "Молочное"), i("hot-sauce", "Острый соус", 3, "г", "Бакалея"),
  ], [
    "Приготовьте куриное филе до полной готовности, полностью остудите и разберите на очень мелкие волокна.",
    "Пробейте творог, запечённый перец, молоко, творожный и твёрдый сыр до гладкого соуса.",
    "Вмешайте курицу вручную, чтобы в дипе осталась текстура, и отрегулируйте остроту несколькими каплями соуса.",
    "Разложите по маленьким плотно закрывающимся банкам и сразу уберите в холодильник.",
    "Овощные палочки или хлебцы для подачи держите сухими и отдельно от дипа.",
  ], 3, false, { provenance: mealPrepManualParsed("Roasted Red Pepper Chicken Dip", "roasted-red-pepper-chicken-dip", "https://mealprepmanual.com/wp-content/uploads/2024/12/Roasted-Red-Pepper-Chicken-Dip.jpg", "Белковый куриный дип с запечённым болгарским перцем", "Одна порция Mise — две маленькие порции источника; готовый запечённый перец можно заменить домашним."), localization: { fit: "familiar", availability: "common", note: "Формат дипа менее привычен, но по сути это мягкий куриный паштет для овощей или хлебцев." }, storage: { refrigerator: "В плотно закрытой банке при ≤4 °C — ориентировочно до 3 суток." }, packing: { portion: "Одна порция — банка не меньше 250 мл, заполненная примерно 180 г дипа.", separate: "Овощные палочки или хлебцы хранить в отдельном сухом контейнере.", label: "Куриный дип с запечённым перцем · около 180 г · дата и перекус" }, flex: { protein: [0.8, 1.3], fat: [0.7, 1.2], carbs: [1, 1] }, effort: { knifeActions: 0, cookware: 2, activeActions: 6, activeMinutes: 10, level: "low" } }),

  r("src-beefy-cheese-potatoes", "dinner", "Картофель с говядиной, овощами и сырным соусом", "🥔", 60, { kcal: 667, protein: 48, fat: 33, carbs: 45 }, 520, 285, ["protein"], [
    i("beef-mince", "Постный говяжий фарш", 182, "г", "Мясо и рыба"), i("potato", "Картофель", 200, "г", "Овощи и фрукты"), i("zucchini", "Кабачок", 25, "г", "Овощи и фрукты"), i("onion", "Репчатый лук", 30, "г", "Овощи и фрукты"), i("pepper", "Болгарский перец", 30, "г", "Овощи и фрукты"), i("mushrooms", "Шампиньоны", 23, "г", "Овощи и фрукты"), i("tomato-passata", "Томатный соус", 45, "мл", "Бакалея"), i("cottage", "Творог 5%", 23, "г", "Молочное"), i("cheese", "Полутвёрдый сыр", 11, "г", "Молочное"), i("milk", "Молоко 2,5%", 9, "мл", "Молочное"),
  ], [
    "Нарежьте картофель крупными кубиками, смешайте с небольшим количеством масла и запекайте до румяной поверхности.",
    "Лук и перец подрумяньте первыми, затем добавьте грибы и кабачок и быстро доведите овощи до мягкости без лишней влаги.",
    "Отдельно обжарьте фарш, приправьте паприкой и зирой, затем вмешайте томатный соус и слегка уварите.",
    "Прогрейте творог, сыр и молоко, затем пробейте блендером; для дымного вкуса добавьте щепотку копчёной паприки вместо редкого chipotle adobo.",
    "Разложите картофель, мясо и овощи отдельными секторами, сырный соус налейте в маленькую ёмкость.",
  ], 3, true, { provenance: mealPrepManualParsed("Beefy Queso Loaded Potatoes", "beefy-queso-loaded-potatoes", "https://mealprepmanual.com/wp-content/uploads/2024/07/Beefy-Queso-Loaded-Potatoes.jpg", "Картофель с говядиной, овощами и творожно-сырным соусом", "Poblano заменён болгарским перцем, pepper jack — обычным полутвёрдым сыром, chipotle adobo — копчёной паприкой."), localization: { fit: "adapted", availability: "common", note: "Много компонентов и посуды, зато продукты полностью привычные и соус регулируется отдельно." }, storage: { refrigerator: "Мясо, картофель и овощи при ≤4 °C — ориентировочно до 3 суток; сырный соус хранить отдельно.", freezerDays: 45, freezeParts: "Замораживать мясо и картофель. Овощи и творожно-сырный соус лучше приготовить или хранить отдельно в холодильнике." }, packing: { separate: "Сырный соус — в маленькую ёмкость; картофель не смешивать с влажными овощами до разогрева." }, effort: { knifeActions: 5, cookware: 4, activeActions: 16, activeMinutes: 35, level: "high" } }),
);

const generatedTitles: Record<MenuStyle, Record<MealSlot, string[]>> = {
  protein: {
    breakfast: [
      "Яичные маффины с индейкой",
      "Творожная запеканка с ягодами",
      "Белковые панкейки",
      "Омлет-ролл с курицей",
      "Сырники с протеиновым кремом",
    ],
    lunch: [
      "Курица терияки с гречкой",
      "Индейка с булгуром и овощами",
      "Тунец с пастой и томатами",
      "Говядина с рисом и брокколи",
      "Куриные тефтели с киноа",
    ],
    dinner: [
      "Лосось с зелёными овощами",
      "Курица с чечевицей",
      "Индейка с печёным картофелем",
      "Треска с фасолью",
      "Говяжьи тефтели с гречкой",
    ],
    snack1: [
      "Творожные маффины",
      "Белковые конфеты с какао",
      "Яичные мини-запеканки",
      "Протеиновое печенье",
      "Роллы из индейки",
    ],
    snack2: [
      "Творожный брауни",
      "Маффины с тунцом",
      "Белковые сырники мини",
      "Куриные суфле-кубики",
      "Протеиновые шарики",
    ],
  },
  budget: {
    breakfast: [
      "Овсяная запеканка с яблоком",
      "Ленивые сырники",
      "Омлет с замороженными овощами",
      "Гречневые панкейки",
      "Яичные маффины с морковью",
    ],
    lunch: [
      "Куриные бёдра с гречкой",
      "Чечевичная похлёбка с курицей",
      "Рис с индейкой и капустой",
      "Тушёная фасоль с фаршем",
      "Куриный плов с овощами",
    ],
    dinner: [
      "Тефтели с картофельным пюре",
      "Курица с капустой в духовке",
      "Рыбные котлеты с гречкой",
      "Ленивые голубцы",
      "Чечевица с индейкой",
    ],
    snack1: [
      "Овсяные квадратики",
      "Яичные маффины",
      "Творожное печенье",
      "Морковные сырники",
      "Домашний хумус с лепёшкой",
    ],
    snack2: [
      "Запечённая овсянка мини",
      "Куриные маффины",
      "Творожные батончики",
      "Яблочные оладьи",
      "Яичные рулетики",
    ],
  },
  paleo: {
    breakfast: [
      "Фриттата с индейкой и шпинатом",
      "Батат с яйцом и зеленью",
      "Куриные маффины с овощами",
      "Яблоко с запечёнными яйцами",
      "Омлет с лососем",
    ],
    lunch: [
      "Курица с бататом и брокколи",
      "Говядина с тыквой",
      "Лосось с овощами гриль",
      "Индейка с цветной капустой",
      "Треска с корнеплодами",
    ],
    dinner: [
      "Стейк с печёными овощами",
      "Курица с кабачком и травами",
      "Индейка с тыквенным пюре",
      "Белая рыба с брокколи",
      "Говяжьи котлеты с бататом",
    ],
    snack1: [
      "Куриные мини-котлеты",
      "Яичные маффины со шпинатом",
      "Орехово-яблочные шарики",
      "Роллы из индейки и огурца",
      "Запечённый тунец с овощами",
    ],
    snack2: [
      "Кокосовые шарики с орехами",
      "Мини-фриттата с лососем",
      "Бататовые маффины с индейкой",
      "Куриное суфле с зеленью",
      "Яблочные дольки с орехами",
    ],
  },
  keto: {
    breakfast: [
      "Яичные маффины с беконом",
      "Омлет с лососем и шпинатом",
      "Кето-сырники",
      "Фриттата с курицей",
      "Запеканка с индейкой и сыром",
    ],
    lunch: [
      "Курица с пюре из цветной капусты",
      "Лосось с брокколи и авокадо",
      "Говядина с кабачковой лапшой",
      "Индейка в сливочном соусе",
      "Тунец с зелёной фасолью",
    ],
    dinner: [
      "Куриные бёдра с брокколи",
      "Лосось со шпинатом",
      "Говяжьи котлеты с цветной капустой",
      "Индейка с кабачком",
      "Треска с авокадо-соусом",
    ],
    snack1: [
      "Кето-маффины с яйцом",
      "Сырные шарики с индейкой",
      "Кокосовые жир-бомбы",
      "Мини-фриттата с тунцом",
      "Ореховые батончики без сахара",
    ],
    snack2: [
      "Яичные маффины с лососем",
      "Куриные рулетики с сыром",
      "Кето-брауни мини",
      "Запечённое авокадо с яйцом",
      "Сырные крекеры с индейкой",
    ],
  },
};
const generatedMacros: Record<MenuStyle, Record<MealSlot, Macros>> = {
  protein: {
    breakfast: { kcal: 430, protein: 39, fat: 15, carbs: 34 },
    lunch: { kcal: 530, protein: 53, fat: 17, carbs: 42 },
    dinner: { kcal: 500, protein: 50, fat: 19, carbs: 34 },
    snack1: { kcal: 245, protein: 29, fat: 8, carbs: 15 },
    snack2: { kcal: 235, protein: 28, fat: 8, carbs: 13 },
  },
  budget: {
    breakfast: { kcal: 420, protein: 27, fat: 14, carbs: 48 },
    lunch: { kcal: 515, protein: 39, fat: 16, carbs: 54 },
    dinner: { kcal: 490, protein: 38, fat: 17, carbs: 48 },
    snack1: { kcal: 230, protein: 18, fat: 8, carbs: 25 },
    snack2: { kcal: 225, protein: 18, fat: 7, carbs: 24 },
  },
  paleo: {
    breakfast: { kcal: 410, protein: 31, fat: 22, carbs: 22 },
    lunch: { kcal: 520, protein: 45, fat: 24, carbs: 31 },
    dinner: { kcal: 495, protein: 44, fat: 23, carbs: 27 },
    snack1: { kcal: 240, protein: 21, fat: 14, carbs: 12 },
    snack2: { kcal: 235, protein: 20, fat: 14, carbs: 11 },
  },
  keto: {
    breakfast: { kcal: 430, protein: 30, fat: 31, carbs: 8 },
    lunch: { kcal: 535, protein: 42, fat: 36, carbs: 10 },
    dinner: { kcal: 510, protein: 41, fat: 35, carbs: 9 },
    snack1: { kcal: 255, protein: 20, fat: 19, carbs: 6 },
    snack2: { kcal: 250, protein: 21, fat: 18, carbs: 5 },
  },
};
const generatedIngredients: Record<
  MenuStyle,
  Record<MealSlot, Ingredient[]>
> = {
  protein: {
    breakfast: [
      i("egg", "Яйца", 2, "шт.", "Молочное"),
      i("cottage", "Творог 5%", 120, "г", "Молочное"),
      i("turkey", "Филе индейки", 70, "г", "Мясо и рыба"),
    ],
    lunch: [
      i("chicken", "Куриное филе", 190, "г", "Мясо и рыба"),
      i("buckwheat", "Гречка", 55, "г", "Крупы"),
      i("broccoli", "Брокколи", 140, "г", "Овощи и фрукты"),
    ],
    dinner: [
      i("turkey", "Филе индейки", 190, "г", "Мясо и рыба"),
      i("potato", "Картофель", 150, "г", "Овощи и фрукты"),
      i("zucchini", "Кабачок", 150, "г", "Овощи и фрукты"),
    ],
    snack1: [
      i("cottage", "Творог 5%", 170, "г", "Молочное"),
      i("egg", "Яйца", 1, "шт.", "Молочное"),
      i("berries", "Ягоды", 50, "г", "Овощи и фрукты"),
    ],
    snack2: [
      i("turkey", "Филе индейки", 110, "г", "Мясо и рыба"),
      i("egg", "Яйца", 1, "шт.", "Молочное"),
      i("spinach", "Шпинат", 50, "г", "Овощи и фрукты"),
    ],
  },
  budget: {
    breakfast: [
      i("oats", "Овсяные хлопья", 60, "г", "Крупы"),
      i("egg", "Яйца", 1, "шт.", "Молочное"),
      i("apple", "Яблоко", 0.5, "шт.", "Овощи и фрукты"),
    ],
    lunch: [
      i("chicken-thigh", "Куриные бёдра", 190, "г", "Мясо и рыба"),
      i("buckwheat", "Гречка", 65, "г", "Крупы"),
      i("cabbage", "Капуста", 150, "г", "Овощи и фрукты"),
    ],
    dinner: [
      i("turkey-mince", "Фарш индейки", 170, "г", "Мясо и рыба"),
      i("potato", "Картофель", 190, "г", "Овощи и фрукты"),
      i("carrot", "Морковь", 1, "шт.", "Овощи и фрукты"),
    ],
    snack1: [
      i("cottage", "Творог 5%", 120, "г", "Молочное"),
      i("oats", "Овсяные хлопья", 35, "г", "Крупы"),
      i("egg", "Яйца", 1, "шт.", "Молочное"),
    ],
    snack2: [
      i("egg", "Яйца", 2, "шт.", "Молочное"),
      i("carrot", "Морковь", 0.5, "шт.", "Овощи и фрукты"),
      i("oats", "Овсяные хлопья", 25, "г", "Крупы"),
    ],
  },
  paleo: {
    breakfast: [
      i("egg", "Яйца", 2, "шт.", "Молочное"),
      i("turkey", "Филе индейки", 90, "г", "Мясо и рыба"),
      i("spinach", "Шпинат", 70, "г", "Овощи и фрукты"),
    ],
    lunch: [
      i("chicken", "Куриное филе", 190, "г", "Мясо и рыба"),
      i("sweet-potato", "Батат", 170, "г", "Овощи и фрукты"),
      i("broccoli", "Брокколи", 140, "г", "Овощи и фрукты"),
    ],
    dinner: [
      i("beef", "Постная говядина", 180, "г", "Мясо и рыба"),
      i("pumpkin", "Тыква", 180, "г", "Овощи и фрукты"),
      i("zucchini", "Кабачок", 140, "г", "Овощи и фрукты"),
    ],
    snack1: [
      i("turkey", "Филе индейки", 100, "г", "Мясо и рыба"),
      i("apple", "Яблоко", 0.5, "шт.", "Овощи и фрукты"),
      i("almond", "Миндаль", 18, "г", "Бакалея"),
    ],
    snack2: [
      i("tuna", "Тунец", 100, "г", "Мясо и рыба"),
      i("egg", "Яйца", 1, "шт.", "Молочное"),
      i("greens", "Зелень", 30, "г", "Овощи и фрукты"),
    ],
  },
  keto: {
    breakfast: [
      i("egg", "Яйца", 3, "шт.", "Молочное"),
      i("cheese", "Твёрдый сыр", 45, "г", "Молочное"),
      i("spinach", "Шпинат", 70, "г", "Овощи и фрукты"),
    ],
    lunch: [
      i("salmon", "Филе лосося", 170, "г", "Мясо и рыба"),
      i("cauliflower", "Цветная капуста", 190, "г", "Овощи и фрукты"),
      i("avocado", "Авокадо", 0.5, "шт.", "Овощи и фрукты"),
    ],
    dinner: [
      i("chicken-thigh", "Куриные бёдра", 200, "г", "Мясо и рыба"),
      i("broccoli", "Брокколи", 170, "г", "Овощи и фрукты"),
      i("olive-oil", "Оливковое масло", 15, "мл", "Бакалея"),
    ],
    snack1: [
      i("egg", "Яйца", 2, "шт.", "Молочное"),
      i("cheese", "Твёрдый сыр", 40, "г", "Молочное"),
      i("almond", "Миндаль", 15, "г", "Бакалея"),
    ],
    snack2: [
      i("turkey", "Филе индейки", 100, "г", "Мясо и рыба"),
      i("cream-cheese", "Творожный сыр", 35, "г", "Молочное"),
      i("spinach", "Шпинат", 40, "г", "Овощи и фрукты"),
    ],
  },
};
const titleIngredientRules: {
  pattern: RegExp;
  kind: "protein" | "base" | "extra";
  ingredient: Ingredient;
}[] = [
  {
    pattern: /курин.*б[её]др/,
    kind: "protein",
    ingredient: i("chicken-thigh", "Куриные бёдра", 190, "г", "Мясо и рыба"),
  },
  {
    pattern: /куриц|курин/,
    kind: "protein",
    ingredient: i("chicken", "Куриное филе", 180, "г", "Мясо и рыба"),
  },
  {
    pattern: /индейк/,
    kind: "protein",
    ingredient: i("turkey", "Филе индейки", 180, "г", "Мясо и рыба"),
  },
  {
    pattern: /лосос/,
    kind: "protein",
    ingredient: i("salmon", "Филе лосося", 170, "г", "Мясо и рыба"),
  },
  {
    pattern: /туне?ц|тунц/,
    kind: "protein",
    ingredient: i("tuna", "Тунец", 140, "г", "Мясо и рыба"),
  },
  {
    pattern: /говядин|говяж|стейк/,
    kind: "protein",
    ingredient: i("beef", "Постная говядина", 180, "г", "Мясо и рыба"),
  },
  {
    pattern: /треск|белая рыба|рыбн/,
    kind: "protein",
    ingredient: i("cod", "Филе белой рыбы", 190, "г", "Мясо и рыба"),
  },
  {
    pattern: /яйц|яич|омлет|фриттат/,
    kind: "protein",
    ingredient: i("egg", "Яйца", 3, "шт.", "Молочное"),
  },
  {
    pattern: /творож|сырник/,
    kind: "protein",
    ingredient: i("cottage", "Творог 5%", 180, "г", "Молочное"),
  },
  {
    pattern: /протеин|белков/,
    kind: "protein",
    ingredient: i("protein-powder", "Сывороточный протеин", 30, "г", "Бакалея"),
  },
  {
    pattern: /бекон/,
    kind: "protein",
    ingredient: i("bacon", "Бекон", 70, "г", "Мясо и рыба"),
  },
  {
    pattern: /хумус/,
    kind: "protein",
    ingredient: i("chickpeas", "Нут консервированный", 120, "г", "Бакалея"),
  },
  {
    pattern: /чечевиц/,
    kind: "base",
    ingredient: i("lentils", "Чечевица", 70, "г", "Крупы"),
  },
  {
    pattern: /фасол/,
    kind: "base",
    ingredient: i("white-beans", "Фасоль", 120, "г", "Бакалея"),
  },
  {
    pattern: /греч/,
    kind: "base",
    ingredient: i("buckwheat", "Гречка", 60, "г", "Крупы"),
  },
  {
    pattern: /рис|плов/,
    kind: "base",
    ingredient: i("rice", "Рис", 60, "г", "Крупы"),
  },
  {
    pattern: /булгур/,
    kind: "base",
    ingredient: i("bulgur", "Булгур", 60, "г", "Крупы"),
  },
  {
    pattern: /паст/,
    kind: "base",
    ingredient: i("pasta", "Паста", 65, "г", "Крупы"),
  },
  {
    pattern: /киноа/,
    kind: "base",
    ingredient: i("quinoa", "Киноа", 55, "г", "Крупы"),
  },
  {
    pattern: /овсян/,
    kind: "base",
    ingredient: i("oats", "Овсяные хлопья", 55, "г", "Крупы"),
  },
  {
    pattern: /батат/,
    kind: "base",
    ingredient: i("sweet-potato", "Батат", 170, "г", "Овощи и фрукты"),
  },
  {
    pattern: /картоф/,
    kind: "base",
    ingredient: i("potato", "Картофель", 180, "г", "Овощи и фрукты"),
  },
  {
    pattern: /леп[её]ш/,
    kind: "base",
    ingredient: i("flatbread", "Цельнозерновая лепёшка", 60, "г", "Хлеб"),
  },
  {
    pattern: /зел[её]н.*фасол|стручков.*фасол/,
    kind: "extra",
    ingredient: i(
      "green-beans",
      "Стручковая фасоль",
      140,
      "г",
      "Овощи и фрукты",
    ),
  },
  {
    pattern: /брокк/,
    kind: "extra",
    ingredient: i("broccoli", "Брокколи", 150, "г", "Овощи и фрукты"),
  },
  {
    pattern: /цветн.*капуст/,
    kind: "extra",
    ingredient: i("cauliflower", "Цветная капуста", 170, "г", "Овощи и фрукты"),
  },
  {
    pattern: /капуст/,
    kind: "extra",
    ingredient: i("cabbage", "Капуста", 160, "г", "Овощи и фрукты"),
  },
  {
    pattern: /кабач/,
    kind: "extra",
    ingredient: i("zucchini", "Кабачок", 150, "г", "Овощи и фрукты"),
  },
  {
    pattern: /тыкв/,
    kind: "extra",
    ingredient: i("pumpkin", "Тыква", 170, "г", "Овощи и фрукты"),
  },
  {
    pattern: /шпинат/,
    kind: "extra",
    ingredient: i("spinach", "Шпинат", 70, "г", "Овощи и фрукты"),
  },
  {
    pattern: /морков/,
    kind: "extra",
    ingredient: i("carrot", "Морковь", 1, "шт.", "Овощи и фрукты"),
  },
  {
    pattern: /яблоч|яблок/,
    kind: "extra",
    ingredient: i("apple", "Яблоко", 1, "шт.", "Овощи и фрукты"),
  },
  {
    pattern: /ягод/,
    kind: "extra",
    ingredient: i("berries", "Ягоды", 70, "г", "Овощи и фрукты"),
  },
  {
    pattern: /авокад/,
    kind: "extra",
    ingredient: i("avocado", "Авокадо", 0.5, "шт.", "Овощи и фрукты"),
  },
  {
    pattern: /томат/,
    kind: "extra",
    ingredient: i("tomato", "Томаты", 1, "шт.", "Овощи и фрукты"),
  },
  {
    pattern: /огур/,
    kind: "extra",
    ingredient: i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"),
  },
  {
    pattern: /корнеплод/,
    kind: "extra",
    ingredient: i("root-veg", "Корнеплоды", 170, "г", "Овощи и фрукты"),
  },
  {
    pattern: /овощ/,
    kind: "extra",
    ingredient: i("mixed-veg", "Овощная смесь", 160, "г", "Овощи и фрукты"),
  },
  {
    pattern: /зеленью|трав/,
    kind: "extra",
    ingredient: i("greens", "Зелень", 25, "г", "Овощи и фрукты"),
  },
  {
    pattern: /сливочн/,
    kind: "extra",
    ingredient: i("cream", "Сливки 20%", 70, "мл", "Молочное"),
  },
  {
    pattern: /кокос/,
    kind: "extra",
    ingredient: i("coconut-flakes", "Кокосовая стружка", 25, "г", "Бакалея"),
  },
  {
    pattern: /орех/,
    kind: "extra",
    ingredient: i("almond", "Миндаль", 22, "г", "Бакалея"),
  },
  {
    pattern: /какао|брауни|шоколад/,
    kind: "extra",
    ingredient: i("cocoa", "Какао", 12, "г", "Бакалея"),
  },
  {
    pattern: /сыр(?!ник)/,
    kind: "extra",
    ingredient: i("cheese", "Твёрдый сыр", 45, "г", "Молочное"),
  },
];
function ingredientsForTitle(
  title: string,
  base: Ingredient[],
  style: MenuStyle,
) {
  const normalized = title.toLowerCase();
  let matched = titleIngredientRules.filter((rule) =>
    rule.pattern.test(normalized),
  );
  if (/курин.*б[её]др/.test(normalized))
    matched = matched.filter((rule) => rule.ingredient.id !== "chicken");
  if (/зел[её]н.*фасол|стручков.*фасол/.test(normalized))
    matched = matched.filter((rule) => rule.ingredient.id !== "white-beans");
  if (/цветн.*капуст/.test(normalized))
    matched = matched.filter((rule) => rule.ingredient.id !== "cabbage");

  const merged = new Map<string, Ingredient>();
  const add = (ingredient: Ingredient) =>
    merged.set(`${ingredient.id}:${ingredient.unit}`, ingredient);
  matched.forEach((rule) => add(rule.ingredient));

  const animalProteinIds = new Set([
    "chicken",
    "chicken-thigh",
    "turkey",
    "turkey-mince",
    "beef",
    "salmon",
    "cod",
    "tuna",
    "bacon",
  ]);
  const proteinIds = new Set([
    ...animalProteinIds,
    "egg",
    "cottage",
    "tofu",
    "protein-powder",
    "hummus",
    "chickpeas",
  ]);
  const baseIds = new Set([
    "oats",
    "buckwheat",
    "rice",
    "brown-rice",
    "quinoa",
    "lentils",
    "white-beans",
    "potato",
    "sweet-potato",
    "bulgur",
    "pasta",
    "flatbread",
  ]);
  const sweet =
    /творожн.*(?:запеканк|маффин)|сырник|панкейк|конфет|печень|брауни|батончик|овсян.*(?:запеканк|квадратик)|яблоч.*олад|(?:кокосов|орехов|протеинов).*шарик|жир-бомб/.test(
      normalized,
    );
  const formed = /тефтел|котлет|голубц/.test(normalized);
  const baked =
    /маффин|запеканк|панкейк|сырник|печень|брауни|олад|суфле|тефтел|котлет|голубц|крекер|квадратик/.test(
      normalized,
    );
  const needsFlour =
    /маффин|панкейк|сырник|печень|брауни|олад|крекер|квадратик|творожн.*запеканк/.test(
      normalized,
    );

  if (
    formed &&
    ![...merged.values()].some((ingredient) =>
      animalProteinIds.has(ingredient.id),
    )
  )
    add(i("turkey-mince", "Фарш индейки", 170, "г", "Мясо и рыба"));
  if (/голубц/.test(normalized) && !merged.has("rice:г"))
    add(i("rice", "Рис", 45, "г", "Крупы"));
  if (baked && !merged.has("egg:шт."))
    add(i("egg", "Яйца", 1, "шт.", "Молочное"));
  if (
    needsFlour &&
    ![...merged.values()].some((ingredient) => baseIds.has(ingredient.id))
  ) {
    add(
      style === "keto" || style === "paleo"
        ? i("almond-flour", "Миндальная мука", 35, "г", "Бакалея")
        : i("oats", "Овсяные хлопья", 35, "г", "Крупы"),
    );
  }
  if (/терияки/.test(normalized))
    add(i("soy", "Соевый соус", 20, "мл", "Бакалея"));
  if (/домашний хумус/.test(normalized)) {
    add(i("tahini", "Тахини", 15, "г", "Бакалея"));
    add(i("lemon-juice", "Лимонный сок", 10, "мл", "Овощи и фрукты"));
    add(i("olive-oil", "Оливковое масло", 5, "мл", "Бакалея"));
    add(i("garlic", "Чеснок", 0.25, "шт.", "Овощи и фрукты"));
  }
  if (/рулл|ролл|рулет/.test(normalized) && !sweet) {
    add(
      style === "paleo"
        ? i("avocado", "Авокадо", 0.5, "шт.", "Овощи и фрукты")
        : i("cream-cheese", "Творожный сыр", 35, "г", "Молочное"),
    );
    if (!merged.has("cucumber:шт."))
      add(i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"));
  }
  if (/конфет|шарик|батончик|жир-бомб/.test(normalized)) {
    if (!merged.has("almond:г"))
      add(i("almond", "Миндаль", 22, "г", "Бакалея"));
    add(
      style === "keto" || style === "paleo" || /жир-бомб/.test(normalized)
        ? i("coconut-oil", "Кокосовое масло", 15, "мл", "Бакалея")
        : i("peanut-butter", "Арахисовая паста", 20, "г", "Бакалея"),
    );
  }
  if (
    /яйц|яич/.test(normalized) &&
    /маффин|запеканк/.test(normalized) &&
    merged.size < 2
  )
    add(i("mixed-veg", "Овощная смесь", 120, "г", "Овощи и фрукты"));

  if (merged.size < 2) {
    const hasProtein = [...merged.values()].some((ingredient) =>
      proteinIds.has(ingredient.id),
    );
    const hasBase = [...merged.values()].some((ingredient) =>
      baseIds.has(ingredient.id),
    );
    for (const ingredient of base) {
      if (hasProtein && proteinIds.has(ingredient.id)) continue;
      if (hasBase && baseIds.has(ingredient.id)) continue;
      if (sweet && animalProteinIds.has(ingredient.id)) continue;
      if (style === "keto" && baseIds.has(ingredient.id)) continue;
      if (
        style === "paleo" &&
        (baseIds.has(ingredient.id) ||
          ["cottage", "cheese", "cream-cheese"].includes(ingredient.id))
      )
        continue;
      add(ingredient);
      if (merged.size >= 2) break;
    }
  }
  return [...merged.values()];
}
const generatedReferences: Record<MenuStyle, string[]> = {
  protein: [recipeSources.chickenBowl.url, recipeSources.proteinOats.url],
  budget: [recipeSources.chickenBuckwheat.url, recipeSources.chickenRice.url],
  paleo: [recipeSources.salmonPrep.url],
  keto: [recipeSources.cottageBake.url, recipeSources.salmonPrep.url],
};
function generatedRecipeFreezable(title: string) {
  return !/авокад.*яйц|яблочные дольки|роллы из индейки(?: и огурца)?$/i.test(
    title,
  );
}
for (const style of Object.keys(generatedTitles) as MenuStyle[])
  for (const slot of Object.keys(mealMeta) as MealSlot[])
    generatedTitles[style][slot].forEach((title, index) =>
      recipes.push(
        r(
          `gen-${style}-${slot}-${index}`,
          slot,
          title,
          mealMeta[slot].icon,
          18 + index * 3,
          scaleMacros(generatedMacros[style][slot], 0.94 + index * 0.03),
          slot.startsWith("snack") ? 240 : 410,
          style === "budget" ? 105 + index * 9 : 175 + index * 18,
          [style],
          ingredientsForTitle(title, generatedIngredients[style][slot], style),
          commonSteps,
          4,
          generatedRecipeFreezable(title),
          {
            provenance: {
              kind: "generated",
              basedOn: generatedReferences[style],
            },
          },
        ),
      ),
    );

/* Порции плана: по одному контейнеру на человека, приём пищи и день партии. */
function totalPlanPortions(plan: ActivePlan) {
  return plan.batches.reduce(
    (sum, batch) =>
      sum +
      batch.days *
        plan.mealSlots.reduce(
          (slotSum, slot) =>
            slotSum +
            plan.people.filter((person) => person.includedSlots.includes(slot))
              .length,
          0,
        ),
    0,
  );
}

const recipesById = Object.fromEntries(
  recipes.map((recipe) => [recipe.id, recipe]),
) as Record<string, Recipe>;
const recipeFamiliesById = Object.fromEntries(
  recipes
    .map((recipe) => [recipe.id, recipeToFamily(recipe)] as const)
    .filter((entry): entry is readonly [string, RecipeFamily] => Boolean(entry[1])),
) as Record<string, RecipeFamily>;
function isProductionReadyRecipe(recipe: Recipe) {
  return recipeFamiliesById[recipe.id]?.reviewStatus !== "review_required";
}
const productionRecipes = recipes.filter(isProductionReadyRecipe);
function clientId() {
  const key = "mise-client-id";
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}
function analyticsKey(kind: "id" | "sent", dedupeKey: string) {
  return `${analyticsStoragePrefix}:${kind}:${dedupeKey}`;
}
function analyticsWasSent(dedupeKey: string) {
  return localStorage.getItem(analyticsKey("sent", dedupeKey)) === "1";
}
async function trackAnalytics(
  eventName: ClientAnalyticsEvent,
  fields: ClientAnalyticsFields = {},
  dedupeKey?: string,
) {
  try {
    if (dedupeKey && analyticsWasSent(dedupeKey)) return true;
    const idKey = dedupeKey ? analyticsKey("id", dedupeKey) : null;
    const storedId = idKey ? localStorage.getItem(idKey) : null;
    const eventId = storedId ?? crypto.randomUUID();
    if (idKey && !storedId) localStorage.setItem(idKey, eventId);
    const response = await fetch("/api/analytics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mise-Client": clientId(),
      },
      body: JSON.stringify({
        eventId,
        eventName,
        ...fields,
        occurredAt: Date.now(),
      }),
      keepalive: true,
    });
    if (!response.ok) return false;
    if (dedupeKey)
      localStorage.setItem(analyticsKey("sent", dedupeKey), "1");
    return true;
  } catch {
    return false;
  }
}
function deviceId() {
  const key = "mise-device-id";
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}
function parseDate(value: string) {
  return new Date(`${value}T12:00:00`);
}
function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function addDays(value: string, amount: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return isoDate(date);
}
function daysInclusive(start: string, end: string) {
  return (
    Math.floor(
      (parseDate(end).getTime() - parseDate(start).getTime()) / 86_400_000,
    ) + 1
  );
}
function formatDate(value: string, withWeekday = false) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    ...(withWeekday ? { weekday: "short" } : {}),
  })
    .format(parseDate(value))
    .replace(".", "");
}
function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function clampDate(value: string, min: string, max: string) {
  return value < min ? min : value > max ? max : value;
}
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
function macroCalories(macros: Pick<Macros, "protein" | "fat" | "carbs">) {
  return nutritionMacroCalories(macros);
}
function macrosForCalories(kcal: number, preset: MacroPresetOption): Macros {
  return nutritionMacrosForCalories(kcal, preset);
}
function recalculateDailyMacros(
  kcal: number,
  current: Macros,
  preset: MacroPreset,
): Macros {
  return nutritionRecalculateDailyMacros(kcal, current, preset);
}
function scaleMacros(macros: Macros, factor: number): Macros {
  return {
    kcal: round(macros.kcal * factor),
    protein: round(macros.protein * factor),
    fat: round(macros.fat * factor),
    carbs: round(macros.carbs * factor),
  };
}
function addMacros(values: Macros[]): Macros {
  return values.reduce<Macros>(
    (sum, item) => ({
      kcal: sum.kcal + item.kcal,
      protein: sum.protein + item.protein,
      fat: sum.fat + item.fat,
      carbs: sum.carbs + item.carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
}
function targetFor(person: Person, slot: MealSlot): Macros {
  return person.includedSlots.includes(slot)
    ? calculateMealPlanTargets(person.daily, person.includedSlots).slots[slot]
    : { kcal: 0, protein: 0, fat: 0, carbs: 0 };
}
function plannedTargetsFor(person: Person): Macros {
  return calculateMealPlanTargets(person.daily, person.includedSlots).planned;
}
function macroDifference(goal: Macros, planned: Macros): Macros {
  return {
    kcal: round(goal.kcal - planned.kcal),
    protein: round(goal.protein - planned.protein),
    fat: round(goal.fat - planned.fat),
    carbs: round(goal.carbs - planned.carbs),
  };
}
const proteinIngredientIds = new Set([
  "chicken",
  "chicken-thigh",
  "chicken-mince",
  "turkey",
  "turkey-mince",
  "turkey-slices",
  "beef",
  "beef-mince",
  "pork-mince",
  "salmon",
  "cod",
  "tuna",
  "egg",
  "cottage",
  "yogurt",
  "kefir",
  "tofu",
  "hummus",
  "protein-powder",
]);
const carbIngredientIds = new Set([
  "oats",
  "buckwheat",
  "rice",
  "brown-rice",
  "quinoa",
  "lentils",
  "white-beans",
  "red-beans",
  "potato",
  "sweet-potato",
  "bulgur",
  "pasta",
  "flatbread",
  "tortilla",
  "bread",
]);
const fatIngredientIds = new Set([
  "oil",
  "olive-oil",
  "coconut-oil",
  "peanut-butter",
  "almond-paste",
  "almond",
  "walnut",
  "seeds",
  "chia",
  "avocado",
  "cheese",
  "feta",
  "mozzarella",
  "cream-cheese",
  "cream",
  "butter",
  "coconut-milk",
  "mayonnaise",
]);
type PortionComponent = {
  id: "protein" | "carbs" | "vegetables";
  label: string;
  ingredients: Ingredient[];
};
function portionComponents(recipe: Recipe): PortionComponent[] {
  const text = recipe.title.toLowerCase();
  const mixed =
    /паста|макарон|лапш|карри|плов|похл[её]б|туш[её]н|чечевиц|фасол|запеканк|смузи|пудинг|омлет|фриттат|маффин/.test(
      text,
    );
  if (mixed) return [];
  const protein = recipe.ingredients.filter((ingredient) =>
    proteinIngredientIds.has(ingredient.id),
  );
  const carbs = recipe.ingredients.filter((ingredient) =>
    carbIngredientIds.has(ingredient.id),
  );
  const vegetables = recipe.ingredients.filter(
    (ingredient) =>
      ingredient.group === "Овощи и фрукты" &&
      !proteinIngredientIds.has(ingredient.id) &&
      !carbIngredientIds.has(ingredient.id),
  );
  const components: PortionComponent[] = [];
  if (protein.length)
    components.push({
      id: "protein",
      label: protein[0].name,
      ingredients: protein,
    });
  if (carbs.length)
    components.push({ id: "carbs", label: carbs[0].name, ingredients: carbs });
  if (vegetables.length)
    components.push({
      id: "vegetables",
      label: "Овощи",
      ingredients: vegetables,
    });
  return components.length >= 2 ? components : [];
}
function portionFor(
  person: Person,
  slot: MealSlot,
  recipe: Recipe,
  tuning?: RecipeTuning,
) {
  const target = targetFor(person, slot);
  const family = recipeFamiliesById[recipe.id];
  if (family) {
    const ratios = tuning
      ? {
          protein: clamp(tuning.protein, ...recipe.flex.protein),
          fat: clamp(tuning.fat, ...recipe.flex.fat),
          carbs: clamp(tuning.carbs, ...recipe.flex.carbs),
        }
      : { protein: 1, fat: 1, carbs: 1 };
    const solved = solveRecipeFamily(family, {
      targetCalories: target.kcal,
      targetProtein: Math.min(
        target.kcal / 8,
        target.protein * ratios.protein,
      ),
      hardExclusions: person.hardExclusions,
    });
    if (solved.viable) {
      const baseAmount = family.ingredients.reduce(
        (sum, ingredient) => sum + ingredient.baseAmount,
        0,
      );
      const solvedAmount = Object.values(solved.amounts).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      return {
        target,
        factor: solvedAmount / Math.max(1, baseAmount),
        actual: solved.nutrition,
        ratios,
        grams: round(solvedAmount),
        solvedAmounts: solved.amounts,
        engine: "recipe-family-v1" as const,
      };
    }
  }
  const factor = target.kcal > 0 ? target.kcal / recipe.macros.kcal : 0;
  const proportional = scaleMacros(recipe.macros, factor);
  const automatic = {
    protein: proportional.protein
      ? clamp(target.protein / proportional.protein, ...recipe.flex.protein)
      : 1,
    fat: proportional.fat
      ? clamp(target.fat / proportional.fat, ...recipe.flex.fat)
      : 1,
    carbs: proportional.carbs
      ? clamp(target.carbs / proportional.carbs, ...recipe.flex.carbs)
      : 1,
  };
  const ratios = tuning
    ? {
        protein: clamp(tuning.protein, ...recipe.flex.protein),
        fat: clamp(tuning.fat, ...recipe.flex.fat),
        carbs: clamp(tuning.carbs, ...recipe.flex.carbs),
      }
    : automatic;
  const desired = {
    protein: proportional.protein * ratios.protein,
    fat: proportional.fat * ratios.fat,
    carbs: proportional.carbs * ratios.carbs,
  };
  const desiredCalories = macroCalories(desired);
  const hardCapFactor =
    desiredCalories > target.kcal && desiredCalories > 0
      ? target.kcal / desiredCalories
      : 1;
  const actual = capMacrosAtCalories(target.kcal, desired);
  const effectiveFactor = factor * hardCapFactor;
  const gramsFactor =
    effectiveFactor *
    (ratios.protein * 0.35 + ratios.fat * 0.2 + ratios.carbs * 0.45);
  return {
    target,
    factor: effectiveFactor,
    actual,
    ratios,
    grams: round(recipe.servingWeight * gramsFactor),
    solvedAmounts: undefined,
    engine: "legacy" as const,
  };
}
function ingredientRatioFor(ingredient: Ingredient, ratios: RecipeTuning) {
  if (proteinIngredientIds.has(ingredient.id)) return ratios.protein;
  if (carbIngredientIds.has(ingredient.id)) return ratios.carbs;
  if (fatIngredientIds.has(ingredient.id)) return ratios.fat;
  return 1;
}
function ingredientScaleFor(
  ingredient: Ingredient,
  portion: ReturnType<typeof portionFor>,
) {
  const solvedAmount = portion.solvedAmounts?.[ingredient.id];
  if (typeof solvedAmount === "number")
    return solvedAmount / Math.max(ingredient.quantity, 0.0001);
  return portion.factor * ingredientRatioFor(ingredient, portion.ratios);
}
function buildBatches(
  start: string,
  periodDays: number,
  cookEveryDays: number,
): Batch[] {
  const result: Batch[] = [];
  let offset = 0;
  while (offset < periodDays) {
    const days = Math.min(cookEveryDays, periodDays - offset);
    result.push({
      id: `batch-${result.length}`,
      index: result.length,
      start: addDays(start, offset),
      end: addDays(start, offset + days - 1),
      days,
    });
    offset += days;
  }
  return result;
}
function notificationPlanFor(plan: ActivePlan): NotificationPlan {
  const frozenUseDates = plan.batches.flatMap((batch) =>
    Array.from({ length: batch.days }, (_, dayIndex) => ({
      date: addDays(batch.start, dayIndex),
      dayIndex,
    }))
      .filter(({ dayIndex }) =>
        plan.mealSlots.some((slot) => {
          const recipe =
            recipesById[plan.selections[selectionKey(batch, slot)]];
          return Boolean(recipe?.freezable && dayIndex >= recipe.storageDays);
        }),
      )
      .map(({ date }) => date),
  );
  return {
    id: plan.id,
    end: plan.end,
    batches: plan.batches.map(({ id, index, start }) => ({ id, index, start })),
    frozenUseDates,
  };
}
function selectionKey(batch: Batch, slot: MealSlot) {
  return `${batch.id}:${slot}`;
}
function tuningKey(batch: Batch, slot: MealSlot, person: Person) {
  return `${batch.id}:${slot}:${person.id}`;
}
function hardConflicts(recipe: Recipe, person: Person) {
  const forbidden = new Set(person.hardExclusions ?? []);
  return recipe.allergens.filter((allergen) => forbidden.has(allergen));
}
function dislikeMatches(recipe: Recipe, person: Person) {
  const selected = new Set(person.dislikes ?? []);
  return dislikeOptions
    .filter(
      (option) =>
        selected.has(option.id) &&
        option.ingredientIds.some((id) =>
          recipe.ingredients.some((ingredient) => ingredient.id === id),
        ),
    )
    .map((option) => option.label);
}
function relevantPeople(people: Person[], slot: MealSlot) {
  return people.filter((person) => person.includedSlots.includes(slot));
}
function validateHardExclusions(
  plan: Pick<ActivePlan, "batches" | "mealSlots" | "people" | "selections">,
) {
  const conflicts: {
    batch: Batch;
    slot: MealSlot;
    person: Person;
    recipe: Recipe;
    allergens: Allergen[];
  }[] = [];
  for (const batch of plan.batches)
    for (const slot of plan.mealSlots) {
      const recipe = recipesById[plan.selections[selectionKey(batch, slot)]];
      if (!recipe) continue;
      for (const person of relevantPeople(plan.people, slot)) {
        const allergens = hardConflicts(recipe, person);
        if (allergens.length)
          conflicts.push({ batch, slot, person, recipe, allergens });
      }
    }
  return conflicts;
}
function crossContactWarnings(
  plan: Pick<ActivePlan, "batches" | "mealSlots" | "people" | "selections">,
  batch: Batch,
) {
  const prepared = new Set<Allergen>();
  for (const slot of plan.mealSlots) {
    const recipe = recipesById[plan.selections[selectionKey(batch, slot)]];
    recipe?.allergens.forEach((allergen) => prepared.add(allergen));
  }
  return plan.people.flatMap((person) =>
    (person.hardExclusions ?? [])
      .filter((allergen) => prepared.has(allergen))
      .map((allergen) => ({ person, allergen })),
  );
}
function buildShopping(
  plan: Pick<ActivePlan, "batches" | "selections" | "people" | "tuning">,
): ShoppingItem[] {
  const aggregate = new Map<string, ShoppingItem>();
  for (const batch of plan.batches)
    for (const slot of Object.keys(mealMeta) as MealSlot[]) {
      const recipe = recipesById[plan.selections[selectionKey(batch, slot)]];
      if (!recipe) continue;
      const portions = plan.people
        .filter((person) => person.includedSlots.includes(slot))
        .map((person) =>
          portionFor(
            person,
            slot,
            recipe,
            plan.tuning?.[tuningKey(batch, slot, person)],
          ),
        );
      for (const ingredient of recipe.ingredients) {
        const key = `${ingredient.id}:${ingredient.unit}`;
        const existing = aggregate.get(key);
        const totalScale =
          portions.reduce(
            (sum, portion) => sum + ingredientScaleFor(ingredient, portion),
            0,
          ) * batch.days;
        const quantity = ingredient.quantity * totalScale;
        if (existing) existing.quantity += quantity;
        else
          aggregate.set(key, { ...ingredient, key, quantity, checked: false });
      }
    }
  return [...aggregate.values()]
    .filter((item) => item.quantity > 0)
    .map((item) => ({
      ...item,
      quantity:
        item.unit === "шт."
          ? Math.ceil(item.quantity)
          : Math.ceil(item.quantity / 10) * 10,
    }))
    .sort(
      (a, b) =>
        a.group.localeCompare(b.group, "ru") ||
        a.name.localeCompare(b.name, "ru"),
    );
}
function styleScore(recipe: Recipe, style: MenuStyle) {
  if (style === "protein")
    return (
      recipe.macros.protein * 3 -
      recipe.macros.kcal * 0.025 +
      (recipe.tags.includes(style) ? 50 : 0)
    );
  if (style === "budget")
    return 400 - recipe.cost + (recipe.tags.includes(style) ? 70 : 0);
  if (style === "keto")
    return (
      160 - recipe.macros.carbs * 3 + (recipe.tags.includes(style) ? 80 : 0)
    );
  return (
    (recipe.tags.includes(style) ? 120 : 0) +
    recipe.macros.protein -
    recipe.macros.carbs * 0.5
  );
}
type CatalogFilters = {
  origin?: RecipeOrigin;
  effort?: "low" | "high";
  time?: "quick" | "medium" | "long";
  limit?: number | "all";
  includeDisliked?: boolean;
};
function timeBand(recipe: Recipe): NonNullable<CatalogFilters["time"]> {
  return recipe.time <= 20 ? "quick" : recipe.time <= 40 ? "medium" : "long";
}
function recipeFamilyViableFor(recipe: Recipe, person: Person, slot: MealSlot) {
  const family = recipeFamiliesById[recipe.id];
  if (!family) return true;
  if (family.reviewStatus !== "pilot") return false;
  const target = targetFor(person, slot);
  return solveRecipeFamily(family, {
    targetCalories: target.kcal,
    hardExclusions: person.hardExclusions,
  }).viable;
}
function candidateRecipes(
  slot: MealSlot,
  style: MenuStyle,
  people: Person[] = [],
  batchDays = 1,
  filters: CatalogFilters = {},
) {
  const eaters = relevantPeople(people, slot);
  const sorted = recipes
    .filter(
      (recipe) =>
        recipe.slot === slot &&
        recipe.tags.includes(style) &&
        isProductionReadyRecipe(recipe) &&
        (recipe.storageDays >= batchDays || recipe.freezable) &&
        eaters.every((person) => hardConflicts(recipe, person).length === 0) &&
        eaters.every((person) => recipeFamilyViableFor(recipe, person, slot)) &&
        (filters.includeDisliked ||
          eaters.every((person) => dislikeMatches(recipe, person).length === 0)) &&
        (!filters.origin || recipe.provenance.kind === filters.origin) &&
        (!filters.effort || recipe.effort.level === filters.effort) &&
        (!filters.time || timeBand(recipe) === filters.time),
    )
    .sort(
      (a, b) =>
        fitScore(b, people, slot) * 4 +
        styleScore(b, style) +
        (b.provenance.kind === "parsed" ? 12 : 0) -
        (fitScore(a, people, slot) * 4 +
          styleScore(a, style) +
          (a.provenance.kind === "parsed" ? 12 : 0)),
    );
  return filters.limit === "all" ? sorted : sorted.slice(0, filters.limit ?? 5);
}
function fitScore(recipe: Recipe, people: Person[], slot: MealSlot) {
  const eaters = people.filter((person) => person.includedSlots.includes(slot));
  if (!eaters.length) return 0;
  const scores = eaters.map((person) => {
    const { target, actual } = portionFor(person, slot, recipe);
    if (target.kcal <= 0) return 0;
    const p =
      Math.abs(actual.protein - target.protein) / Math.max(target.protein, 1);
    const f = Math.abs(actual.fat - target.fat) / Math.max(target.fat, 1);
    const c = Math.abs(actual.carbs - target.carbs) / Math.max(target.carbs, 1);
    return Math.max(0, Math.round(100 - (p * 45 + f * 25 + c * 20)));
  });
  return Math.round(
    scores.reduce((sum, value) => sum + value, 0) / scores.length,
  );
}
function newPerson(index = 0): Person {
  const estimate = { ...defaultNutritionEstimate };
  const calculation = calculateNutritionTarget(estimate);
  return {
    id: `person-${Date.now()}-${index}`,
    name: index === 0 ? "Я" : `Человек ${index + 1}`,
    daily: "target" in calculation ? calculation.target : { ...defaultMacros },
    macroPreset: "custom",
    estimate,
    nutritionTargetMode: "auto",
    includedSlots: ["breakfast", "lunch", "dinner"],
    dislikes: [],
    hardExclusions: [],
  };
}
function macrosEqual(left: Macros, right: Macros) {
  return (Object.keys(left) as MacroKey[]).every((key) => left[key] === right[key]);
}
function normalizePerson(person: Person): Person {
  const calculation = person.estimate
    ? calculateNutritionTarget(estimateOf(person))
    : null;
  const calculatedTarget = calculation && "target" in calculation
    ? (calculation as NutritionCalculation).target
    : null;
  return {
    ...person,
    nutritionTargetMode: normalizeNutritionTargetMode(
      person.nutritionTargetMode,
      Boolean(person.estimate),
      Boolean(calculatedTarget && macrosEqual(person.daily, calculatedTarget)),
    ),
    dislikes: Array.isArray(person.dislikes) ? person.dislikes : [],
    hardExclusions: Array.isArray(person.hardExclusions)
      ? person.hardExclusions
      : [],
  };
}
function normalizePlan(plan: ActivePlan): ActivePlan {
  return {
    ...plan,
    pinnedSelectionKeys: Array.isArray(plan.pinnedSelectionKeys)
      ? plan.pinnedSelectionKeys.filter(
          (key): key is string => typeof key === "string" && Boolean(plan.selections[key]),
        )
      : [],
    people: plan.people.map(normalizePerson),
    shopping: plan.shopping.map((item) => ({
      ...item,
      allergens: [...(ingredientAllergens[item.id] ?? [])],
      checkLabel: packagedIngredientIds.has(item.id),
    })),
  };
}
function groupedShopping(items: ShoppingItem[]) {
  return items.reduce<Record<string, ShoppingItem[]>>((groups, item) => {
    (groups[item.group] ??= []).push(item);
    return groups;
  }, {});
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("week");
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);
  const [recipeContext, setRecipeContext] = useState<RecipeContext | null>(
    null,
  );
  const [builderEntry, setBuilderEntry] = useState<BuilderEntry>({ step: 0 });
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("done");
  const [onboardingReturnTab, setOnboardingReturnTab] = useState<Tab | null>(
    null,
  );
  /* Инструктаж, открытый из онбординга, возвращает на его первый экран,
     а не завершает онбординг. */
  const [guideOrigin, setGuideOrigin] = useState<"welcome" | null>(null);
  const [catalogState, setCatalogState] =
    useState<CatalogState>(emptyCatalogState);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notificationSetupOpen, setNotificationSetupOpen] = useState(false);
  const persistQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    void trackAnalytics("first_open", {}, "first-open");
    const onRemindersEnabled = () => {
      void trackAnalytics("reminders_enabled");
    };
    const onReminderEnableError = () => {
      void trackAnalytics("blocking_error", {
        errorCode: "reminder_enable",
      });
    };
    window.addEventListener("mise:reminders-enabled", onRemindersEnabled);
    window.addEventListener(
      "mise:reminder-enable-error",
      onReminderEnableError,
    );
    return () => {
      window.removeEventListener(
        "mise:reminders-enabled",
        onRemindersEnabled,
      );
      window.removeEventListener(
        "mise:reminder-enable-error",
        onReminderEnableError,
      );
    };
  }, []);
  /* eslint-disable react-hooks/set-state-in-effect -- bootstraps onboarding state and the stored plan on mount */
  useEffect(() => {
    let mounted = true;
    if (!localStorage.getItem(onboardingStorageKey))
      setOnboardingStep("welcome");
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const params = new URLSearchParams(location.search);
    if (params.get("tab") === "shopping") setTab("shopping");
    if (params.get("new-plan") === "1") {
      const flowId = crypto.randomUUID();
      setBuilderEntry({
        step: 0,
        repeat: true,
        mode: "onboarding",
        flowId,
        startedAt: Date.now(),
        isNextPlan: true,
      });
      setTab("builder");
      void trackAnalytics("plan_create_started", { flowId });
    }
    fetch("/api/plans", { headers: { "X-Mise-Client": clientId() } })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { plan?: ActivePlan | null }) => {
        if (mounted && data.plan) {
          setActivePlan(normalizePlan(data.plan));
          void trackAnalytics("saved_plan_reopened");
        }
      })
      .catch(() => {
        if (mounted) {
          setLoadError(true);
          void trackAnalytics("blocking_error", { errorCode: "plan_load" });
        }
      })
      .finally(() => {
        if (mounted) setLoadingPlan(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  async function persistPlan(plan: ActivePlan) {
    const run = async () => {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mise-Client": clientId(),
        },
        body: JSON.stringify({ plan }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить план");
    };
    persistQueue.current = persistQueue.current
      .catch(() => undefined)
      .then(run);
    await persistQueue.current;
    setActivePlan(plan);
  }
  function startPlanFlow(repeat: boolean) {
    const flowId = crypto.randomUUID();
    setRecipeContext(null);
    setBuilderEntry({
      step: 0,
      repeat,
      mode: "onboarding",
      flowId,
      startedAt: Date.now(),
      isNextPlan: Boolean(activePlan),
    });
    setTab("builder");
    void trackAnalytics("plan_create_started", { flowId });
  }
  function navigate(next: Tab) {
    setRecipeContext(null);
    if (next === "builder") {
      startPlanFlow(false);
      return;
    }
    setTab(next);
  }
  function repeatPlan() {
    startPlanFlow(true);
  }
  function editPeriod() {
    setRecipeContext(null);
    setBuilderEntry({ step: 0, returnTab: "week", mode: "settings" });
    setTab("builder");
  }
  function editDayMenu(batchId: string) {
    setRecipeContext(null);
    setBuilderEntry({
      step: 5,
      batchId,
      returnTab: "week",
      mode: "onboarding",
    });
    setTab("builder");
  }
  function editPeople() {
    setRecipeContext(null);
    setBuilderEntry({ step: 3, returnTab: "profile", mode: "settings" });
    setTab("builder");
  }
  function finishOnboarding(reminders?: ReminderDefaults) {
    localStorage.setItem(onboardingStorageKey, "complete");
    if (reminders)
      localStorage.setItem(reminderDefaultsKey, JSON.stringify(reminders));
    void trackAnalytics("onboarding_completed", {}, "onboarding-completed");
    setGuideOrigin(null);
    setOnboardingStep("done");
    const destination =
      onboardingReturnTab ?? (activePlan ? "week" : "builder");
    setOnboardingReturnTab(null);
    navigate(destination);
  }
  if (onboardingStep !== "done")
    return (
      <OnboardingScreen
        step={onboardingStep}
        plan={activePlan}
        hasPlan={Boolean(activePlan)}
        onGo={(next) => {
          if (next === "rules" && onboardingStep === "welcome")
            setGuideOrigin("welcome");
          setOnboardingStep(next);
        }}
        onFinish={finishOnboarding}
        onCloseGuide={() => {
          if (guideOrigin) {
            setGuideOrigin(null);
            setOnboardingStep("welcome");
            return;
          }
          finishOnboarding();
        }}
      />
    );
  if (recipeContext)
    return (
      <RecipeView
        context={recipeContext}
        onBack={() => setRecipeContext(null)}
        onChangePlan={
          recipeContext.plan
            ? async (plan) => {
                await persistPlan(plan);
                setRecipeContext((current) =>
                  current ? { ...current, plan } : current,
                );
              }
            : undefined
        }
      />
    );
  if (tab === "builder")
    return (
      <PlanBuilder
        initialPlan={activePlan}
        initialStep={builderEntry.step}
        initialBatchId={builderEntry.batchId}
        repeat={builderEntry.repeat}
        mode={builderEntry.mode ?? "onboarding"}
        flowId={builderEntry.flowId}
        startedAt={builderEntry.startedAt}
        isNextPlan={builderEntry.isNextPlan}
        onClose={() => navigate(builderEntry.returnTab ?? "week")}
        onSaved={(plan, destination) => {
          setActivePlan(plan);
          navigate(destination);
        }}
        persistPlan={persistPlan}
      />
    );
  const titles = {
    week: { kicker: "Mise · на этой неделе", title: "План на неделю" },
    recipes: { kicker: "Под ваши цели", title: "Рецепты" },
    shopping: {
      kicker: activePlan
        ? `${formatDate(activePlan.start)} — ${formatDate(activePlan.end)}`
        : "Список появится вместе с планом",
      title: "Покупки",
    },
    profile: { kicker: "Люди и цели", title: "Профиль" },
  };
  const currentTitle = titles[tab as Exclude<Tab, "builder">];
  return (
    <main className={`app-shell${tab === "recipes" ? " is-catalog" : ""}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="ambient ambient-three" />
      {tab !== "recipes" && (
      <header className="app-header">
        <div>
          <p className="kicker">{currentTitle.kicker}</p>
          <h1>{currentTitle.title}</h1>
        </div>
        <button
          className="avatar glass"
          onClick={() => navigate("profile")}
          aria-label="Открыть профиль"
        >
          М
        </button>
      </header>
      )}
      {tab === "week" && (
        <WeekScreen
          key={activePlan?.id ?? "empty"}
          plan={activePlan}
          loading={loadingPlan}
          loadError={loadError}
          onBuild={() => navigate("builder")}
          onRepeat={repeatPlan}
          onEditPeriod={editPeriod}
          onEditMenu={editDayMenu}
          onOpenRecipe={setRecipeContext}
          onOpenGuide={() => {
            setOnboardingReturnTab("week");
            setOnboardingStep("rules");
          }}
        />
      )}
      {tab === "recipes" && (
        <RecipesScreen
          plan={activePlan}
          state={catalogState}
          onState={setCatalogState}
          onOpenRecipe={(recipe) => setRecipeContext({ recipe })}
        />
      )}
      {tab === "shopping" && (
        <ShoppingScreen
          key={activePlan?.id ?? "empty"}
          plan={activePlan}
          onBuild={() => navigate("builder")}
          onChange={async (next) => {
            const previous = activePlan;
            setActivePlan(next);
            try {
              await persistPlan(next);
              return true;
            } catch {
              if (previous) setActivePlan(previous);
              return false;
            }
          }}
        />
      )}
      {tab === "profile" && (
        <ProfileScreen
          people={activePlan?.people ?? [newPerson()]}
          hasPlan={Boolean(activePlan)}
          onConfigure={editPeople}
          onOpenTutorial={() => {
            setOnboardingReturnTab("profile");
            setOnboardingStep("welcome");
          }}
          onOpenPrepGuide={() => {
            setOnboardingReturnTab("profile");
            setOnboardingStep("rules");
          }}
          onNotifications={() => setNotificationSetupOpen(true)}
        />
      )}
      {activePlan && notificationSetupOpen && (
        <Sheet
          titleId="notifications-title"
          onClose={() => setNotificationSetupOpen(false)}
          className="success-sheet glass notification-modal"
        >
          <NotificationSetupPanel
            plan={notificationPlanFor(activePlan)}
            clientId={clientId()}
            deviceId={deviceId()}
            onDone={() => setNotificationSetupOpen(false)}
            onCancel={() => setNotificationSetupOpen(false)}
          />
        </Sheet>
      )}
      <BottomNav tab={tab} onNavigate={navigate} />
    </main>
  );
}

/* Онбординг и инструктаж · SCREENS.md, макеты 7a / 8a / 8b / 8c / 8d.

   Онбординг — три экрана (обещание, партии, напоминания), свайп и точки.
   Инструктаж — два экрана (пять правил, чек-лист), не блокирует и открывается
   из «Профиля» и из карточки готовки.

   Числа на плитках 7a настоящие: если план уже есть, берём его дни и порции. */

const onboardingFlow = ["welcome", "batches", "reminders"] as const;

const promiseForms = {
  days: [
    "день меню за один вечер",
    "дня меню за один вечер",
    "дней меню за один вечер",
  ],
  portions: [
    "порция уже взвешена",
    "порции уже взвешены",
    "порций уже взвешено",
  ],
} as const;

const batchWeek: { day: string; cook?: boolean; second?: boolean; frost?: boolean }[] = [
  { day: "ср", cook: true },
  { day: "чт" },
  { day: "пт" },
  { day: "сб", cook: true, second: true },
  { day: "вс", second: true },
  { day: "пн", second: true },
  { day: "вт", second: true, frost: true },
];

const prepRules: { tone: string; title: string; text: string }[] = [
  {
    tone: "tone-accent",
    title: "Остудить за 2 часа",
    text: "Горячее в холодильник не ставим: разложите по контейнерам и дайте остыть до тёплого, потом крышка и полка.",
  },
  {
    tone: "tone-mint",
    title: "3–4 дня в холодильнике",
    text: "При ≤4 °C. Рыба и готовые салаты — меньше. Всё, что дальше по плану, сразу отправляем в морозилку.",
  },
  {
    tone: "tone-lilac",
    title: "Разморозка — в холодильнике",
    text: "Переложите порцию вечером накануне: 8–10 часов. Не на столе и не в горячей воде.",
  },
  {
    tone: "tone-amber",
    title: "Подписывать каждую крышку",
    text: "Имя, дата, приём пищи. Mise готовит подписи сам — остаётся переписать или наклеить.",
  },
  {
    tone: "tone-accent",
    title: "Разогревать до горячего",
    text: "2–3 минуты в микроволновке, перемешать в середине. Зелень и соусы добавляем после.",
  },
];

const kitchenChecklist: { title: string; note: string }[] = [
  { title: "Кухонные весы", note: "Нужны один раз — на готовке" },
  { title: "Два сотейника и противень", note: "Иначе партия растянется по времени" },
  { title: "Место в морозилке", note: "Хотя бы на четыре контейнера" },
  { title: "Маркер или наклейки", note: "Для подписей на крышках" },
];

function deckDishes(plan: ActivePlan | null) {
  const chosen = plan
    ? Object.values(plan.selections).map((id) => recipesById[id])
    : [];
  return (["breakfast", "lunch", "dinner"] as MealSlot[]).map((slot) => ({
    slot,
    recipe:
      chosen.find((recipe) => recipe?.slot === slot) ??
      productionRecipes.find((recipe) => recipe.slot === slot),
  }));
}

function DeckCard({
  slot,
  recipe,
  index,
  main = false,
}: {
  slot: MealSlot;
  recipe: Recipe | undefined;
  index: number;
  main?: boolean;
}) {
  if (!recipe) return null;
  const photo =
    recipe.provenance.kind === "parsed" ? recipe.provenance.imageUrl : undefined;
  return (
    <div
      className={`deck-card glass-2 ${main ? "deck-main" : index === 0 ? "deck-left" : "deck-right"}`}
    >
      <div className={`deck-thumb art-${index % 5}`}>
        {photo ? (
          // Фото рецепта — удалённый ассет источника, не сборочная картинка.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          recipe.emoji
        )}
        {main && (
          <span className="deck-kcal">{recipe.macros.kcal} ккал</span>
        )}
      </div>
      <div className="deck-slot">
        {mealMeta[slot].label}
        {main ? ` · ${recipe.servingWeight} г` : ""}
      </div>
      <div className="deck-title">{recipe.title}</div>
    </div>
  );
}

function OnboardingShell({
  guide = false,
  underBar = false,
  header,
  bar,
  onNext,
  onBack,
  children,
}: {
  guide?: boolean;
  underBar?: boolean;
  header?: ReactNode;
  bar: ReactNode;
  onNext?: () => void;
  onBack?: () => void;
  children: ReactNode;
}) {
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);
  return (
    <main
      className={`onboarding-shell${guide ? " is-guide" : ""}`}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        swipeFrom.current = touch
          ? { x: touch.clientX, y: touch.clientY }
          : null;
      }}
      onTouchEnd={(event) => {
        const from = swipeFrom.current;
        const touch = event.changedTouches[0];
        swipeFrom.current = null;
        if (!from || !touch) return;
        const dx = touch.clientX - from.x;
        const dy = touch.clientY - from.y;
        if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return;
        if (dx < 0) onNext?.();
        else onBack?.();
      }}
    >
      {header}
      <div className={`onboarding-scroll${underBar ? " under-bar" : ""}`}>
        {children}
      </div>
      {bar}
    </main>
  );
}

function OnboardingScreen({
  step,
  plan,
  hasPlan,
  onGo,
  onFinish,
  onCloseGuide,
}: {
  step: Exclude<OnboardingStep, "done">;
  plan: ActivePlan | null;
  hasPlan: boolean;
  onGo: (step: Exclude<OnboardingStep, "done">) => void;
  onFinish: (reminders?: ReminderDefaults) => void;
  onCloseGuide: () => void;
}) {
  if (step === "rules")
    return <PrepRulesScreen onClose={onCloseGuide} onNext={() => onGo("kitchen")} />;
  if (step === "kitchen")
    return (
      <PrepKitchenScreen
        plan={plan}
        hasPlan={hasPlan}
        onBack={() => onGo("rules")}
        onDone={onCloseGuide}
      />
    );
  if (step === "batches")
    return (
      <OnboardingBatches
        onBack={() => onGo("welcome")}
        onNext={() => onGo("reminders")}
        onSkip={() => onFinish()}
      />
    );
  if (step === "reminders")
    return (
      <OnboardingReminders
        onBack={() => onGo("batches")}
        onFinish={onFinish}
      />
    );
  return (
    <OnboardingWelcome
      plan={plan}
      hasPlan={hasPlan}
      onNext={() => onGo("batches")}
      onSkip={() => onFinish()}
      onOpenGuide={() => onGo("rules")}
    />
  );
}

function OnboardingWelcome({
  plan,
  hasPlan,
  onNext,
  onSkip,
  onOpenGuide,
}: {
  plan: ActivePlan | null;
  hasPlan: boolean;
  onNext: () => void;
  onSkip: () => void;
  onOpenGuide: () => void;
}) {
  const days = plan?.periodDays ?? 7;
  const portions = plan ? totalPlanPortions(plan) : 21;
  const deck = deckDishes(plan);
  return (
    <OnboardingShell
      onNext={onNext}
      bar={
        <ActionBar step={0} steps={onboardingFlow.length}>
          <button className="btn btn-primary action-primary" onClick={onNext}>
            <span>Начать — это 5 минут</span>
            <Icon name="chevron" size={16} />
          </button>
          <button className="btn action-link" onClick={onSkip}>
            {hasPlan ? "Вернуться к плану" : "Составить план сразу"}
          </button>
        </ActionBar>
      }
    >
      <div className="onboarding-top">
        <div className="onboarding-brand">
          <span className="mise-mark glass-3" aria-hidden>
            M
          </span>
          <span className="onboarding-wordmark">Mise</span>
        </div>
        <button className="pill-button" onClick={onOpenGuide}>
          Как это работает
        </button>
      </div>
      <h1 className="onboarding-title">
        Готовим раз —<br />
        едим всю неделю
      </h1>
      <p className="onboarding-lead">
        Вы отвечаете на шесть вопросов. Дальше считает Mise: меню, покупки,
        порции и подписи на контейнеры.
      </p>
      <div className="dish-deck" aria-hidden>
        <DeckCard slot={deck[0].slot} recipe={deck[0].recipe} index={0} />
        <DeckCard slot={deck[2].slot} recipe={deck[2].recipe} index={1} />
        <DeckCard slot={deck[1].slot} recipe={deck[1].recipe} index={2} main />
      </div>
      <div className="promise-grid">
        <div className="promise-tile tone-accent">
          <div className="promise-number">{days}</div>
          <div className="promise-text">{plural(days, promiseForms.days)}</div>
        </div>
        <div className="promise-tile tone-mint">
          <div className="promise-number">{portions}</div>
          <div className="promise-text">
            {plural(portions, promiseForms.portions)}
          </div>
        </div>
        <div className="promise-tile tone-amber">
          <div className="promise-number">1</div>
          <div className="promise-text">список покупок на всех</div>
        </div>
        <div className="promise-tile tone-lilac">
          <div className="promise-number">0</div>
          <div className="promise-text">расчётов в голове</div>
        </div>
      </div>
      <Note tone="mint" icon={<Icon name="snowflake" />}>
        Если порция не доживёт до своего дня — Mise предложит заморозить её
        заранее.
      </Note>
      <p className="onboarding-fineprint">
        КБЖУ и сроки хранения — ориентиры, а не медицинская гарантия.
      </p>
    </OnboardingShell>
  );
}

function OnboardingBatches({
  onBack,
  onNext,
  onSkip,
}: {
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <OnboardingShell
      onNext={onNext}
      onBack={onBack}
      bar={
        <ActionBar step={1} steps={onboardingFlow.length}>
          <button className="btn btn-primary action-primary" onClick={onNext}>
            <span>Дальше</span>
            <Icon name="chevron" size={16} />
          </button>
        </ActionBar>
      }
    >
      <div className="onboarding-top">
        <button className="text-link" onClick={onBack}>
          Назад
        </button>
        <button className="text-link" onClick={onSkip}>
          Пропустить
        </button>
      </div>
      <h1 className="onboarding-title">
        Готовка партиями —<br />
        это два вечера
      </h1>
      <p className="onboarding-lead">
        Mise делит неделю на партии по 3–4 дня: столько порций спокойно живёт в
        холодильнике. Всё, что не доживает, уходит в морозилку.
      </p>
      <section className="onboarding-card glass-card">
        <div className="card-head">
          <span>Неделя на {withPlural(2, FORMS.person)}</span>
          <span>{withPlural(2, FORMS.batch)}</span>
        </div>
        <div
          className="batch-bars"
          role="img"
          aria-label="Пример недели: две готовки, между ними дни, когда едим из готовой партии; последнюю порцию достаём из морозилки"
        >
          {batchWeek.map((day) => (
            <div
              key={day.day}
              className={`batch-day${day.cook ? " is-cook" : ""}${day.second ? " is-second" : ""}`}
            >
              <span>
                {day.frost && (
                  <i className="frost">
                    <Icon name="snowflake" size={12} />
                  </i>
                )}
              </span>
              <small>{day.day}</small>
            </div>
          ))}
        </div>
        <div className="batch-legend">
          <span>
            <i />
            день готовки
          </span>
          <span>
            <i />
            едим из партии
          </span>
          <span>
            <i />
            вторая партия
          </span>
        </div>
      </section>
      <div className="onb-rows">
        <div className="onb-row glass-3">
          <span className="onb-num">1</span>
          <div>
            <b>~90 минут на партию</b>
            <small>Из них активных — около 40, остальное варится само.</small>
          </div>
        </div>
        <div className="onb-row glass-3">
          <span className="onb-num is-mint">2</span>
          <div>
            <b>3–4 блюда на всех</b>
            <small>Порции разные, готовка общая — считает Mise, не вы.</small>
          </div>
        </div>
        <div className="onb-row glass-3">
          <span className="onb-num is-lilac">3</span>
          <div>
            <b>Подписал — забыл</b>
            <small>
              Имя, дата и приём пищи на крышке: утром ничего не решаете.
            </small>
          </div>
        </div>
      </div>
    </OnboardingShell>
  );
}

function OnboardingReminders({
  onBack,
  onFinish,
}: {
  onBack: () => void;
  onFinish: (reminders?: ReminderDefaults) => void;
}) {
  const [wanted, setWanted] = useState<ReminderDefaults>({
    cooking: true,
    thaw: true,
    "next-plan": true,
  });
  const rows: { kind: keyof ReminderDefaults; title: string; note: string }[] = [
    {
      kind: "cooking",
      title: "День готовки",
      note: "В день партии, во сколько скажете",
    },
    {
      kind: "thaw",
      title: "Разморозка накануне",
      note: "Вечером накануне, в 21:00",
    },
    {
      kind: "next-plan",
      title: "Пора собрать новый план",
      note: "За два дня до конца плана",
    },
  ];
  return (
    <OnboardingShell
      onBack={onBack}
      bar={
        <ActionBar step={2} steps={onboardingFlow.length}>
          <button
            className="btn btn-primary action-primary"
            onClick={() => onFinish(wanted)}
          >
            <span>Начать</span>
            <Icon name="chevron" size={16} />
          </button>
          <button
            className="btn action-link"
            onClick={() =>
              onFinish({ cooking: false, thaw: false, "next-plan": false })
            }
          >
            Без напоминаний
          </button>
        </ActionBar>
      }
    >
      <div className="onboarding-top">
        <button className="text-link" onClick={onBack}>
          Назад
        </button>
        <button className="text-link" onClick={() => onFinish()}>
          Пропустить
        </button>
      </div>
      <h1 className="onboarding-title">
        Два напоминания,<br />и план не развалится
      </h1>
      <p className="onboarding-lead">
        Милпреп ломается в двух местах: забыли начать готовку и забыли
        переложить порцию из морозилки. Об этом Mise и напомнит.
      </p>
      <section className="onboarding-card glass-card">
        <div className="push-preview">
          <div className="push-card glass-3">
            <span className="onb-num" aria-hidden>
              M
            </span>
            <div>
              <div className="push-head">
                <b>Mise</b>
                <span>сб, 10:00</span>
              </div>
              <p className="push-text">
                Партия 2: 4 блюда, 12 порций. Начнём — активных 40 минут.
              </p>
            </div>
          </div>
          <div className="push-card glass-3 is-mint">
            <span className="onb-num is-mint" aria-hidden>
              <Icon name="snowflake" size={16} />
            </span>
            <div>
              <div className="push-head">
                <b>Mise</b>
                <span>пт, 21:00</span>
              </div>
              <p className="push-text">
                Переложите 2 порции тефтелей в холодильник — на ужин завтра.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="toggle-list glass-2">
        {rows.map((row) => (
          <button
            key={row.kind}
            className="toggle-row"
            role="switch"
            aria-checked={wanted[row.kind]}
            onClick={() =>
              setWanted((current) => ({
                ...current,
                [row.kind]: !current[row.kind],
              }))
            }
          >
            <span>
              <b>{row.title}</b>
              <small>{row.note}</small>
            </span>
            <span className="toggle" aria-hidden />
          </button>
        ))}
      </section>
      <p className="onboarding-fineprint">
        Разрешение на уведомления Mise запросит вместе с готовым планом — здесь
        только выбираем, какие из них нужны. Всё можно поменять в профиле.
      </p>
    </OnboardingShell>
  );
}

function PrepRulesScreen({
  onClose,
  onNext,
}: {
  onClose: () => void;
  onNext: () => void;
}) {
  return (
    <OnboardingShell
      guide
      underBar
      onNext={onNext}
      header={
        <div className="guide-bar glass-1">
          <button className="text-link" onClick={onClose}>
            Закрыть
          </button>
          <div className="guide-bar-title">
            <b>Инструктаж</b>
            <small>5 правил · 2 минуты</small>
          </div>
          <button className="text-link" onClick={onNext}>
            Дальше
          </button>
        </div>
      }
      bar={
        <ActionBar>
          <button className="btn btn-primary action-primary" onClick={onNext}>
            <span>Что нужно на кухне</span>
            <Icon name="chevron" size={16} />
          </button>
        </ActionBar>
      }
    >
      <h1 className="onboarding-title">
        Пять правил,<br />
        которые решают всё
      </h1>
      <p className="onboarding-lead">
        Дальше Mise будет напоминать про них сам — но лучше знать заранее.
      </p>
      <div className="rule-list">
        {prepRules.map((rule, index) => (
          <article className={`rule-card ${rule.tone}`} key={rule.title}>
            <div className="rule-head">
              <span className="rule-num">{index + 1}</span>
              <h2>{rule.title}</h2>
            </div>
            <p>{rule.text}</p>
          </article>
        ))}
      </div>
      <p className="onboarding-fineprint">
        Сроки и температуры — ориентиры для домашней кухни, а не лабораторная
        норма.
      </p>
    </OnboardingShell>
  );
}

function PrepKitchenScreen({
  plan,
  hasPlan,
  onBack,
  onDone,
}: {
  plan: ActivePlan | null;
  hasPlan: boolean;
  onBack: () => void;
  onDone: () => void;
}) {
  const [ready, setReady] = useState<string[]>([]);
  const portions = plan ? totalPlanPortions(plan) : 0;
  return (
    <OnboardingShell
      guide
      onBack={onBack}
      bar={
        <ActionBar>
          <button className="btn btn-primary action-primary" onClick={onDone}>
            <span>{hasPlan ? "Готово — к плану" : "Готово — составить план"}</span>
            <Icon name="chevron" size={16} />
          </button>
        </ActionBar>
      }
    >
      <div className="onboarding-top">
        <button className="text-link" onClick={onBack}>
          Назад
        </button>
        <span className="pill-button">Шаг 2 из 2</span>
      </div>
      <h1 className="onboarding-title">
        Перед первой<br />
        готовкой
      </h1>
      <p className="onboarding-lead">
        Ничего специального не нужно. Проверьте, что есть под рукой — Mise
        учтёт это в плане.
      </p>
      <section className="onboarding-card glass-card">
        <div className="card-head">
          <span>Контейнеры</span>
          <span>{portions ? `нужно ${portions}` : "по числу порций"}</span>
        </div>
        {portions > 0 && (
          <div className="kit-grid" aria-hidden>
            {Array.from({ length: Math.min(portions, 24) }, (_, index) => (
              <i key={index} />
            ))}
          </div>
        )}
        <p className="kit-note">
          {portions
            ? `По одному контейнеру на порцию: в этом плане ${withPlural(portions, FORMS.portion)}. Чего не хватит — уйдёт в морозилку в общей упаковке.`
            : "По одному контейнеру на порцию. Точное число Mise посчитает вместе с планом."}
        </p>
      </section>
      <section className="kit-list glass-2">
        {kitchenChecklist.map((item) => {
          const checked = ready.includes(item.title);
          return (
            <button
              key={item.title}
              className="kit-row"
              role="checkbox"
              aria-checked={checked}
              onClick={() =>
                setReady((current) =>
                  checked
                    ? current.filter((title) => title !== item.title)
                    : [...current, item.title],
                )
              }
            >
              <span className="check-box">
                <Icon name="check" size={14} />
              </span>
              <span>
                <b>{item.title}</b>
                <small>{item.note}</small>
              </span>
              <span className="kit-state">{checked ? "есть" : "отметить"}</span>
            </button>
          );
        })}
      </section>
      <Note tone="mint" icon={<Icon name="info" />}>
        Инструктаж всегда под рукой: в профиле, «Инструкция по милпрепу».
      </Note>
    </OnboardingShell>
  );
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function InstallInline() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(true);
  const [showSteps, setShowSteps] = useState(false);
  const isIos =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- display-mode can only be read on the client
    setInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    );
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  async function install() {
    if (!prompt) {
      setShowSteps(true);
      return;
    }
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }
  if (installed) return null;
  return (
    <section className="install-inline glass-card">
      <div className="install-inline-copy">
        <b>Добавить Mise на экран Домой</b>
        <small>
          Открывается как приложение и может присылать напоминания о покупках,
          готовке и разморозке.
        </small>
        {showSteps && (
          <p>
            {isIos
              ? "В Safari: «Поделиться» → «На экран Домой» → «Добавить»."
              : "В меню браузера выберите «Установить приложение» или «На главный экран»."}
          </p>
        )}
      </div>
      <button className="secondary-button" onClick={install}>
        {prompt ? "Добавить" : "Как добавить"}
      </button>
    </section>
  );
}

function BottomNav({
  tab,
  onNavigate,
}: {
  tab: Tab;
  onNavigate: (tab: Tab) => void;
}) {
  const items: {
    id: Exclude<Tab, "builder">;
    label: string;
    full: string;
    icon: IconName;
  }[] = [
    { id: "week", label: "Неделя", full: "План на неделю", icon: "calendar" },
    { id: "recipes", label: "Рецепты", full: "Рецепты", icon: "pot" },
    { id: "shopping", label: "Покупки", full: "Покупки", icon: "basket" },
    { id: "profile", label: "Профиль", full: "Профиль", icon: "person" },
  ];
  return (
    <>
      <button
        className="compose-fab"
        onClick={() => onNavigate("builder")}
        aria-label="Составить план"
      >
        <Icon name="plus" />
        <small>Составить</small>
      </button>
      <nav className="bottom-nav glass" aria-label="Основная навигация">
        {items.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "is-active" : ""}
            aria-label={item.full}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} />
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
    </>
  );
}

function EmptyState({
  onBuild,
  title,
  text,
}: {
  onBuild: () => void;
  title: string;
  text: string;
}) {
  return (
    <section className="empty-state glass-card">
      <div className="empty-orbit" aria-hidden />
      <p className="kicker">Персональный милпреп</p>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="primary-button" onClick={onBuild}>
        Составить план <Icon name="chevron" size={16} />
      </button>
    </section>
  );
}

function DailyBalance({
  goal,
  planned,
  context = "После блюд из Mise",
}: {
  goal: Macros;
  planned: Macros;
  context?: string;
}) {
  const plannedKcal = Math.min(
    Math.max(0, round(planned.kcal)),
    Math.max(0, round(goal.kcal)),
  );
  const remainingKcal = Math.max(0, goal.kcal - plannedKcal);
  const chocolate = round(
    remainingKcal / NUTRITION_CONFIG.kcalPer100gChocolate,
    1,
  );
  return (
    <Note
      tone="mint"
      role="status"
      label={`План MISE: ${plannedKcal.toLocaleString("ru-RU")} ккал`}
    >
      {context}.{" "}
      {remainingKcal > 0
        ? `Ещё можно съесть: ${remainingKcal.toLocaleString("ru-RU")} ккал — примерно ${chocolate.toLocaleString("ru-RU")} плитки шоколада, просто понятный ориентир.`
        : "Дневной бюджет распределён между выбранными позициями."}
    </Note>
  );
}

function WeekScreen({
  plan,
  loading,
  loadError,
  onBuild,
  onRepeat,
  onEditPeriod,
  onEditMenu,
  onOpenRecipe,
  onOpenGuide,
}: {
  plan: ActivePlan | null;
  loading: boolean;
  loadError: boolean;
  onBuild: () => void;
  onRepeat: () => void;
  onEditPeriod: () => void;
  onEditMenu: (batchId: string) => void;
  onOpenRecipe: (context: RecipeContext) => void;
  onOpenGuide: () => void;
}) {
  const today = isoDate(new Date());
  const [selectedDate, setSelectedDate] = useState(
    plan ? clampDate(today, plan.start, plan.end) : today,
  );
  const [personId, setPersonId] = useState(plan?.people[0]?.id ?? "");
  const [confirmedBatchIds, setConfirmedBatchIds] = useState<string[]>(() =>
    typeof window === "undefined" || !plan
      ? []
      : plan.batches
          .filter((item) =>
            analyticsWasSent(`cooking-confirmed:${plan.id}:${item.id}`),
          )
          .map((item) => item.id),
  );
  const [cookingConfirmError, setCookingConfirmError] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>("[data-selected='true']")
      ?.scrollIntoView({
        inline: "center",
        block: "nearest",
        behavior: "smooth",
      });
  }, [selectedDate]);
  if (loading)
    return (
      <section className="loading-card glass-card">
        <span className="spinner" />
        <p>Ищем сохранённый план…</p>
      </section>
    );
  if (loadError)
    return (
      <section className="empty-state glass-card" role="alert">
        <div className="empty-orbit">
          <Icon name="repeat" />
        </div>
        <p className="kicker">Данные на месте</p>
        <h2>План пока не загрузился</h2>
        <p>
          Похоже, соединение прервалось. Повторите загрузку — мы не будем
          показывать пустую неделю вместо ошибки.
        </p>
        <button className="primary-button" onClick={() => location.reload()}>
          Повторить <Icon name="chevron" size={16} />
        </button>
      </section>
    );
  if (!plan)
    return (
      <EmptyState
        onBuild={onBuild}
        title="Неделя пока свободна"
        text="Ответьте на несколько вопросов — мы рассчитаем порции, подберём рецепты и соберём покупки."
      />
    );
  const activePlan = plan;
  const dates = Array.from({ length: plan.periodDays }, (_, index) =>
    addDays(plan.start, index),
  );
  const batchFor = (date: string) =>
    activePlan.batches.find((item) => date >= item.start && date <= item.end) ??
    activePlan.batches[0];
  const batch = batchFor(selectedDate);
  const dayIndex = daysInclusive(batch.start, selectedDate) - 1;
  const person =
    plan.people.find((item) => item.id === personId) ?? plan.people[0];
  const dayMeals = plan.mealSlots.flatMap((slot) => {
    const recipe = recipesById[plan.selections[selectionKey(batch, slot)]];
    return recipe ? [{ slot, recipe }] : [];
  });
  const contactWarnings = crossContactWarnings(plan, batch);
  const plannedMacros = addMacros(
    dayMeals
      .filter(({ slot }) => person?.includedSlots.includes(slot))
      .map(
        ({ slot, recipe }) =>
          portionFor(
            person,
            slot,
            recipe,
            plan.tuning?.[tuningKey(batch, slot, person)],
          ).actual,
      ),
  );
  const planEnded = today > plan.end;
  const notStarted = today < plan.start;
  const todayBatch = planEnded || notStarted ? null : batchFor(today);
  const cookToday = Boolean(todayBatch && todayBatch.start === today);
  const nextCook = plan.batches.find((item) => item.start > today);
  const daysToNextCook = nextCook
    ? daysInclusive(today, nextCook.start) - 1
    : 0;
  const tomorrow = addDays(today, 1);
  const thawTitles =
    planEnded || tomorrow > plan.end || tomorrow < plan.start
      ? []
      : (() => {
          const nextBatch = batchFor(tomorrow);
          const index = daysInclusive(nextBatch.start, tomorrow) - 1;
          return plan.mealSlots.flatMap((slot) => {
            const recipe =
              recipesById[activePlan.selections[selectionKey(nextBatch, slot)]];
            return recipe && recipe.freezable && index + 1 > recipe.storageDays
              ? [recipe.title]
              : [];
          });
        })();
  const todayMealCount =
    planEnded || notStarted
      ? 0
      : plan.mealSlots.filter(
          (slot) =>
            recipesById[
              activePlan.selections[selectionKey(batchFor(today), slot)]
            ],
        ).length;
  async function confirmBatch() {
    if (confirmedBatchIds.includes(batch.id)) return;
    setCookingConfirmError(false);
    const dedupeKey = `cooking-confirmed:${activePlan.id}:${batch.id}`;
    if (await trackAnalytics("cooking_confirmed", {}, dedupeKey)) {
      setConfirmedBatchIds((current) => [...current, batch.id]);
    } else setCookingConfirmError(true);
  }
  return (
    <section className="screen week-screen">
      {planEnded ? (
        <section className="today-card glass-card ended" role="status">
          <p className="kicker">План завершён</p>
          <h2>
            {formatDate(plan.start)} — {formatDate(plan.end)}
          </h2>
          <p>
            Период закончился. Соберите следующий, пока не пришлось снова всё
            пересчитывать.
          </p>
          <div className="today-actions">
            <button className="primary-button" onClick={onRepeat}>
              Повторить план <Icon name="chevron" size={16} />
            </button>
            <button className="secondary-button" onClick={onBuild}>
              Составить новый
            </button>
          </div>
        </section>
      ) : (
        <section className="today-card glass-card" role="status">
          <p className="kicker">
            {notStarted
              ? `План начнётся ${formatDate(plan.start)}`
              : cookToday
                ? "Сегодня — день готовки"
                : "Сегодня"}
          </p>
          <h2>
            {notStarted
              ? "Пока ничего доставать не нужно"
              : cookToday
                ? `Готовим партию ${todayBatch!.index + 1} на ${todayBatch!.days} дн.`
                : `${todayMealCount} ${todayMealCount === 1 ? "контейнер" : todayMealCount < 5 ? "контейнера" : "контейнеров"} из холодильника`}
          </h2>
          <button
            className="period-summary-button"
            onClick={onEditPeriod}
            aria-label={`Изменить период ${formatDate(plan.start)} — ${formatDate(plan.end)}`}
          >
            <span>
              {formatDate(plan.start)} — {formatDate(plan.end)}
            </span>
            <Icon name="chevron" className="soft-chevron" />
          </button>
          <p>
            {nextCook
              ? `Следующая готовка ${formatDate(nextCook.start)} — через ${daysToNextCook} ${daysToNextCook === 1 ? "день" : daysToNextCook < 5 ? "дня" : "дней"}.`
              : "Это последняя партия периода."}
          </p>
          {thawTitles.length > 0 && (
            <p className="today-thaw">
              Вечером переложите в холодильник: {thawTitles.join(", ")}.
            </p>
          )}
          {selectedDate !== clampDate(today, plan.start, plan.end) && (
            <button
              className="text-button"
              onClick={() =>
                setSelectedDate(
                  clampDate(today, activePlan.start, activePlan.end),
                )
              }
            >
              Показать сегодняшний день
            </button>
          )}
        </section>
      )}
      <div
        className="date-strip"
        ref={stripRef}
        role="tablist"
        aria-label="Дни плана"
      >
        {dates.map((date) => {
          const dateBatch = batchFor(date);
          const isFirstOfBatch =
            dateBatch.start === date && dateBatch.index > 0;
          return (
            <button
              key={date}
              role="tab"
              data-selected={date === selectedDate}
              aria-selected={date === selectedDate}
              className={`${date === selectedDate ? "selected" : ""} ${date === today ? "is-today" : ""} ${isFirstOfBatch ? "batch-start" : ""}`}
              onClick={() => setSelectedDate(date)}
              aria-label={`${formatDate(date, true)}${date === today ? ", сегодня" : ""}${dateBatch.start === date ? `, начало готовки ${dateBatch.index + 1}` : ""}`}
            >
              <small>
                {new Intl.DateTimeFormat("ru-RU", { weekday: "short" })
                  .format(parseDate(date))
                  .replace(".", "")}
              </small>
              <b>{parseDate(date).getDate()}</b>
              {date === today && <i className="today-dot" aria-hidden />}
            </button>
          );
        })}
      </div>
      <section className="glass-card">
        <div className="macro-top">
          <div>
            <p className="kicker">Блюда из Mise на этот день</p>
            <h2>{person.name}</h2>
          </div>
          <select
            value={person.id}
            onChange={(event) => setPersonId(event.target.value)}
            aria-label="Выбрать человека"
          >
            {plan.people.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="macro-grid">
          {(["kcal", "protein", "fat", "carbs"] as MacroKey[]).map((key) => (
            <div key={key}>
              <span>{macroLabels[key]}</span>
              <b>{plannedMacros[key]}</b>
              <small>{key === "kcal" ? "ккал" : "г"}</small>
            </div>
          ))}
        </div>
        <DailyBalance
          goal={person.daily}
          planned={plannedMacros}
          context="В выбранных блюдах"
        />
      </section>
      <button
        className="prep-callout glass-card"
        onClick={() => setSelectedDate(batch.start)}
        aria-label={`Открыть день готовки ${batch.index + 1}`}
      >
        <Icon name="pot" className="prep-icon" />
        <div>
          <p className="kicker">Готовка {batch.index + 1}</p>
          <h3>
            {formatDate(batch.start)} — {formatDate(batch.end)}
          </h3>
          <p>
            {withPlural(batch.days, FORMS.day)} ·{" "}
            {withPlural(dayMeals.length, FORMS.dish)}
          </p>
        </div>
        <Icon name="chevron" className="soft-chevron" />
      </button>
      {contactWarnings.length > 0 && (
        <section className="allergy-warning glass-card" role="alert">
          <span>!</span>
          <div>
            <h3>Риск перекрёстного контакта</h3>
            <p>
              В этой общей готовке есть: {contactWarnings
                .map(
                  ({ person: eater, allergen }) =>
                    `${allergenMeta[allergen].short.toLowerCase()} — нельзя ${eater.name}`,
                )
                .join("; ")}. Разделите инвентарь, поверхности и порядок
              готовки.
            </p>
          </div>
        </section>
      )}
      <button
        className={`cooking-confirm-button glass-card ${confirmedBatchIds.includes(batch.id) ? "confirmed" : ""}`}
        disabled={confirmedBatchIds.includes(batch.id)}
        onClick={() => void confirmBatch()}
      >
        <span>
          {confirmedBatchIds.includes(batch.id) ? (
            <Icon name="check" />
          ) : (
            <Icon name="pot" />
          )}
        </span>
        <div>
          <b>
            {confirmedBatchIds.includes(batch.id)
              ? "Партия отмечена приготовленной"
              : "Отметить, что партия приготовлена"}
          </b>
          <small>
            Только это подтверждение засчитывается как реальная готовка
          </small>
        </div>
      </button>
      {cookingConfirmError && (
        <Note tone="warn" role="alert">
          Не удалось сохранить отметку о готовке. Проверьте соединение и
          попробуйте ещё раз.
        </Note>
      )}
      <button className="tutorial-entry glass-card" onClick={onOpenGuide}>
        <span>
          <Icon name="label" />
        </span>
        <div>
          <b>Как готовить партиями</b>
          <small>Пять правил и чек-лист перед готовкой</small>
        </div>
        <Icon name="chevron" className="entry-chevron" />
      </button>
      <div className="section-heading">
        <div>
          <p className="kicker">
            {formatDate(selectedDate, true)} · день {dayIndex + 1} из{" "}
            {batch.days}
          </p>
          <h2>Меню дня</h2>
        </div>
        <button
          className="text-button"
          aria-label={`Изменить меню на ${formatDate(selectedDate, true)}`}
          onClick={() => onEditMenu(batch.id)}
        >
          Изменить
        </button>
      </div>
      <div className="day-meals">
        {dayMeals.map(({ slot, recipe }, index) => {
          const portion = person?.includedSlots.includes(slot)
            ? portionFor(
                person,
                slot,
                recipe,
                plan.tuning?.[tuningKey(batch, slot, person)],
              )
            : null;
          const left = batch.days - dayIndex;
          const prepStatus =
            dayIndex === 0
              ? selectedDate === today
                ? "Готовить сегодня"
                : "День готовки"
              : `Разогреть · осталось ${left} ${left === 1 ? "контейнер" : left < 5 ? "контейнера" : "контейнеров"}`;
          return (
            <button
              className="week-meal glass-card"
              key={`${slot}-${recipe.id}`}
              onClick={() => onOpenRecipe({ recipe, batch, slot, plan })}
            >
              <div className={`food-art art-${index % 5}`}>
                <span>{recipe.emoji}</span>
                <small>{mealMeta[slot].label}</small>
              </div>
              <div className="week-meal-copy">
                <p className="kicker">{prepStatus}</p>
                <h3>{recipe.title}</h3>
                {portion ? (
                  <p>
                    {portion.actual.kcal} ккал · {portion.actual.protein} Б ·
                    около {portion.grams} г
                  </p>
                ) : (
                  <p>Не входит в меню {person.name}</p>
                )}
              </div>
              <Icon name="chevron" className="soft-chevron" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* Каталог «Рецепты» — макет 9a.

   Девять безымянных полос фильтров заменены одной кнопкой со счётчиком: активные
   фильтры видно, и снимаются они там же, где надеваются. Сортировка по умолчанию —
   «сначала те, где меньше докупать», потому что это и есть вопрос пользователя.

   Числа считает клиент из уже существующих функций (buildShopping и каталог):
   своего API рецептов у проекта нет. Формы данных — как в BACKEND.md §1,
   чтобы переезд на сервер был заменой источника, а не переписыванием экрана. */

type CatalogSort = "missing" | "time" | "protein";
type CatalogProperty = "freezable" | "no-cook" | "protein";
type CatalogState = {
  q: string;
  slot: MealSlot | null;
  effort: "low" | "high" | null;
  time: "quick" | "medium" | "long" | null;
  properties: CatalogProperty[];
  sort: CatalogSort;
};

const emptyCatalogState: CatalogState = {
  q: "",
  slot: null,
  effort: null,
  time: null,
  properties: [],
  sort: "missing",
};

const catalogPropertyLabels: Record<CatalogProperty, string> = {
  freezable: "Морозится",
  "no-cook": "Без готовки",
  protein: "Много белка",
};

const catalogTimeLabels: Record<"quick" | "medium" | "long", string> = {
  quick: "До 20 мин",
  medium: "21–40 мин",
  long: "41+ мин",
};

const catalogEffortLabels: Record<"low" | "high", string> = {
  low: "Мало действий",
  high: "Много действий",
};

const catalogSortLabels: Record<CatalogSort, string> = {
  missing: "Сначала те, где меньше докупать",
  time: "Сначала быстрые",
  protein: "Сначала белковые",
};

function hasProperty(recipe: Recipe, property: CatalogProperty) {
  if (property === "freezable") return recipe.freezable;
  if (property === "no-cook") return recipe.time <= 10;
  return recipe.macros.protein >= 30;
}

/* «Докупить N»: сколько продуктов рецепта ещё нет в списке покупок активного
   плана. Без плана числа не существует — бейдж тогда не рисуется вовсе. */
function missingCountFor(recipe: Recipe, plan: ActivePlan | null) {
  if (!plan) return null;
  const bought = new Set(plan.shopping.map((item) => item.id));
  return recipe.ingredients.filter(
    (ingredient) => !bought.has(ingredient.id),
  ).length;
}

/* В какой партии плана это блюдо уже готовится. */
function batchNumberFor(recipe: Recipe, plan: ActivePlan | null) {
  if (!plan) return null;
  for (const batch of plan.batches)
    for (const slot of Object.keys(mealMeta) as MealSlot[])
      if (plan.selections[selectionKey(batch, slot)] === recipe.id)
        return batch.index + 1;
  return null;
}

/* Второй чип карточки — одно свойство, по фиксированному приоритету. */
function propertyChipFor(recipe: Recipe, plan: ActivePlan | null) {
  if (recipe.time <= 10) return "без готовки";
  if (recipe.freezable) return "морозится";
  if (plan && plan.people.every((person) => !hardConflicts(recipe, person).length))
    return "на всех";
  return withPlural(recipe.storageDays, FORMS.day);
}

function catalogMatches(recipe: Recipe, state: CatalogState) {
  const query = state.q.trim().toLowerCase();
  const exclude = query.startsWith("без ") ? query.slice(4).trim() : "";
  const names = recipe.ingredients.map((ingredient) =>
    ingredient.name.toLowerCase(),
  );
  if (exclude && names.some((name) => name.includes(exclude))) return false;
  if (query && !exclude) {
    const hit =
      recipe.title.toLowerCase().includes(query) ||
      names.some((name) => name.includes(query));
    if (!hit) return false;
  }
  if (state.slot && recipe.slot !== state.slot) return false;
  if (state.effort && recipe.effort.level !== state.effort) return false;
  if (state.time && timeBand(recipe) !== state.time) return false;
  return state.properties.every((property) => hasProperty(recipe, property));
}

type ActiveCatalogFilter = { id: string; label: string; clear: () => CatalogState };

function activeCatalogFilters(state: CatalogState): ActiveCatalogFilter[] {
  const active: ActiveCatalogFilter[] = [];
  if (state.q.trim())
    active.push({
      id: "q",
      label: state.q.trim(),
      clear: () => ({ ...state, q: "" }),
    });
  if (state.slot)
    active.push({
      id: "slot",
      label: mealMeta[state.slot].label,
      clear: () => ({ ...state, slot: null }),
    });
  if (state.time)
    active.push({
      id: "time",
      label: catalogTimeLabels[state.time],
      clear: () => ({ ...state, time: null }),
    });
  if (state.effort)
    active.push({
      id: "effort",
      label: catalogEffortLabels[state.effort],
      clear: () => ({ ...state, effort: null }),
    });
  for (const property of state.properties)
    active.push({
      id: property,
      label: catalogPropertyLabels[property],
      clear: () => ({
        ...state,
        properties: state.properties.filter((item) => item !== property),
      }),
    });
  return active;
}

function RecipesScreen({
  plan,
  state,
  onState,
  onOpenRecipe,
}: {
  plan: ActivePlan | null;
  state: CatalogState;
  onState: (next: CatalogState) => void;
  onOpenRecipe: (recipe: Recipe) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* Шапка фиксированная, и её высота зависит от длины чисел и от того, сколько
     чипов активно. Считать её руками — тот самый способ уронить первую строку
     под блюр, поэтому отступ скролла ведёт ResizeObserver. */
  useEffect(() => {
    const header = headerRef.current;
    const scroll = scrollRef.current;
    if (!header || !scroll) return;
    const observer = new ResizeObserver(([entry]) => {
      /* Именно border-box: у шапки большой собственный padding, и contentRect
         из сниппета хэндофа занижает высоту на него — контент уезжает под блюр. */
      const height =
        entry.borderBoxSize?.[0]?.blockSize ??
        entry.target.getBoundingClientRect().height;
      scroll.style.paddingTop = `${height + 8}px`;
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const active = activeCatalogFilters(state);
  const visible = useMemo(() => {
    const matched = productionRecipes.filter((recipe) =>
      catalogMatches(recipe, state),
    );
    const missing = new Map(
      matched.map((recipe) => [recipe.id, missingCountFor(recipe, plan) ?? 0]),
    );
    return [...matched].sort((a, b) => {
      if (state.sort === "time") return a.time - b.time;
      if (state.sort === "protein") return b.macros.protein - a.macros.protein;
      const diff = (missing.get(a.id) ?? 0) - (missing.get(b.id) ?? 0);
      return diff || a.time - b.time;
    });
  }, [plan, state]);

  const fromYourProducts = plan
    ? productionRecipes.filter(
        (recipe) => missingCountFor(recipe, plan) === 0,
      ).length
    : null;

  return (
    <section className="screen catalog-screen">
      <header className="catalog-header glass-1" ref={headerRef}>
        <div className="catalog-head-row">
          <div>
            <p className="catalog-kicker">
              {withPlural(productionRecipes.length, FORMS.recipe)}
              {fromYourProducts === null
                ? ""
                : ` · ${fromYourProducts} из ваших`}
            </p>
            <h1>Рецепты</h1>
          </div>
          <div className="catalog-head-actions">
            <button
              className="btn btn-icon catalog-sort-button"
              aria-label={`Сортировка: ${catalogSortLabels[state.sort]}`}
              onClick={() =>
                onState({
                  ...state,
                  sort:
                    state.sort === "missing"
                      ? "time"
                      : state.sort === "time"
                        ? "protein"
                        : "missing",
                })
              }
            >
              <Icon name="filter" size={18} />
            </button>
            <button
              className={`catalog-filter-button ${active.length ? "is-active" : ""}`}
              aria-label={
                active.length
                  ? `Фильтры, активно ${active.length}`
                  : "Фильтры"
              }
              onClick={() => setFiltersOpen(true)}
            >
              Фильтры
              {active.length > 0 && (
                <span className="catalog-filter-count">{active.length}</span>
              )}
            </button>
          </div>
        </div>
        <label className="catalog-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={state.q}
            placeholder="Рецепт, продукт или «что убрать»"
            aria-label="Поиск по рецептам и продуктам"
            onChange={(event) => onState({ ...state, q: event.target.value })}
          />
        </label>
        {(active.length > 0 || !state.slot) && (
          <div className="chip-row catalog-chips">
            {active.map((filter) => (
              <button
                key={filter.id}
                className="chip"
                aria-checked
                role="checkbox"
                aria-label={`Снять фильтр: ${filter.label}`}
                onClick={() => onState(filter.clear())}
              >
                {filter.label}
                <Icon name="close" size={13} />
              </button>
            ))}
            {(Object.keys(catalogPropertyLabels) as CatalogProperty[])
              .filter((property) => !state.properties.includes(property))
              .map((property) => (
                <button
                  key={property}
                  className="chip"
                  role="checkbox"
                  aria-checked={false}
                  onClick={() =>
                    onState({
                      ...state,
                      properties: [...state.properties, property],
                    })
                  }
                >
                  {catalogPropertyLabels[property]}
                </button>
              ))}
          </div>
        )}
      </header>

      <div className="catalog-scroll" ref={scrollRef}>
        <div className="catalog-sort-row">
          <span>{catalogSortLabels[state.sort]}</span>
          {active.length > 0 && (
            <button
              className="btn btn-ghost"
              onClick={() => onState({ ...emptyCatalogState, sort: state.sort })}
            >
              Сбросить
            </button>
          )}
        </div>
        {visible.length ? (
          <div className="catalog-grid" aria-live="polite">
            {visible.map((recipe, index) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                index={index}
                plan={plan}
                onOpen={() => onOpenRecipe(recipe)}
              />
            ))}
          </div>
        ) : (
          <section className="catalog-empty glass-card">
            <Icon name="search" />
            <h3>Ничего с этими фильтрами</h3>
            {active[0] ? (
              <button
                className="btn btn-secondary"
                onClick={() => onState(active[0].clear())}
              >
                Снять «{active[0].label}»
              </button>
            ) : (
              <p>В каталоге пока нет таких блюд.</p>
            )}
          </section>
        )}
      </div>

      {filtersOpen && (
        <Sheet
          titleId="catalog-filters-title"
          onClose={() => setFiltersOpen(false)}
          className="catalog-filters-sheet glass"
        >
          <div className="sheet-head">
            <h2 id="catalog-filters-title">Фильтры</h2>
            <button
              className="btn btn-ghost"
              onClick={() => onState({ ...emptyCatalogState, sort: state.sort })}
            >
              Сбросить всё
            </button>
          </div>
          <FilterGroup
            label="Приём пищи"
            options={(Object.keys(mealMeta) as MealSlot[]).map((value) => ({
              value,
              label: mealMeta[value].label,
            }))}
            value={state.slot}
            onChange={(slot) => onState({ ...state, slot })}
          />
          <FilterGroup
            label="Время"
            options={(["quick", "medium", "long"] as const).map((value) => ({
              value,
              label: catalogTimeLabels[value],
            }))}
            value={state.time}
            onChange={(time) => onState({ ...state, time })}
          />
          <FilterGroup
            label="Сколько действий"
            options={(["low", "high"] as const).map((value) => ({
              value,
              label: catalogEffortLabels[value],
            }))}
            value={state.effort}
            onChange={(effort) => onState({ ...state, effort })}
          />
          <fieldset className="filter-group">
            <legend className="t-kicker">Свойства</legend>
            <div className="chip-row">
              {(Object.keys(catalogPropertyLabels) as CatalogProperty[]).map(
                (property) => {
                  const on = state.properties.includes(property);
                  return (
                    <button
                      key={property}
                      className="chip"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() =>
                        onState({
                          ...state,
                          properties: on
                            ? state.properties.filter((item) => item !== property)
                            : [...state.properties, property],
                        })
                      }
                    >
                      {catalogPropertyLabels[property]}
                    </button>
                  );
                },
              )}
            </div>
          </fieldset>
          <button
            className="btn btn-primary catalog-filters-apply"
            onClick={() => setFiltersOpen(false)}
          >
            Показать {withPlural(visible.length, FORMS.recipe)}
          </button>
        </Sheet>
      )}
    </section>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <fieldset className="filter-group" role="radiogroup" aria-label={label}>
      <legend className="t-kicker">{label}</legend>
      <div className="chip-row">
        {options.map((option) => {
          const on = value === option.value;
          return (
            <button
              key={option.value}
              className="chip"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on ? null : option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function RecipeCard({
  recipe,
  index,
  plan,
  onOpen,
}: {
  recipe: Recipe;
  index: number;
  plan: ActivePlan | null;
  onOpen: () => void;
}) {
  const photo =
    recipe.provenance.kind === "parsed" ? recipe.provenance.imageUrl : undefined;
  const missing = missingCountFor(recipe, plan);
  const batchNumber = batchNumberFor(recipe, plan);
  return (
    <button className="recipe-card" onClick={onOpen}>
      <div className={`recipe-media art-${index % 5}`}>
        {photo ? (
          // Фото рецепта — удалённый ассет источника, не сборочная картинка.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span aria-hidden>{recipe.emoji}</span>
        )}
        {batchNumber && (
          <span className="recipe-batch-badge">в партии {batchNumber}</span>
        )}
        <span className="recipe-kcal">{recipe.macros.kcal} ккал</span>
      </div>
      <div className="recipe-body">
        <h2>{recipe.title}</h2>
        <p className="recipe-meta">
          {recipe.time} мин · {recipe.servingWeight} г · Б {recipe.macros.protein}
        </p>
        <div className="recipe-chips">
          {missing !== null && (
            <span className={`missing-badge ${missing ? "is-short" : "is-ready"}`}>
              докупить {missing}
            </span>
          )}
          <span className="recipe-chip">{propertyChipFor(recipe, plan)}</span>
        </div>
      </div>
    </button>
  );
}

function ShoppingScreen({
  plan,
  onBuild,
  onChange,
}: {
  plan: ActivePlan | null;
  onBuild: () => void;
  onChange: (plan: ActivePlan) => Promise<boolean>;
}) {
  const [failed, setFailed] = useState(false);
  const [undoItems, setUndoItems] = useState<ShoppingItem[] | null>(null);
  const shoppingPlanId = plan?.id;
  useEffect(() => {
    if (shoppingPlanId) void trackAnalytics("shopping_opened");
  }, [shoppingPlanId]);
  if (!plan)
    return (
      <section className="screen">
        <EmptyState
          onBuild={onBuild}
          title="Список покупок ждёт меню"
          text="После создания плана одинаковые продукты объединятся, а количества пересчитаются под всех людей."
        />
      </section>
    );
  const currentPlan = plan;
  const groups = groupedShopping(plan.shopping);
  const checked = plan.shopping.filter((item) => item.checked).length;
  async function apply(
    shopping: ShoppingItem[],
    undoTo: ShoppingItem[] | null,
  ) {
    const ok = await onChange({ ...currentPlan, shopping });
    setFailed(!ok);
    setUndoItems(ok ? undoTo : null);
    return ok;
  }
  async function toggle(key: string) {
    const previous = currentPlan.shopping.find((item) => item.key === key);
    const ok = await apply(
      currentPlan.shopping.map((item) =>
        item.key === key ? { ...item, checked: !item.checked } : item,
      ),
      null,
    );
    if (ok && previous && !previous.checked)
      void trackAnalytics("shopping_item_checked");
    if (!ok)
      void trackAnalytics("blocking_error", { errorCode: "shopping_save" });
  }
  function clearChecks() {
    void apply(
      currentPlan.shopping.map((item) => ({ ...item, checked: false })),
      currentPlan.shopping,
    );
  }
  function undo() {
    const restore = undoItems;
    if (restore) void apply(restore, null);
  }
  return (
    <section className="screen shopping-screen">
      <section className="shopping-summary glass-card">
        <div>
          <p className="kicker">
            Куплено {checked} из {plan.shopping.length}
          </p>
          <h2>
            {Math.round((checked / Math.max(plan.shopping.length, 1)) * 100)}%
          </h2>
          {checked > 0 && (
            <button className="text-button" onClick={clearChecks}>
              Снять отметки
            </button>
          )}
        </div>
        <div
          className="progress-ring"
          style={
            {
              "--progress": `${Math.round((checked / Math.max(plan.shopping.length, 1)) * 100) * 3.6}deg`,
            } as React.CSSProperties
          }
        >
          <Icon name="check" />
        </div>
      </section>
      {failed && (
        <Note tone="warn" role="alert" className="note-toast">
          Отметка не сохранилась — проверьте связь и нажмите ещё раз.
        </Note>
      )}
      {undoItems && (
        <div className="undo-bar" role="status">
          <span>Отметки сняты</span>
          <button className="text-button" onClick={undo}>
            Вернуть
          </button>
        </div>
      )}
      <section className="label-reminder glass-card">
        <span>i</span>
        <p>
          <b>Проверяйте этикетку</b>
          <small>
            Состав и предупреждение о возможных следах зависят от конкретного
            продукта и упаковки.
          </small>
        </p>
      </section>
      {Object.entries(groups).map(([group, items]) => (
        <section className="shopping-group glass-card" key={group}>
          <div className="group-title">
            <h3>{group}</h3>
            <span>{items.length}</span>
          </div>
          {items.map((item) => (
            <button
              className={`grocery-row ${item.checked ? "checked" : ""}`}
              key={item.key}
              role="checkbox"
              aria-checked={item.checked}
              onClick={() => void toggle(item.key)}
            >
              <span className="checkmark">
                {item.checked && <Icon name="check" />}
              </span>
              <span className="grocery-name">
                {item.name}
                {item.checkLabel && <small>Проверить состав и следы</small>}
              </span>
              <b>
                {item.quantity.toLocaleString("ru-RU")} {item.unit}
              </b>
            </button>
          ))}
        </section>
      ))}
    </section>
  );
}

function ProfileScreen({
  people,
  hasPlan,
  onConfigure,
  onOpenTutorial,
  onOpenPrepGuide,
  onNotifications,
}: {
  people: Person[];
  hasPlan: boolean;
  onConfigure: () => void;
  onOpenTutorial: () => void;
  onOpenPrepGuide: () => void;
  onNotifications: () => void;
}) {
  return (
    <section className="screen profile-screen">
      <section className="profile-hero glass-card">
        <div className="large-avatar">М</div>
        <div>
          <p className="kicker">Ваше пространство</p>
          <h2>
            {people.length} {people.length === 1 ? "человек" : "человека"}
          </h2>
          <p>Цели используются для расчёта каждой порции.</p>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <p className="kicker">Участники плана</p>
          <h2>КБЖУ и блюда</h2>
        </div>
        <button
          className="text-button"
          aria-label="Настроить людей и цели"
          onClick={onConfigure}
        >
          Настроить
        </button>
      </div>
      {people.map((person, index) => {
        const planned = plannedTargetsFor(person);
        const difference = macroDifference(person.daily, planned);
        const positionLabel =
          person.includedSlots.length === 1
            ? "позиция"
            : person.includedSlots.length < 5
              ? "позиции"
              : "позиций";
        return (
          <section className="person-summary glass-card" key={person.id}>
            <div className={`person-dot tone-${index}`}>
              {person.name.slice(0, 1)}
            </div>
            <div className="person-main">
              <h3>{person.name}</h3>
              <p>
                {person.includedSlots.length} {positionLabel} из Mise ·{" "}
                {difference.kcal > 50
                  ? `ещё ≈ ${difference.kcal} ккал`
                  : difference.kcal < -50
                    ? `выше цели на ≈ ${Math.abs(difference.kcal)} ккал`
                    : "цель примерно закрыта"}
              </p>
              <div className="mini-macros">
                {(["kcal", "protein", "fat", "carbs"] as MacroKey[]).map(
                  (key) => (
                    <span key={key}>
                      <b>{person.daily[key]}</b> {macroLabels[key]}
                    </span>
                  ),
                )}
              </div>
              {(person.hardExclusions?.length ?? 0) > 0 && (
                <small className="hard-summary">
                  Нельзя: {person.hardExclusions
                    ?.map((allergen) => allergenMeta[allergen].short.toLowerCase())
                    .join(", ")}
                </small>
              )}
            </div>
          </section>
        );
      })}
      <InstallInline />
      {hasPlan && (
        <button
          className="tutorial-entry notification-entry glass-card"
          onClick={onNotifications}
        >
          <Icon name="bell" />
          <div>
            <b>Напоминания</b>
            <small>Время готовки, покупок и разморозки</small>
          </div>
          <Icon name="chevron" className="entry-chevron" />
        </button>
      )}
      <button className="tutorial-entry glass-card" onClick={onOpenTutorial}>
        <span>
          <Icon name="info" />
        </span>
        <div>
          <b>Как работает Mise</b>
          <small>Ещё раз открыть короткий онбординг</small>
        </div>
        <Icon name="chevron" className="entry-chevron" />
      </button>
      <button className="tutorial-entry glass-card" onClick={onOpenPrepGuide}>
        <span>
          <Icon name="pot" />
        </span>
        <div>
          <b>Инструкция по милпрепу</b>
          <small>Пять правил и чек-лист перед первой готовкой</small>
        </div>
        <Icon name="chevron" className="entry-chevron" />
      </button>
    </section>
  );
}

function PlanBuilder({
  initialPlan,
  initialStep = 0,
  initialBatchId,
  repeat = false,
  mode = "onboarding",
  flowId,
  startedAt,
  isNextPlan = false,
  onClose,
  onSaved,
  persistPlan,
}: {
  initialPlan: ActivePlan | null;
  initialStep?: number;
  initialBatchId?: string;
  repeat?: boolean;
  mode?: BuilderMode;
  flowId?: string;
  startedAt?: number;
  isNextPlan?: boolean;
  onClose: () => void;
  onSaved: (plan: ActivePlan, destination: Tab) => void;
  persistPlan: (plan: ActivePlan) => Promise<void>;
}) {
  const flowIdRef = useRef(flowId);
  const [builderStartedAt] = useState(() => startedAt ?? Date.now());
  const initialChoiceIndex =
    initialPlan && initialBatchId
      ? Math.max(
          0,
          initialPlan.batches.findIndex(
            (batch) => batch.id === initialBatchId,
          ) * initialPlan.mealSlots.length,
        )
      : 0;
  const today = isoDate(new Date());
  const [step, setStep] = useState(initialStep);
  const [start, setStart] = useState(
    repeat ? today : (initialPlan?.start ?? today),
  );
  const [end, setEnd] = useState(
    repeat
      ? addDays(today, Math.max(0, (initialPlan?.periodDays ?? 7) - 1))
      : (initialPlan?.end ?? addDays(today, 6)),
  );
  const [mealSlots, setMealSlots] = useState<MealSlot[]>(
    initialPlan?.mealSlots ?? ["breakfast", "lunch", "dinner"],
  );
  const [menuStyle, setMenuStyle] = useState<MenuStyle>(
    initialPlan?.menuStyle ?? "protein",
  );
  const [people, setPeople] = useState<Person[]>(
    initialPlan?.people.map(normalizePerson) ?? [
      { ...newPerson(0), includedSlots: ["breakfast", "lunch", "dinner"] },
    ],
  );
  const [cookEveryDays, setCookEveryDays] = useState(
    initialPlan?.cookEveryDays ?? 3,
  );
  const [remainderDecision, setRemainderDecision] = useState<
    "separate" | "extend" | "shorten" | null
  >(
    initialPlan && initialPlan.periodDays % initialPlan.cookEveryDays
      ? "separate"
      : null,
  );
  const [selections, setSelections] = useState<Record<string, string>>(
    initialPlan?.selections ?? {},
  );
  const [choiceIndex, setChoiceIndex] = useState(initialChoiceIndex);
  /* Ключи позиций, где блюдо выбрано вручную. Автосборка их не трогает —
     источник сохраняется вместе с планом и черновиком. */
  const [pinned, setPinned] = useState<string[]>(
    initialPlan?.pinnedSelectionKeys ?? [],
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">(
    "idle",
  );
  const [saveMessage, setSaveMessage] = useState("");
  const [successPlan, setSuccessPlan] = useState<ActivePlan | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const stepRef = useRef(step);
  const closeRef = useRef(onClose);
  useEffect(() => {
    stepRef.current = step;
    closeRef.current = onClose;
  });
  function clearDraft() {
    try {
      localStorage.removeItem(builderDraftKey);
    } catch {
      /* storage may be unavailable */
    }
  }
  function closeBuilder() {
    clearDraft();
    if (mode === "settings") closeRef.current();
    else {
      history.back();
      window.setTimeout(() => closeRef.current(), 250);
    }
  }
  function discardDraft() {
    clearDraft();
    setDraftRestored(false);
    setStep(initialStep);
    setStart(repeat ? today : (initialPlan?.start ?? today));
    setEnd(
      repeat
        ? addDays(today, Math.max(0, (initialPlan?.periodDays ?? 7) - 1))
        : (initialPlan?.end ?? addDays(today, 6)),
    );
    setMealSlots(initialPlan?.mealSlots ?? ["breakfast", "lunch", "dinner"]);
    setMenuStyle(initialPlan?.menuStyle ?? "protein");
    setPeople(
      initialPlan?.people.map(normalizePerson) ?? [
        { ...newPerson(0), includedSlots: ["breakfast", "lunch", "dinner"] },
      ],
    );
    setCookEveryDays(initialPlan?.cookEveryDays ?? 3);
    setRemainderDecision(null);
    setSelections(initialPlan?.selections ?? {});
    setPinned(initialPlan?.pinnedSelectionKeys ?? []);
    setChoiceIndex(initialChoiceIndex);
  }
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    if (mode === "settings") return;
    try {
      const raw = localStorage.getItem(builderDraftKey);
      if (raw) {
        const draft = JSON.parse(raw) as BuilderDraft;
        const sameTarget = draft.planId === (initialPlan?.id ?? null);
        const fresh = Date.now() - draft.savedAt < 7 * 86_400_000;
        if (sameTarget && fresh) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off restore of a saved draft from localStorage
          setStart(draft.start);
          setEnd(draft.end);
          setMealSlots(draft.mealSlots);
          setMenuStyle(draft.menuStyle);
          setPeople(draft.people.map(normalizePerson));
          setCookEveryDays(draft.cookEveryDays);
          setRemainderDecision(draft.remainderDecision);
          setSelections(draft.selections);
          setPinned(
            draft.pinnedSelectionKeys ?? initialPlan?.pinnedSelectionKeys ?? [],
          );
          setStep(draft.step);
          setChoiceIndex(draft.choiceIndex);
          setDraftRestored(true);
        } else if (!fresh) localStorage.removeItem(builderDraftKey);
      }
    } catch {
      /* a broken draft must never block the wizard */
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- runs once on mount
  useEffect(() => {
    if (mode === "settings") return;
    history.pushState({ mise: "builder" }, "");
    const onPop = () => {
      if (stepRef.current > initialStep) {
        setStep((value) => value - 1);
        history.pushState({ mise: "builder" }, "");
      } else closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- the back trap is installed once
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step]);
  const rawDays = daysInclusive(start, end);
  const validPeriod = rawDays >= 1 && rawDays <= 14;
  const remainder = validPeriod ? rawDays % cookEveryDays : 0;
  const resolvedDays = !remainder
    ? rawDays
    : remainderDecision === "extend"
      ? rawDays + cookEveryDays - remainder
      : remainderDecision === "shorten"
        ? rawDays - remainder
        : rawDays;
  const resolvedPeriodValid = resolvedDays >= 1 && resolvedDays <= 14;
  const resolvedEnd = addDays(start, Math.max(0, resolvedDays - 1));
  const batches = useMemo(
    () => buildBatches(start, Math.max(1, resolvedDays), cookEveryDays),
    [start, resolvedDays, cookEveryDays],
  );
  const positions = useMemo(
    () =>
      batches.flatMap((batch) => mealSlots.map((slot) => ({ batch, slot }))),
    [batches, mealSlots],
  );
  const unassignedSlots = mealSlots.filter(
    (slot) => !people.some((person) => person.includedSlots.includes(slot)),
  );
  const validSelections = ((): Record<string, string> => {
    const valid: Record<string, string> = {};
    for (const batch of batches)
      for (const slot of mealSlots) {
        const key = selectionKey(batch, slot);
        const recipe = recipesById[selections[key]];
        if (
          recipe &&
          isProductionReadyRecipe(recipe) &&
          recipe.slot === slot &&
          recipe.tags.includes(menuStyle) &&
          (recipe.storageDays >= batch.days || recipe.freezable) &&
          relevantPeople(people, slot).every(
            (person) => hardConflicts(recipe, person).length === 0,
          )
        )
          valid[key] = recipe.id;
      }
    return valid;
  })();
  const allSelected = positions.every(({ batch, slot }) =>
    Boolean(validSelections[selectionKey(batch, slot)]),
  );
  const staleCount = positions.filter(
    ({ batch, slot }) =>
      selections[selectionKey(batch, slot)] &&
      !validSelections[selectionKey(batch, slot)],
  ).length;
  const validPinned = pinned.filter((key) => Boolean(validSelections[key]));
  /* Шаг «Выбор меню» открывается уже собранным: PRODUCT.md §4 п.7 обещает
     автоматически собранное меню, а не набор из девяти-пятнадцати выборов. */
  useEffect(() => {
    if (step !== 5) return;
    const missing = positions.some(
      ({ batch, slot }) => !validSelections[selectionKey(batch, slot)],
    );
    if (missing) assembleMenu("fill");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересобирать на каждый рендер нельзя: validSelections пересчитывается всегда
  }, [step, positions]);
  useEffect(() => {
    if (successPlan || mode === "settings") return;
    const draft: BuilderDraft = {
      planId: initialPlan?.id ?? null,
      savedAt: Date.now(),
      step,
      choiceIndex,
      start,
      end,
      mealSlots,
      menuStyle,
      people,
      cookEveryDays,
      remainderDecision,
      selections,
      pinnedSelectionKeys: pinned,
    };
    try {
      localStorage.setItem(builderDraftKey, JSON.stringify(draft));
    } catch {
      /* storage may be unavailable */
    }
  }, [
    step,
    choiceIndex,
    start,
    end,
    mealSlots,
    menuStyle,
    people,
    cookEveryDays,
    remainderDecision,
    selections,
    pinned,
    successPlan,
    initialPlan,
    mode,
  ]);
  const draftPlan = ((): ActivePlan => {
    const base: ActivePlan = {
      id: "draft",
      createdAt: new Date().toISOString(),
      start,
      end: resolvedEnd,
      periodDays: resolvedDays,
      cookEveryDays,
      menuStyle,
      mealSlots,
      people,
      batches,
      selections: validSelections,
      pinnedSelectionKeys: validPinned,
      shopping: [],
    };
    return { ...base, shopping: buildShopping(base) };
  })();
  const steps = [
    "Период",
    "Приёмы пищи",
    "Вид меню",
    "Люди и цели",
    "Готовка",
    "Выбор меню",
    "Проверка",
  ];
  function setQuickPeriod(days: number) {
    setEnd(addDays(start, days - 1));
    setRemainderDecision(null);
  }
  function updatePerson(id: string, patch: Partial<Person>) {
    setPeople((current) =>
      current.map((person) =>
        person.id === id ? { ...person, ...patch } : person,
      ),
    );
  }
  function updateMacro(id: string, key: MacroKey, value: number) {
    setPeople((current) =>
      current.map((person) => {
        if (person.id !== id) return person;
        const safeValue = Math.max(0, value);
        if (key === "kcal") {
          const preset = person.macroPreset ?? "balanced";
          return {
            ...person,
            daily: recalculateDailyMacros(safeValue, person.daily, preset),
            macroPreset: preset,
            nutritionTargetMode: "manual",
          };
        }
        return {
          ...person,
          daily: { ...person.daily, [key]: safeValue },
          macroPreset: "custom",
          nutritionTargetMode: "manual",
        };
      }),
    );
  }
  function applyMacroPreset(id: string, preset: MacroPresetOption) {
    setPeople((current) =>
      current.map((person) =>
        person.id === id
          ? {
              ...person,
              daily: macrosForCalories(person.daily.kcal, preset),
              macroPreset: preset,
              nutritionTargetMode: "manual",
            }
          : person,
      ),
    );
  }
  function toggleMealSlot(slot: MealSlot) {
    const removing = mealSlots.includes(slot);
    setMealSlots((current) =>
      removing ? current.filter((item) => item !== slot) : [...current, slot],
    );
    setPeople((current) =>
      current.map((person, index) => {
        if (removing)
          return {
            ...person,
            includedSlots: person.includedSlots.filter((item) => item !== slot),
          };
        if (index !== 0 || person.includedSlots.includes(slot)) return person;
        return { ...person, includedSlots: [...person.includedSlots, slot] };
      }),
    );
  }
  function togglePersonMealSlot(personId: string, slot: MealSlot) {
    const next = togglePersonMealSlotSelection(
      people,
      mealSlots,
      personId,
      slot,
    );
    setPeople(next.people);
    setMealSlots(next.mealSlots);
  }
  function stepIsValid(index = step) {
    if (index === 0) return validPeriod;
    if (index === 1) return mealSlots.length > 0;
    if (index === 3)
      return (
        people.length > 0 &&
        people.every(
          (person) =>
            person.name.trim() &&
            person.daily.kcal > 0 &&
            person.includedSlots.some((slot) => mealSlots.includes(slot)),
        )
      );
    if (index === 4)
      return (
        resolvedPeriodValid && (remainder === 0 || remainderDecision !== null)
      );
    if (index === 5) return allSelected;
    return true;
  }
  function next() {
    if (!stepIsValid()) return;
    if (step === 3 && unassignedSlots.length) {
      setMealSlots((current) =>
        current.filter((slot) => !unassignedSlots.includes(slot)),
      );
    }
    if (step === 4) {
      const firstMissing = positions.findIndex(
        (position) =>
          !validSelections[selectionKey(position.batch, position.slot)],
      );
      setChoiceIndex(firstMissing >= 0 ? firstMissing : 0);
    }
    setStep((value) => Math.min(6, value + 1));
  }
  /* Меню собирается целиком: по каждой позиции берётся лучший по fitScore
     кандидат, уже отфильтрованный по жёстким исключениям и сроку хранения.
     Внутри одного приёма пищи блюда по партиям стараемся не повторять. */
  function assembleMenu(mode: "fill" | "reset" = "fill") {
    const updated = { ...validSelections };
    const usedPerSlot = new Map<MealSlot, Set<string>>();
    /* «Собрать заново» должно давать другое меню, а не то же самое:
       прошлый выбор уходит в отказ, следующий берётся по убыванию fitScore. */
    const avoidPerSlot = new Map<MealSlot, Set<string>>();
    for (const slot of mealSlots) {
      usedPerSlot.set(slot, new Set());
      avoidPerSlot.set(slot, new Set());
    }
    if (mode === "reset")
      for (const { batch, slot } of positions) {
        const key = selectionKey(batch, slot);
        if (pinned.includes(key)) continue;
        if (updated[key]) avoidPerSlot.get(slot)?.add(updated[key]);
        delete updated[key];
      }
    for (const { batch, slot } of positions) {
      const key = selectionKey(batch, slot);
      const used = usedPerSlot.get(slot) ?? new Set<string>();
      if (updated[key]) {
        used.add(updated[key]);
        continue;
      }
      const options = candidateRecipes(slot, menuStyle, people, batch.days, {
        limit: "all",
      });
      const avoid = avoidPerSlot.get(slot) ?? new Set<string>();
      const pick =
        options.find(
          (recipe) => !used.has(recipe.id) && !avoid.has(recipe.id),
        ) ??
        options.find((recipe) => !used.has(recipe.id)) ??
        options[0] ??
        candidateRecipes(slot, menuStyle, people, batch.days, {
          limit: 1,
          includeDisliked: true,
        })[0];
      if (!pick) continue;
      updated[key] = pick.id;
      used.add(pick.id);
    }
    setSelections(updated);
  }
  function replaceSelection(key: string, recipeId: string) {
    setSelections({ ...validSelections, [key]: recipeId });
    setPinned((current) =>
      current.includes(key) ? current : [...current, key],
    );
  }
  async function save() {
    if (!allSelected) {
      const firstMissing = positions.findIndex(
        (position) =>
          !validSelections[selectionKey(position.batch, position.slot)],
      );
      setChoiceIndex(firstMissing >= 0 ? firstMissing : 0);
      setStep(5);
      setSaveState("error");
      setSaveMessage(
        staleCount > 0
          ? "Одно из выбранных блюд больше не подходит. Выберите замену."
          : "Выберите блюдо для нового приёма пищи.",
      );
      return;
    }
    const plan: ActivePlan = {
      ...draftPlan,
      id: initialPlan?.id ?? crypto.randomUUID(),
      createdAt: initialPlan?.createdAt ?? new Date().toISOString(),
    };
    if (validateHardExclusions(plan).length > 0) {
      setSaveState("error");
      setSaveMessage(
        "План не сохранён: выбранное блюдо нарушает «Аллергия/мне нельзя».",
      );
      return;
    }
    setSaveState("saving");
    setSaveMessage("");
    try {
      await persistPlan(plan);
      if (flowIdRef.current) {
        const analyticsFields = {
          flowId: flowIdRef.current,
          durationMs: Math.max(0, Date.now() - builderStartedAt),
          pilotEligible: plan.periodDays >= 3 && plan.periodDays <= 7,
        };
        void trackAnalytics(
          "plan_created",
          analyticsFields,
          `plan-created:${flowIdRef.current}`,
        );
        if (isNextPlan)
          void trackAnalytics(
            "next_plan_created",
            { flowId: flowIdRef.current },
            `next-plan-created:${flowIdRef.current}`,
          );
      }
      setSaveState("idle");
      clearDraft();
      if (mode === "settings")
        onSaved(plan, initialStep === 3 ? "profile" : "week");
      else setSuccessPlan(plan);
    } catch {
      void trackAnalytics("blocking_error", { errorCode: "plan_save" });
      setSaveState("error");
      setSaveMessage(
        "Не получилось сохранить. Проверьте соединение и попробуйте ещё раз.",
      );
    }
  }
  return (
    <main className="app-shell builder-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header
        className={`builder-header ${mode === "settings" ? "settings-header" : ""}`}
      >
        <button
          className="icon-button glass"
          onClick={
            step === initialStep
              ? closeBuilder
              : () => setStep((value) => value - 1)
          }
          aria-label={
            mode === "settings"
              ? "Назад в настройки"
              : step === initialStep
                ? "Закрыть мастер"
                : "Назад"
          }
        >
          {mode === "settings" || step > initialStep ? (
            <Icon name="chevron-left" />
          ) : (
            <Icon name="close" />
          )}
        </button>
        <div>
          {mode === "onboarding" && (
            <p className="kicker">
              {step === 3 && <>Кто ест · </>}Шаг {step + 1} из {steps.length}
            </p>
          )}
          <h1>{steps[step]}</h1>
        </div>
      </header>
      {mode === "onboarding" && (
        <div className="progress-track">
          <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
      )}
      <section className="builder-content">
        {draftRestored && (
          <Note
            tone="mint"
            role="status"
            action={
              <button className="text-button" onClick={discardDraft}>
                Начать заново
              </button>
            }
          >
            Продолжаем незаконченный черновик плана.
          </Note>
        )}
        {staleCount > 0 && (
          <Note tone="mint" role="status">
            {staleCount === 1
              ? "Одно блюдо не подходит под новые настройки — выберите его заново на шаге «Выбор меню»."
              : `${staleCount} блюда не подходят под новые настройки — выберите их заново на шаге «Выбор меню».`}
          </Note>
        )}
        {step === 0 && (
          <PeriodStep
            start={start}
            end={end}
            rawDays={rawDays}
            valid={validPeriod}
            onStart={(value) => {
              setStart(value);
              if (daysInclusive(value, end) < 1) setEnd(value);
              setRemainderDecision(null);
            }}
            onEnd={(value) => {
              setEnd(value);
              setRemainderDecision(null);
            }}
            onQuick={setQuickPeriod}
          />
        )}
        {step === 1 && (
          <MealStep
            selected={mealSlots}
            periodDays={rawDays}
            onToggle={toggleMealSlot}
          />
        )}
        {step === 2 && (
          <StyleStep
            selected={menuStyle}
            onSelect={(value) => {
              setMenuStyle(value);
            }}
          />
        )}
        {step === 3 && (
          <PeopleStep
            people={people}
            availableMealSlots={mode === "settings" ? allMealSlots : mealSlots}
            onUpdate={updatePerson}
            onMealSlotToggle={togglePersonMealSlot}
            onMacro={updateMacro}
            onPreset={applyMacroPreset}
            onAdd={() => {
              if (people.length < 4)
                setPeople((current) => [
                  ...current,
                  {
                    ...newPerson(current.length),
                    includedSlots: [...mealSlots],
                  },
                ]);
            }}
            onRemove={(id) => {
              if (people.length > 1)
                setPeople((current) =>
                  current.filter((person) => person.id !== id),
                );
            }}
          />
        )}
        {step === 3 && unassignedSlots.length > 0 && (
          <Note tone="mint" role="status">
            {unassignedSlots.map((slot) => mealMeta[slot].label).join(", ")}{" "}
            никто не выбрал —{" "}
            {unassignedSlots.length === 1
              ? "эта позиция не войдёт"
              : "эти позиции не войдут"}{" "}
            в план.
          </Note>
        )}
        {step === 4 && (
          <CookingStep
            periodDays={rawDays}
            cookEveryDays={cookEveryDays}
            remainder={remainder}
            decision={remainderDecision}
            start={start}
            resolvedDays={resolvedDays}
            canExtend={rawDays + cookEveryDays - remainder <= 14}
            onDays={(value) => {
              setCookEveryDays(value);
              setRemainderDecision(null);
            }}
            onDecision={(value) => {
              setRemainderDecision(value);
            }}
          />
        )}
        {step === 5 && (
          <MenuReviewStep
            batches={batches}
            mealSlots={mealSlots}
            people={people}
            style={menuStyle}
            selections={validSelections}
            pinned={validPinned}
            shopping={draftPlan.shopping}
            onReplace={replaceSelection}
            onReassemble={() => assembleMenu("reset")}
          />
        )}
        {step === 6 && (
          <ReviewStep plan={draftPlan} onEdit={(target) => setStep(target)} />
        )}
      </section>
      <footer className="builder-actions glass">
        <button
          className="secondary-button"
          onClick={
            step === initialStep
              ? closeBuilder
              : () => setStep((value) => value - 1)
          }
        >
          {mode === "settings"
            ? "Назад"
            : step === initialStep
              ? "Отмена"
              : "Назад"}
        </button>
        {mode === "settings" ? (
          <button
            className="primary-button"
            disabled={saveState === "saving" || !stepIsValid(initialStep)}
            onClick={save}
          >
            {saveState === "saving" ? "Сохраняем…" : "Сохранить"}
          </button>
        ) : step < 6 ? (
          <button
            className="primary-button"
            disabled={!stepIsValid()}
            onClick={next}
          >
            {step === 5 ? "Проверить план" : "Продолжить"} <Icon name="chevron" size={16} />
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={saveState === "saving"}
            onClick={save}
          >
            {saveState === "saving"
              ? "Сохраняем…"
              : initialPlan
                ? "Сохранить изменения"
                : "Создать план и покупки"}
          </button>
        )}
      </footer>
      {saveState === "error" && (
        <Note tone="warn" role="alert" className="note-toast">
          {saveMessage ||
            "Не получилось сохранить. Проверьте соединение и попробуйте ещё раз."}
        </Note>
      )}
      {successPlan && (
        <SuccessSheet
          plan={successPlan}
          onOpen={(destination) => onSaved(successPlan, destination)}
          onEdit={() => {
            setSuccessPlan(null);
            setStep(0);
          }}
        />
      )}
    </main>
  );
}

function StepIntro({
  icon,
  kicker,
  title,
  text,
}: {
  icon: React.ReactNode;
  kicker: string;
  title: string;
  text: string;
}) {
  return (
    <div className="step-intro">
      <span>{icon}</span>
      <p className="kicker">{kicker}</p>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
function PeriodStep({
  start,
  end,
  rawDays,
  valid,
  onStart,
  onEnd,
  onQuick,
}: {
  start: string;
  end: string;
  rawDays: number;
  valid: boolean;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  onQuick: (days: number) => void;
}) {
  return (
    <>
      <StepIntro
        icon={<Icon name="clock" />}
        kicker="Когда едим"
        title="Выберите период"
        text="До 14 дней — так проще сохранить свежесть и разнообразие."
      />
      <section className="glass-card">
        <div className="date-fields">
          <label>
            Начало
            <input
              type="date"
              value={start}
              onChange={(event) => onStart(event.target.value)}
            />
          </label>
          <Icon name="chevron" size={16} />
          <label>
            Конец
            <input
              type="date"
              value={end}
              onChange={(event) => onEnd(event.target.value)}
            />
          </label>
        </div>
        <div className="quick-periods" role="radiogroup" aria-label="Быстрый выбор периода">
          {[3, 5, 7, 14].map((days) => (
            <button
              key={days}
              role="radio"
              aria-checked={rawDays === days}
              className={rawDays === days ? "selected" : ""}
              onClick={() => onQuick(days)}
            >
              {withPlural(days, FORMS.day)}
            </button>
          ))}
        </div>
        {valid ? (
          <Note
            tone="mint"
            icon={<Icon name="check" />}
            label={`${formatDate(start)} — ${formatDate(end)}`}
          >
            {rawDays} дней в плане
          </Note>
        ) : (
          <Note tone="warn">Период должен быть от 1 до 14 дней.</Note>
        )}
      </section>
    </>
  );
}
function MealStep({
  selected,
  periodDays,
  onToggle,
}: {
  selected: MealSlot[];
  periodDays: number;
  onToggle: (slot: MealSlot) => void;
}) {
  const positionLabel =
    selected.length === 1
      ? "позиция"
      : selected.length < 5
        ? "позиции"
        : "позиций";
  return (
    <>
      <StepIntro
        icon={<Icon name="pot" />}
        kicker="Что планируем"
        title="Выберите блюда из Mise"
        text="Отметьте только то, что хотите приготовить заранее. Остаток дневной цели мы покажем отдельно."
      />
      <div className="choice-grid meals-grid" role="group" aria-label="Приёмы пищи">
        {(Object.keys(mealMeta) as MealSlot[]).map((slot) => {
          const active = selected.includes(slot);
          return (
            <button
              key={slot}
              role="checkbox"
              className={`choice-card glass-card ${active ? "selected" : ""}`}
              aria-checked={active}
              onClick={() => onToggle(slot)}
            >
              <b>{mealMeta[slot].label}</b>
              <small>
                {active ? (
                  <>
                    Включён <Icon name="check" size={12} />
                  </>
                ) : (
                  "Добавить"
                )}
              </small>
            </button>
          );
        })}
      </div>
      <Note
        tone="mint"
        icon={<Icon name="scale" />}
        label={`${selected.length} ${positionLabel} меню на день`}
      >
        {selected.length * periodDays} порций на человека за период, если он ест
        все выбранные блюда
      </Note>
    </>
  );
}
function StyleStep({
  selected,
  onSelect,
}: {
  selected: MenuStyle;
  onSelect: (style: MenuStyle) => void;
}) {
  return (
    <>
      <StepIntro
        icon={<Icon name="filter" />}
        kicker="Какое меню"
        title="Выберите направление"
        text="Мы изменим порядок рекомендаций и покажем самые подходящие варианты первыми."
      />
      <div
        className="style-list"
        role="radiogroup"
        aria-label="Направление меню"
      >
        {(Object.keys(styleMeta) as MenuStyle[]).map((style) => (
          <button
            key={style}
            role="radio"
            className={`style-card glass-card ${selected === style ? "selected" : ""}`}
            aria-checked={selected === style}
            onClick={() => onSelect(style)}
          >
            <div>
              <h3>{styleMeta[style].label}</h3>
              <p>{styleMeta[style].description}</p>
            </div>
            <i>{selected === style ? <Icon name="check" /> : ""}</i>
          </button>
        ))}
      </div>
    </>
  );
}

/* Шаг «Люди и цели» — макет 9d.

   Задача экрана: поля должны читаться полями. Раньше КБЖУ выглядел статистикой,
   и люди не понимали, что цифры можно менять.

   Один человек на экране, переключение вкладками. Норма считается по Миффлину —
   Сан-Жеору из тех же параметров, что и раньше (lib/nutrition-engine-v2), но
   пересчёт живёт прямо в карточке, а не за кнопкой «Рассчитать мою норму».
   Ручной ввод перебивает расчёт: пока он включён, правки тела норму не трогают. */

/* Цвета те же, что на «Неделе»: один код КБЖУ на всё приложение. */
const macroFieldMeta: {
  key: "protein" | "fat" | "carbs";
  label: string;
  color: string;
  perGram: number;
}[] = [
  { key: "protein", label: "Белки", color: "var(--macro-protein)", perGram: 4 },
  { key: "fat", label: "Жиры", color: "var(--macro-fat)", perGram: 9 },
  { key: "carbs", label: "Углеводы", color: "var(--macro-carbs)", perGram: 4 },
];

const bodyFields: {
  key: "age" | "height" | "weight";
  label: string;
  unit: string;
  min: number;
  max: number;
}[] = [
  { key: "age", label: "Возраст", unit: "лет", min: 18, max: 100 },
  { key: "height", label: "Рост", unit: "см", min: 120, max: 230 },
  { key: "weight", label: "Вес", unit: "кг", min: 35, max: 300 },
];

function estimateOf(person: Person): NutritionWizardInput {
  const saved = person.estimate as
    | (Partial<NutritionWizardInput> & { goal?: string })
    | undefined;
  const savedGoal: string | undefined = saved?.goal;
  return {
    sex: saved?.sex ?? defaultNutritionEstimate.sex,
    age: saved?.age ?? defaultNutritionEstimate.age,
    height: saved?.height ?? defaultNutritionEstimate.height,
    weight: saved?.weight ?? defaultNutritionEstimate.weight,
    activity: saved?.activity ?? defaultNutritionEstimate.activity,
    musclePriority:
      saved?.musclePriority ?? defaultNutritionEstimate.musclePriority,
    goal:
      savedGoal === "lose"
        ? "loss"
        : savedGoal === "keep"
          ? "maintenance"
          : savedGoal === "gain"
            ? "gain"
            : ((savedGoal as NutritionGoal | undefined) ??
              defaultNutritionEstimate.goal),
    monthlyWeightChangeKg:
      saved?.monthlyWeightChangeKg ??
      defaultNutritionEstimate.monthlyWeightChangeKg,
  };
}

function PeopleStep({
  people,
  availableMealSlots,
  onUpdate,
  onMealSlotToggle,
  onMacro,
  onPreset,
  onAdd,
  onRemove,
}: {
  people: Person[];
  availableMealSlots: MealSlot[];
  onUpdate: (id: string, patch: Partial<Person>) => void;
  onMealSlotToggle: (id: string, slot: MealSlot) => void;
  onMacro: (id: string, key: MacroKey, value: number) => void;
  onPreset: (id: string, preset: MacroPresetOption) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState(people[0]?.id ?? "");
  const person = people.find((item) => item.id === activeId) ?? people[0];
  if (!person) return null;

  const manual = person.nutritionTargetMode !== "auto";
  const draft = estimateOf(person);
  const calculation = calculateNutritionTarget(draft);
  const computed = "target" in calculation ? calculation.target : null;
  const fromMacros = macroCalories(person.daily);
  const gap = Math.abs(fromMacros - person.daily.kcal);
  const converges = gap / Math.max(person.daily.kcal, 1) <= 0.03;

  function patchBody(patch: Partial<NutritionWizardInput>) {
    const next = { ...draft, ...patch };
    const result = calculateNutritionTarget(next);
    const target = "target" in result ? result.target : null;
    onUpdate(
      person.id,
      manual || !target
        ? { estimate: next, nutritionTargetMode: "manual" }
        : {
            estimate: next,
            daily: target,
            macroPreset: "custom",
            nutritionTargetMode: "auto",
          },
    );
  }

  return (
    <>
      <p className="people-step-lead">
        Норма задаёт размер порции. «Не люблю» влияет на
        рекомендации, «Аллергия / мне нельзя» полностью запрещает блюдо.
      </p>

      <div className="chip-row person-tabs" role="tablist" aria-label="Люди">
        {people.map((item) => (
          <button
            key={item.id}
            className="chip"
            role="tab"
            aria-selected={item.id === person.id}
            onClick={() => setActiveId(item.id)}
          >
            {item.name || "Человек"}
          </button>
        ))}
        {people.length < 4 && (
          <button className="chip is-add" onClick={onAdd}>
            <Icon name="plus" size={13} /> человек
          </button>
        )}
      </div>

      <section className="glass-card person-card">
        <label className="field">
          <span className="field-label">
            Имя <em>видно только вам</em>
          </span>
          <span className="field-box">
            <input
              value={person.name}
              onChange={(event) =>
                onUpdate(person.id, { name: event.target.value })
              }
            />
          </span>
        </label>

        <div className="field-row">
          {bodyFields.map((field) => (
            <label className="field" key={field.key}>
              <span className="field-label">{field.label}</span>
              <span className="field-box">
                <input
                  type="number"
                  inputMode="numeric"
                  enterKeyHint="next"
                  min={field.min}
                  max={field.max}
                  value={draft[field.key] || ""}
                  aria-label={`${field.label}, ${person.name || "человек"}`}
                  onChange={(event) =>
                    patchBody({ [field.key]: Number(event.target.value) })
                  }
                />
                <em>{field.unit}</em>
              </span>
            </label>
          ))}
        </div>

        <div className="field-row field-row-2">
          <div className="field">
            <span className="field-label">Пол</span>
            <div className="seg" role="radiogroup" aria-label="Пол">
              {(["male", "female"] as Sex[]).map((value) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={draft.sex === value}
                  onClick={() => patchBody({ sex: value })}
                >
                  {value === "male" ? "Мужчина" : "Женщина"}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="field-label">Активность</span>
            <span className="field-box">
              <select
                value={draft.activity}
                onChange={(event) =>
                  patchBody({ activity: event.target.value as ActivityKey })
                }
              >
                {(Object.keys(activityMeta) as ActivityKey[]).map((key) => (
                  <option key={key} value={key}>
                    {activityMeta[key].label}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>

        <div className="field">
          <span className="field-label">Цель</span>
          <div className="seg seg-accent" role="radiogroup" aria-label="Цель">
            {(Object.keys(goalMeta) as NutritionGoal[]).map((key) => (
              <button
                key={key}
                role="radio"
                aria-checked={draft.goal === key}
                onClick={() => patchBody({ goal: key })}
              >
                {goalMeta[key].label}
              </button>
            ))}
          </div>
        </div>

        {draft.goal !== "maintenance" && (
          <label className="field">
            <span className="field-label">
              {draft.goal === "loss" ? "Снижать" : "Набирать"}, кг в месяц
            </span>
            <span className="field-box">
              <input
                type="number"
                inputMode="decimal"
                min="0.1"
                max="12"
                step="0.1"
                value={draft.monthlyWeightChangeKg || ""}
                onChange={(event) =>
                  patchBody({
                    monthlyWeightChangeKg: Number(event.target.value),
                  })
                }
              />
            </span>
          </label>
        )}

        <button
          className="check-row muscle-row"
          role="checkbox"
          aria-checked={draft.musclePriority}
          onClick={() => patchBody({ musclePriority: !draft.musclePriority })}
        >
          <span className="check-box">
            <Icon name="check" size={13} />
          </span>
          <span>Тренируюсь, важно сохранить мышцы</span>
        </button>
      </section>

      <section className="glass-card norm-card">
        <div className="norm-head">
          <div>
            <p className="kicker">
              Норма {person.name || "человека"} ·{" "}
              {manual ? "ввели вы" : "посчитал Mise"}
            </p>
            <p className="norm-figure">
              <b>{person.daily.kcal}</b> <span>ккал/день</span>
            </p>
          </div>
          <button
            className="pill-button"
            aria-pressed={manual}
            disabled={manual && !computed}
            onClick={() => {
              if (!manual) {
                onUpdate(person.id, { nutritionTargetMode: "manual" });
                return;
              }
              if (!computed) return;
              onUpdate(person.id, {
                estimate: draft,
                daily: computed,
                macroPreset: "custom",
                nutritionTargetMode: "auto",
              });
            }}
          >
            {manual ? "Вернуть расчёт Mise" : "Ввести своё"}
          </button>
        </div>

        <label className="field" htmlFor={`macro-${person.id}-kcal`}>
          <span className="field-label">Калории в день</span>
          <span className="field-box">
            <MacroNumberInput
              id={`macro-${person.id}-kcal`}
              ariaLabel={`Калории для ${person.name || "человека"}`}
              value={person.daily.kcal}
              onValueChange={(value) => {
                onMacro(person.id, "kcal", value);
              }}
            />
            <em>ккал</em>
          </span>
        </label>

        <div className="norm-macros">
          {macroFieldMeta.map(({ key, label, color, perGram }) => (
            <label
              className="field macro-field"
              key={key}
              htmlFor={`macro-${person.id}-${key}`}
            >
              <span className="field-label">
                <i style={{ background: color }} aria-hidden /> {label}
              </span>
              <span className="field-box">
                <MacroNumberInput
                  id={`macro-${person.id}-${key}`}
                  ariaLabel={`${label} для ${person.name || "человека"}`}
                  value={person.daily[key]}
                  onValueChange={(value) => {
                    onMacro(person.id, key, value);
                  }}
                />
                <em>г</em>
              </span>
              <span className="macro-bar" aria-hidden>
                <i
                  style={{
                    background: color,
                    width: `${Math.min(100, Math.round((person.daily[key] * perGram * 100) / Math.max(person.daily.kcal, 1)))}%`,
                  }}
                />
              </span>
            </label>
          ))}
        </div>

        <div className="field">
          <span className="field-label">Автоматическое распределение</span>
          <div
            className="chip-row wrap-chips"
            role="radiogroup"
            aria-label="Профиль БЖУ"
          >
            {(Object.keys(macroPresetMeta) as MacroPresetOption[]).map(
              (preset) => {
                const selected = (person.macroPreset ?? "balanced") === preset;
                return (
                  <button
                    key={preset}
                    className="chip"
                    role="radio"
                    aria-checked={selected}
                    title={macroPresetMeta[preset].description}
                    onClick={() => onPreset(person.id, preset)}
                  >
                    {macroPresetMeta[preset].label}
                  </button>
                );
              },
            )}
          </div>
          <small className="field-hint">
            {macroPresetMeta[
              (person.macroPreset ?? "balanced") === "custom"
                ? "balanced"
                : ((person.macroPreset ?? "balanced") as MacroPresetOption)
            ].description}{" "}
            — доли от калорий. Значения можно поправить вручную.
          </small>
        </div>

        <p className={`norm-check ${converges ? "is-ok" : "is-off"}`} role="status">
          {converges ? (
            <>
              <Icon name="check" size={14} /> Сумма макросов — {fromMacros} ккал,
              сходится
            </>
          ) : (
            <>
              <Icon name="warning" size={14} /> Сумма макросов — {fromMacros}{" "}
              ккал против {person.daily.kcal}: не сходится на {gap}
            </>
          )}
        </p>

        {calculation.issues.map((issue) => (
          <Note tone="warn" key={issue.code}>
            {issue.message}
          </Note>
        ))}
      </section>

      <section className="glass-card person-card">
        <div className="field">
          <span className="field-label">Что из плана ест</span>
          <div className="chip-row wrap-chips">
            {availableMealSlots.map((slot) => {
              const active = person.includedSlots.includes(slot);
              return (
                <button
                  key={slot}
                  className="chip"
                  role="checkbox"
                  aria-checked={active}
                  onClick={() => onMealSlotToggle(person.id, slot)}
                >
                  {mealMeta[slot].short}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span className="field-label">
            Не люблю <em>Mise не предложит сам, выбрать вручную можно</em>
          </span>
          <div className="chip-row wrap-chips">
            {dislikeOptions.map((option) => {
              const active = (person.dislikes ?? []).includes(option.id);
              return (
                <button
                  key={option.id}
                  className="chip"
                  role="checkbox"
                  aria-checked={active}
                  onClick={() =>
                    onUpdate(person.id, {
                      dislikes: active
                        ? (person.dislikes ?? []).filter(
                            (item) => item !== option.id,
                          )
                        : [...(person.dislikes ?? []), option.id],
                    })
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span className="field-label">
            Аллергия / мне нельзя <em>жёсткий запрет, обойти нельзя</em>
          </span>
          <div className="chip-row wrap-chips">
            {(Object.keys(allergenMeta) as Allergen[]).map((allergen) => {
              const active = (person.hardExclusions ?? []).includes(allergen);
              return (
                <button
                  key={allergen}
                  className={`chip${active ? " is-hard" : ""}`}
                  role="checkbox"
                  aria-checked={active}
                  onClick={() =>
                    onUpdate(person.id, {
                      hardExclusions: active
                        ? (person.hardExclusions ?? []).filter(
                            (item) => item !== allergen,
                          )
                        : [...(person.hardExclusions ?? []), allergen],
                    })
                  }
                >
                  {allergenMeta[allergen].short}
                </button>
              );
            })}
          </div>
          <small className="field-hint">
            Для настоящей аллергии всё равно проверяйте состав и возможные следы
            на конкретной упаковке.
          </small>
        </div>
      </section>

      <DailyBalance
        goal={person.daily}
        planned={plannedTargetsFor(person)}
        context="В выбранных позициях"
      />

      <p className="onboarding-fineprint">
        Расчёт по формуле Миффлина — Сан-Жеора. Это ориентир, а не медицинская
        рекомендация.
      </p>

      <div className="chip-row menu-actions">
        {people[0] && person.id !== people[0].id && (
          <button
            className="chip"
            onClick={() =>
              onUpdate(person.id, {
                daily: { ...people[0].daily },
                estimate: people[0].estimate,
                macroPreset: people[0].macroPreset,
                nutritionTargetMode: people[0].nutritionTargetMode,
              })
            }
          >
            Скопировать цели у «{people[0].name || "Я"}»
          </button>
        )}
        {people.length > 1 && (
          <button
            className="chip"
            onClick={() => {
              const next = people.find((item) => item.id !== person.id);
              onRemove(person.id);
              if (next) setActiveId(next.id);
            }}
          >
            Удалить {person.name || "человека"}
          </button>
        )}
      </div>
    </>
  );
}

function CookingStep({
  periodDays,
  cookEveryDays,
  remainder,
  decision,
  start,
  resolvedDays,
  canExtend,
  onDays,
  onDecision,
}: {
  periodDays: number;
  cookEveryDays: number;
  remainder: number;
  decision: "separate" | "extend" | "shorten" | null;
  start: string;
  resolvedDays: number;
  canExtend: boolean;
  onDays: (days: number) => void;
  onDecision: (value: "separate" | "extend" | "shorten") => void;
}) {
  const blocks = buildBatches(start, resolvedDays, cookEveryDays);
  return (
    <>
      <StepIntro
        icon={<Icon name="pot" />}
        kicker="Ритм готовки"
        title="На сколько дней готовим за раз?"
        text="Выберите размер одной партии. Мы учтём хранение и заморозку."
      />
      <section className="glass-card">
        <div className="day-scale" role="radiogroup" aria-label="Дней на партию">
          {[1, 2, 3, 4, 5, 6, 7].map((days) => (
            <button
              key={days}
              role="radio"
              aria-checked={cookEveryDays === days}
              className={cookEveryDays === days ? "selected" : ""}
              onClick={() => onDays(days)}
            >
              <b>{days}</b>
              <small>{plural(days, FORMS.day)}</small>
            </button>
          ))}
        </div>
        <div className="batch-timeline">
          {blocks.map((batch) => (
            <div key={batch.id}>
              <span>{batch.index + 1}</span>
              <p>
                <b>Готовка {batch.index + 1}</b>
                <small>
                  {formatDate(batch.start)} — {formatDate(batch.end)} ·{" "}
                  {batch.days} дн.
                </small>
              </p>
            </div>
          ))}
        </div>
      </section>
      {remainder > 0 && (
        <div
          className="remainder-sheet glass-card"
          role="radiogroup"
          aria-label="Как поступить с остатком"
        >
          <p className="kicker">Нужно ваше решение</p>
          <h3>
            {periodDays} дней не делятся на {cookEveryDays} без остатка
          </h3>
          <p>
            Последний блок — {remainder} {remainder === 1 ? "день" : "дня"}. Как
            поступить?
          </p>
          <button
            role="radio"
            aria-checked={decision === "separate"}
            className={decision === "separate" ? "selected" : ""}
            onClick={() => onDecision("separate")}
          >
            <Icon name="container" />
            <div>
              <b>Приготовить остаток отдельно</b>
              <small>
                Оставить даты, финальная мини-готовка на {remainder} дн.
              </small>
            </div>
            <i>{decision === "separate" ? <Icon name="check" /> : ""}</i>
          </button>
          <button
            role="radio"
            aria-checked={decision === "extend"}
            className={decision === "extend" ? "selected" : ""}
            disabled={!canExtend}
            onClick={() => onDecision("extend")}
          >
            <Icon name="plus" />
            <div>
              <b>Добавить {cookEveryDays - remainder} дн.</b>
              <small>
                {canExtend
                  ? `Новый конец: ${formatDate(addDays(start, periodDays + cookEveryDays - remainder - 1))}`
                  : "Получится больше 14 дней — выберите другой вариант"}
              </small>
            </div>
            <i>{decision === "extend" ? <Icon name="check" /> : ""}</i>
          </button>
          <button
            role="radio"
            aria-checked={decision === "shorten"}
            className={decision === "shorten" ? "selected" : ""}
            disabled={periodDays - remainder < 1}
            onClick={() => onDecision("shorten")}
          >
            <Icon name="minus" />
            <div>
              <b>Убрать {remainder} дн.</b>
              <small>
                Новый конец:{" "}
                {formatDate(addDays(start, periodDays - remainder - 1))}
              </small>
            </div>
            <i>{decision === "shorten" ? <Icon name="check" /> : ""}</i>
          </button>
        </div>
      )}
    </>
  );
}

/* Шаг «Выбор меню» — макет 9b.

   Меню приходит собранным по fitScore, человек его проверяет. Это то, что
   PRODUCT.md §4 п.7 и §5 требовали с самого начала («текущий ручной flow ещё
   нужно заменить»), а не новый контракт: число шагов мастера не меняется.

   Заменённая вручную строка помечается и переживает «Собрать заново» —
   это pinnedByUser из BACKEND.md §2, только источник пока клиентский. */

const eveningForms = ["вечер готовки", "вечера готовки", "вечеров готовки"] as const;
const sharedForms = ["общий продукт", "общих продукта", "общих продуктов"] as const;
const buyForms = ["продукт купить", "продукта купить", "продуктов купить"] as const;

/* Сколько порций партии не доживают до своего дня и уходят в морозилку.
   Правило то же, что у напоминаний: порция дня N морозится при N >= storageDays. */
function freezeSummary(
  batches: Batch[],
  mealSlots: MealSlot[],
  people: Person[],
  selections: Record<string, string>,
) {
  let portions = 0;
  let shortest: Recipe | null = null;
  for (const batch of batches)
    for (const slot of mealSlots) {
      const recipe = recipesById[selections[selectionKey(batch, slot)]];
      if (!recipe?.freezable) continue;
      const eaters = relevantPeople(people, slot).length;
      const frozenDays = Math.max(0, batch.days - recipe.storageDays);
      if (!frozenDays || !eaters) continue;
      portions += frozenDays * eaters;
      if (!shortest || recipe.storageDays < shortest.storageDays)
        shortest = recipe;
    }
  return { portions, shortest };
}

function MenuReviewStep({
  batches,
  mealSlots,
  people,
  style,
  selections,
  pinned,
  shopping,
  onReplace,
  onReassemble,
}: {
  batches: Batch[];
  mealSlots: MealSlot[];
  people: Person[];
  style: MenuStyle;
  selections: Record<string, string>;
  pinned: string[];
  shopping: ShoppingItem[];
  onReplace: (key: string, recipeId: string) => void;
  onReassemble: () => void;
}) {
  const [replacing, setReplacing] = useState<{
    key: string;
    batch: Batch;
    slot: MealSlot;
  } | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  /* «Не люблю» — мягкое исключение: блюдо прячется из первых рекомендаций,
     но остаётся доступным явно (PRODUCT.md §5). */
  const [includeDisliked, setIncludeDisliked] = useState(false);

  const chosen = batches.flatMap((batch) =>
    mealSlots
      .map((slot) => recipesById[selections[selectionKey(batch, slot)]])
      .filter(Boolean),
  );
  const ingredientUse = new Map<string, number>();
  for (const recipe of new Set(chosen))
    for (const ingredient of recipe.ingredients)
      ingredientUse.set(
        ingredient.id,
        (ingredientUse.get(ingredient.id) ?? 0) + 1,
      );
  const shared = [...ingredientUse.values()].filter((count) => count > 1).length;
  const freeze = freezeSummary(batches, mealSlots, people, selections);
  const dishes = new Set(chosen.map((recipe) => recipe.id)).size;
  const portions = batches.reduce(
    (sum, batch) =>
      sum +
      batch.days *
        mealSlots.reduce(
          (slotSum, slot) => slotSum + relevantPeople(people, slot).length,
          0,
        ),
    0,
  );

  return (
    <>
      <p className="wizard-bubble">
        Собрал меню на {withPlural(
          batches.reduce((sum, batch) => sum + batch.days, 0),
          FORMS.day,
        )}: {withPlural(dishes, FORMS.dish)}, {withPlural(portions, FORMS.portion)}.
        Посмотрите — что не нравится, заменю.
      </p>

      <div className="menu-summary">
        <div className="summary-tile">
          <b className="tone-accent-num">{batches.length}</b>
          <span>{plural(batches.length, eveningForms)}</span>
        </div>
        <div className="summary-tile">
          <b className="tone-mint-num">{shared}</b>
          <span>{plural(shared, sharedForms)}</span>
        </div>
        <div className="summary-tile">
          <b className="tone-amber-num">{shopping.length}</b>
          <span>{plural(shopping.length, buyForms)}</span>
        </div>
      </div>

      {batches.map((batch) => {
        const rows = mealSlots
          .map((slot) => ({
            slot,
            key: selectionKey(batch, slot),
            recipe: recipesById[selections[selectionKey(batch, slot)]],
          }))
          .filter((row) => row.recipe);
        const open = expanded.includes(batch.id);
        const visible = open ? rows : rows.slice(0, 3);
        return (
          <section className="batch-menu glass-card" key={batch.id}>
            <div className="batch-menu-head">
              <b>
                Партия {batch.index + 1} · {formatDate(batch.start)} —{" "}
                {formatDate(batch.end)}
              </b>
              <span>
                {withPlural(
                  batch.days *
                    mealSlots.reduce(
                      (sum, slot) => sum + relevantPeople(people, slot).length,
                      0,
                    ),
                  FORMS.portion,
                )}
              </span>
            </div>
            <div className="batch-menu-rows">
              {visible.map(({ slot, key, recipe }, index) => {
                const isPinned = pinned.includes(key);
                return (
                  <div
                    className={`menu-row${isPinned ? " is-pinned" : ""}`}
                    key={key}
                  >
                    <span className={`menu-row-art art-${index % 5}`} aria-hidden>
                      {recipe.emoji}
                    </span>
                    <div>
                      <small>
                        {mealMeta[slot].label}
                        {isPinned
                          ? " · заменено вами"
                          : ` · ${withPlural(batch.days * relevantPeople(people, slot).length, FORMS.portion)}`}
                      </small>
                      <b>{recipe.title}</b>
                    </div>
                    <button
                      className="menu-swap"
                      aria-label={`Заменить блюдо: ${mealMeta[slot].label}, ${recipe.title}`}
                      onClick={() => setReplacing({ key, batch, slot })}
                    >
                      <Icon name="repeat" size={16} />
                    </button>
                  </div>
                );
              })}
              {rows.length > 3 && (
                <button
                  className="batch-menu-more"
                  onClick={() =>
                    setExpanded((current) =>
                      open
                        ? current.filter((id) => id !== batch.id)
                        : [...current, batch.id],
                    )
                  }
                >
                  <span>
                    {open
                      ? "Свернуть"
                      : `и ещё ${withPlural(rows.length - 3, FORMS.dish)}`}
                  </span>
                  <span className="menu-more-action">
                    {open ? "скрыть" : "показать"}
                  </span>
                </button>
              )}
            </div>
          </section>
        );
      })}

      {freeze.portions > 0 && freeze.shortest && (
        <Note tone="mint" icon={<Icon name="snowflake" />}>
          {freeze.shortest.title} хранится {withPlural(
            freeze.shortest.storageDays,
            FORMS.day,
          )} — {withPlural(freeze.portions, FORMS.portion)} уйдут в морозилку,
          напомним переложить накануне.
        </Note>
      )}

      <p className="onboarding-fineprint">
        КБЖУ и сроки хранения — ориентиры, а не медицинская гарантия.
      </p>

      <div className="chip-row menu-actions">
        <button className="chip" role="checkbox" aria-checked={false} onClick={onReassemble}>
          Собрать заново
        </button>
        <button className="chip" disabled title="Ручной режим появится позже">
          Выбрать вручную
        </button>
      </div>

      {replacing && (
        <Sheet
          titleId="menu-replace-title"
          onClose={() => setReplacing(null)}
          className="replace-sheet glass"
        >
          <div className="sheet-head">
            <h2 id="menu-replace-title">
              {mealMeta[replacing.slot].label} · партия {replacing.batch.index + 1}
            </h2>
          </div>
          <div className="replace-list" role="radiogroup" aria-label="Чем заменить">
            {candidateRecipes(replacing.slot, style, people, replacing.batch.days, {
              limit: 6,
              includeDisliked,
            }).map((recipe, index) => {
              const active = selections[replacing.key] === recipe.id;
              return (
                <button
                  key={recipe.id}
                  className="replace-option glass-3"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    onReplace(replacing.key, recipe.id);
                    setReplacing(null);
                  }}
                >
                  <span className={`menu-row-art art-${index % 5}`} aria-hidden>
                    {recipe.emoji}
                  </span>
                  <div>
                    <b>{recipe.title}</b>
                    <small>
                      {recipe.macros.kcal} ккал · {recipe.time} мин · совпадение{" "}
                      {fitScore(recipe, people, replacing.slot)}%
                    </small>
                  </div>
                  {active && <Icon name="check" size={16} />}
                </button>
              );
            })}
          </div>
          {(() => {
            const hidden = Math.max(
              0,
              candidateRecipes(replacing.slot, style, people, replacing.batch.days, {
                limit: "all",
                includeDisliked: true,
              }).length -
                candidateRecipes(replacing.slot, style, people, replacing.batch.days, {
                  limit: "all",
                }).length,
            );
            if (!hidden) return null;
            return (
              <button
                className="btn btn-secondary"
                aria-pressed={includeDisliked}
                onClick={() => setIncludeDisliked((value) => !value)}
              >
                {includeDisliked
                  ? "Скрыть варианты из «не люблю»"
                  : `Показать варианты из «не люблю» — ${hidden}`}
              </button>
            );
          })()}
        </Sheet>
      )}
    </>
  );
}

function ReviewStep({
  plan,
  onEdit,
}: {
  plan: ActivePlan;
  onEdit: (step: number) => void;
}) {
  const recipeIds = new Set(Object.values(plan.selections));
  const totalPortions = totalPlanPortions(plan);
  return (
    <>
      <StepIntro
        icon={<Icon name="check" />}
        kicker="Почти готово"
        title="Проверьте план"
        text="После сохранения он появится в неделе, а продукты — в покупках."
      />
      <section className="review-hero glass-card">
        <div>
          <p className="kicker">
            {formatDate(plan.start)} — {formatDate(plan.end)}
          </p>
          <h2>
            {plan.periodDays} дней · {plan.people.length} чел.
          </h2>
        </div>
        <div className="review-stats">
          <p>
            <b>{plan.batches.length}</b>
            <small>готовки</small>
          </p>
          <p>
            <b>{recipeIds.size}</b>
            <small>{plural(recipeIds.size, FORMS.recipe)}</small>
          </p>
          <p>
            <b>{totalPortions}</b>
            <small>{plural(totalPortions, FORMS.portion)}</small>
          </p>
          <p>
            <b>{plan.shopping.length}</b>
            <small>продуктов</small>
          </p>
        </div>
      </section>
      <section className="review-list glass-card">
        <button onClick={() => onEdit(0)}>
          <Icon name="clock" />
          <div>
            <b>Период</b>
            <small>
              {formatDate(plan.start)} — {formatDate(plan.end)}
            </small>
          </div>
          <i>Изменить</i>
        </button>
        <button onClick={() => onEdit(3)}>
          <Icon name="person" />
          <div>
            <b>Люди и КБЖУ</b>
            <small>{plan.people.map((person) => person.name).join(", ")}</small>
          </div>
          <i>Изменить</i>
        </button>
        <button onClick={() => onEdit(4)}>
          <Icon name="pot" />
          <div>
            <b>График готовки</b>
            <small>
              Каждые {plan.cookEveryDays} дн. · {plan.batches.length} блока
            </small>
          </div>
          <i>Изменить</i>
        </button>
        <button onClick={() => onEdit(5)}>
          <Icon name="check" />
          <div>
            <b>Выбранное меню</b>
            <small>{Object.keys(plan.selections).length} позиций</small>
          </div>
          <i>Изменить</i>
        </button>
      </section>
      <section className="shopping-preview glass-card">
        <div className="group-title">
          <h3>Покупки</h3>
          <span>{plan.shopping.length}</span>
        </div>
        {plan.shopping.slice(0, 5).map((item) => (
          <p key={item.key}>
            <span>{item.name}</span>
            <b>
              {item.quantity.toLocaleString("ru-RU")} {item.unit}
            </b>
          </p>
        ))}
        {plan.shopping.length > 5 && (
          <small>и ещё {plan.shopping.length - 5} продуктов</small>
        )}
      </section>
    </>
  );
}

const focusableSelector =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Sheet({
  titleId,
  onClose,
  className,
  children,
}: {
  titleId: string;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const inertSiblings = Array.from(document.body.children).filter(
      (node) => node !== backdropRef.current,
    );
    inertSiblings.forEach((node) => node.setAttribute("inert", ""));
    dialogRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const node = dialogRef.current;
        if (!node) return;
        const focusable = Array.from(
          node.querySelectorAll<HTMLElement>(focusableSelector),
        );
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      inertSiblings.forEach((node) => node.removeAttribute("inert"));
      opener?.focus();
    };
  }, [onClose]);

  return createPortal(
    // The backdrop's click-to-dismiss is a mouse-only convenience layered on
    // top of a fully keyboard-accessible dialog — Escape (handled above) is
    // the keyboard equivalent for the same action, so the backdrop itself
    // intentionally stays out of the tab order.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="modal-backdrop"
      ref={backdropRef}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}

function SuccessSheet({
  plan,
  onOpen,
  onEdit,
}: {
  plan: ActivePlan;
  onOpen: (tab: Tab) => void;
  onEdit: () => void;
}) {
  const [phase, setPhase] = useState<"summary" | "notifications">("summary");
  return (
    <Sheet
      titleId={phase === "summary" ? "success-title" : "notifications-title"}
      onClose={() => onOpen("week")}
      className={`success-sheet glass ${phase === "notifications" ? "notification-modal" : ""}`}
    >
      {phase === "summary" ? (
        <>
          <div className="success-burst">
            <Icon name="check" size={28} />
          </div>
          <p className="kicker">Всё получилось</p>
          <h2 id="success-title">План готов!</h2>
          <p>
            Дней: {plan.periodDays} · готовок: {plan.batches.length} ·
            рецептов: {new Set(Object.values(plan.selections)).size} ·
            продуктов: {plan.shopping.length}
          </p>
          <InstallInline />
          <button
            className="primary-button"
            onClick={() => setPhase("notifications")}
          >
            Настроить напоминания <Icon name="chevron" size={16} />
          </button>
          <button className="secondary-button" onClick={() => onOpen("week")}>
            Открыть план без них
          </button>
          <button className="text-button" onClick={onEdit}>
            Изменить план
          </button>
        </>
      ) : (
        <NotificationSetupPanel
          plan={notificationPlanFor(plan)}
          clientId={clientId()}
          deviceId={deviceId()}
          onDone={() => onOpen("week")}
          onCancel={() => onOpen("week")}
        />
      )}
    </Sheet>
  );
}

function RecipeView({
  context,
  onBack,
  onChangePlan,
}: {
  context: RecipeContext;
  onBack: () => void;
  onChangePlan?: (plan: ActivePlan) => Promise<void>;
}) {
  const { recipe, batch, slot, plan } = context;
  const [section, setSection] = useState<"ingredients" | "steps" | "portion">(
    batch ? "portion" : "ingredients",
  );
  const eaters =
    batch && slot && plan
      ? plan.people.filter((person) => person.includedSlots.includes(slot))
      : [];
  const [personId, setPersonId] = useState(eaters[0]?.id ?? "");
  const person = eaters.find((item) => item.id === personId) ?? eaters[0];
  const automaticTuning =
    person && slot
      ? portionFor(person, slot, recipe).ratios
      : { protein: 1, fat: 1, carbs: 1 };
  const savedTuning =
    person && batch && slot
      ? plan?.tuning?.[tuningKey(batch, slot, person)]
      : undefined;
  const [draft, setDraft] = useState<RecipeTuning>(
    savedTuning ?? automaticTuning,
  );
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [cookedWeights, setCookedWeights] = useState<Record<string, number>>(
    {},
  );
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  });
  useEffect(() => {
    history.pushState({ mise: "recipe" }, "");
    const onPop = () => backRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (section === "steps" && plan && batch)
      void trackAnalytics("cooking_instructions_opened");
  }, [batch, plan, section]);
  const preview =
    person && slot ? portionFor(person, slot, recipe, draft) : null;
  const displayMacros: Macros = preview?.actual ?? {
    protein: round(recipe.macros.protein * draft.protein),
    fat: round(recipe.macros.fat * draft.fat),
    carbs: round(recipe.macros.carbs * draft.carbs),
    kcal: round(
      recipe.macros.kcal +
        recipe.macros.protein * (draft.protein - 1) * 4 +
        recipe.macros.fat * (draft.fat - 1) * 9 +
        recipe.macros.carbs * (draft.carbs - 1) * 4,
    ),
  };
  const freezeDays =
    batch && recipe.freezable
      ? Math.max(0, batch.days - recipe.storageDays)
      : 0;
  const contactWarnings =
    plan && batch ? crossContactWarnings(plan, batch) : [];
  const originLabel =
    recipe.provenance.kind === "parsed"
      ? "Из источника"
      : "Сгенерирован и отредактирован";
  const components = portionComponents(recipe);
  const allocationPeople: PersonAllocation[] =
    batch && slot
      ? eaters.map((eater) => {
          const portion = portionFor(
            eater,
            slot,
            recipe,
            eater.id === person?.id
              ? draft
              : plan?.tuning?.[tuningKey(batch, slot, eater)],
          );
          return {
            personId: eater.id,
            label: eater.name,
            portionCount: batch.days,
            nutritionShare: Math.max(1, portion.grams * batch.days),
            componentShares: Object.fromEntries(
              components.map((component) => [
                component.id,
                Math.max(
                  1,
                  component.ingredients.reduce(
                    (sum, ingredient) =>
                      sum +
                      ingredient.quantity *
                        ingredientScaleFor(ingredient, portion),
                    0,
                  ) * batch.days,
                ),
              ]),
            ),
          };
        })
      : [];
  const mixedAllocation =
    batch && slot && plan && components.length === 0 && cookedWeights.total > 0
      ? allocateMixedDish(cookedWeights.total, allocationPeople)
      : null;
  const componentAllocation =
    batch &&
    slot &&
    plan &&
    components.length > 0 &&
    components.every((component) => cookedWeights[component.id] > 0)
      ? allocateComponentDish(
          components.map((component) => ({
            componentId: component.id,
            label: component.label,
            cookedWeightG: cookedWeights[component.id],
          })),
          allocationPeople,
        )
      : null;
  function selectPerson(nextId: string) {
    setPersonId(nextId);
    const nextPerson = eaters.find((item) => item.id === nextId);
    if (!nextPerson || !batch || !slot) return;
    setDraft(
      plan?.tuning?.[tuningKey(batch, slot, nextPerson)] ??
        portionFor(nextPerson, slot, recipe).ratios,
    );
    setSaveStatus("idle");
  }
  function updateDraft(key: keyof RecipeTuning, value: number) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveStatus("idle");
  }
  async function saveTuning() {
    if (!plan || !batch || !slot || !person || !onChangePlan) return;
    setSaveStatus("saving");
    const next: ActivePlan = {
      ...plan,
      tuning: { ...plan.tuning, [tuningKey(batch, slot, person)]: draft },
    };
    next.shopping = buildShopping(next);
    try {
      await onChangePlan(next);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }
  function totalIngredientScale(ingredient: Ingredient) {
    if (!batch || !slot || !plan) return ingredientRatioFor(ingredient, draft);
    return (
      eaters.reduce((sum, eater) => {
        const eaterTuning =
          eater.id === person?.id
            ? draft
            : plan.tuning?.[tuningKey(batch, slot, eater)];
        return (
          sum +
          ingredientScaleFor(
            ingredient,
            portionFor(eater, slot, recipe, eaterTuning),
          )
        );
      }, 0) * batch.days
    );
  }
  const recipeFamily = recipeFamiliesById[recipe.id];
  const displaySteps = recipeFamily
    ? materializeInstructions(
        recipeFamily,
        Object.fromEntries(
          recipe.ingredients.map((ingredient) => [
            ingredient.id,
            ingredient.quantity * totalIngredientScale(ingredient),
          ]),
        ),
      )
    : recipe.steps;
  return (
    <main className="app-shell recipe-detail">
      <div className="ambient ambient-one" />
      <header className="detail-header">
        <button
          className="icon-button glass"
          onClick={() => {
            history.back();
            window.setTimeout(() => backRef.current(), 250);
          }}
          aria-label="Назад"
        >
          <Icon name="chevron" className="back-chevron" />
        </button>
        <span className="glass">
          {recipe.effort.activeMinutes} мин активно · {recipe.time} всего
        </span>
      </header>
      <section className="detail-hero">
        <div className="detail-food glass">
          <span>{recipe.emoji}</span>
        </div>
        <p className="kicker">
          {mealMeta[recipe.slot].label} · {originLabel}
        </p>
        <h1>{recipe.title}</h1>
        <div className="detail-macros">
          {(["kcal", "protein", "fat", "carbs"] as MacroKey[]).map((key) => (
            <span key={key}>
              <b>{displayMacros[key]}</b>
              <small>
                {macroLabels[key]}
                {key === "kcal" ? "кал" : ""}
              </small>
            </span>
          ))}
        </div>
      </section>
      {recipe.allergens.length > 0 && (
        <section className="recipe-allergens glass-card">
          <p className="kicker">Метки каталога</p>
          <h2>Аллергены в рецепте</h2>
          <div className="allergen-badges">
            {recipe.allergens.map((allergen) => (
              <span key={allergen}>{allergenMeta[allergen].label}</span>
            ))}
          </div>
          <p>
            Эти метки не учитывают возможные следы в конкретной упаковке.
          </p>
        </section>
      )}
      {contactWarnings.length > 0 && (
        <section className="allergy-warning glass-card" role="alert">
          <span>!</span>
          <div>
            <h3>Общая готовка: перекрёстный контакт</h3>
            <p>
              {contactWarnings
                .map(
                  ({ person: eater, allergen }) =>
                    `${allergenMeta[allergen].short} — нельзя ${eater.name}`,
                )
                .join("; ")}. Разделите инвентарь и поверхности.
            </p>
          </div>
        </section>
      )}
      <section className="macro-tuner glass-card">
        <div className="tuner-heading">
          <div>
            <p className="kicker">Гибкая порция</p>
            <h2>Подстройка КБЖУ</h2>
          </div>
          {person && (
            <select
              aria-label="Для кого настроить порцию"
              value={person.id}
              onChange={(event) => selectPerson(event.target.value)}
            >
              {eaters.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="tuner-copy">
          {person
            ? "База уже подогнана под цель. Здесь можно докрутить состав порции в разумных пределах."
            : "Попробуйте базовую порцию. В плане Mise начнёт с цели каждого человека."}
        </p>
        <div className="tuner-controls">
          {(
            [
              {
                key: "protein",
                label: "Белковая часть",
                value: displayMacros.protein,
                range: recipe.flex.protein,
              },
              {
                key: "carbs",
                label: "Гарнир",
                value: displayMacros.carbs,
                range: recipe.flex.carbs,
              },
              {
                key: "fat",
                label: "Жиры и соус",
                value: displayMacros.fat,
                range: recipe.flex.fat,
              },
            ] as const
          ).map((control) => (
            <label key={control.key} aria-label={control.label}>
              <span>
                <b>{control.label}</b>
                <em>
                  {Math.round(draft[control.key] * 100)}% · {control.value} г
                </em>
              </span>
              <input
                type="range"
                min={control.range[0]}
                max={control.range[1]}
                step="0.05"
                value={draft[control.key]}
                onChange={(event) =>
                  updateDraft(control.key, Number(event.target.value))
                }
              />
            </label>
          ))}
        </div>
        <div className="tuner-actions">
          <button
            className="secondary-button"
            onClick={() => {
              setDraft(automaticTuning);
              setSaveStatus("idle");
            }}
          >
            {person ? "Вернуть к цели" : "Сбросить"}
          </button>
          {person && (
            <button
              className="primary-button"
              disabled={saveStatus === "saving"}
              onClick={saveTuning}
            >
              {saveStatus === "saving" ? (
                "Сохраняем…"
              ) : saveStatus === "saved" ? (
                <>
                  Сохранено <Icon name="check" size={12} />
                </>
              ) : (
                "Сохранить и пересчитать"
              )}
            </button>
          )}
        </div>
        {saveStatus === "saved" && (
          <p className="tuner-saved" role="status">
            Порция сохранена — список покупок пересчитан.
          </p>
        )}
        {saveStatus === "error" && (
          <Note tone="warn" role="alert">
            Не удалось сохранить. Изменения не попали в план.
          </Note>
        )}
      </section>
      <section className="recipe-info-grid">
        <article className="glass-card">
          <Icon name="flame" />
          <div>
            <b>
              {recipe.effort.level === "low"
                ? "Низкая сложность"
                : "Высокая сложность"}
            </b>
            <small>
              {recipe.effort.knifeActions} нарезки · {recipe.effort.cookware}{" "}
              ед. посуды · {recipe.effort.activeActions} действий
            </small>
          </div>
        </article>
        <article className="glass-card">
          <Icon name="clock" />
          <div>
            <b>{recipe.effort.activeMinutes} мин активно</b>
            <small>{recipe.time} мин общего времени</small>
          </div>
        </article>
      </section>
      <section className="detail-panel glass-card">
        <div className="detail-tabs" role="tablist" aria-label="Раздел рецепта">
          <button
            role="tab"
            aria-selected={section === "ingredients"}
            className={section === "ingredients" ? "selected" : ""}
            onClick={() => setSection("ingredients")}
          >
            Ингредиенты
          </button>
          <button
            role="tab"
            aria-selected={section === "steps"}
            className={section === "steps" ? "selected" : ""}
            onClick={() => setSection("steps")}
          >
            Готовить
          </button>
          <button
            role="tab"
            aria-selected={section === "portion"}
            className={section === "portion" ? "selected" : ""}
            onClick={() => setSection("portion")}
          >
            Разложить
          </button>
        </div>
        {section === "ingredients" && (
          <div className="detail-list">
            <Note
              tone="mint"
              icon={<Icon name="scale" />}
              label={
                batch
                  ? `На ${batch.days} дн. · ${eaters.length} чел.`
                  : "На одну базовую порцию"
              }
            >
              Количество меняется вместе с рычагами КБЖУ
            </Note>
            {recipe.ingredients.map((ingredient) => {
              const totalScale = totalIngredientScale(ingredient);
              return (
                <div className="ingredient-row" key={ingredient.id}>
                  <Icon name="check" />
                  <p>
                    {ingredient.name}
                    <small>
                      {ingredient.group}
                      {ingredient.allergens.length > 0
                        ? ` · ${ingredient.allergens
                            .map((allergen) => allergenMeta[allergen].short)
                            .join(", ")}`
                        : ""}
                      {ingredient.checkLabel
                        ? " · проверить этикетку/следы"
                        : ""}
                    </small>
                  </p>
                  <b>
                    {ingredient.unit === "шт."
                      ? round(ingredient.quantity * totalScale, 1)
                      : round((ingredient.quantity * totalScale) / 5) * 5}{" "}
                    {ingredient.unit}
                  </b>
                </div>
              );
            })}
          </div>
        )}
        {section === "steps" && (
          <ol className="cooking-steps">
            {displaySteps.map((text, index) => (
              <li key={`${text}-${index}`}>
                <span>{index + 1}</span>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        )}
        {section === "portion" && (
          <div className="portion-section">
            {batch && slot && plan ? (
              <>
                <Note tone="mint" icon={<Icon name="scale" />} label="Сначала взвесьте готовую еду">Затем введите фактический вес — Mise сам рассчитает раскладку. После расчёта подпишите имя, приём пищи и даты.</Note>
                {components.length === 0 ? (
                  <label className="cooked-weight-field"><span>Взвесьте всё готовое блюдо</span><span className="weight-control"><input aria-label="Фактический вес готового блюда" type="number" inputMode="numeric" min="1" value={cookedWeights.total || ""} onChange={(event) => setCookedWeights({ total: Number(event.target.value) })} /><small>г</small></span></label>
                ) : (
                  <div className="component-weight-fields"><p>Взвесьте готовые компоненты отдельно</p>{components.map((component) => <label className="cooked-weight-field" key={component.id}><span>{component.label}</span><span className="weight-control"><input aria-label={`Фактический вес: ${component.label}`} type="number" inputMode="numeric" min="1" value={cookedWeights[component.id] || ""} onChange={(event) => setCookedWeights((current) => ({ ...current, [component.id]: Number(event.target.value) }))} /><small>г</small></span></label>)}</div>
                )}
                {!mixedAllocation && !componentAllocation && <p className="allocation-prompt" role="status">Введите {components.length ? "вес каждого компонента" : "вес блюда"}, чтобы увидеть точную раскладку.</p>}
                {mixedAllocation && <div className="allocation-results"><Note tone="mint" icon={<Icon name="container" />} label="Теперь разложите по контейнерам">Граммы рассчитаны из фактического веса всей готовой партии.</Note>{mixedAllocation.allocations.map((allocation, index) => <article className="portion-card" key={allocation.personId}><div className={`person-dot tone-${index}`}>{allocation.label.slice(0, 1)}</div><div><h3>{allocation.label}</h3><p><b>{allocation.perContainerG.length} × {allocation.perContainerG[0]} г</b></p><small>В каждый контейнер</small><em>Подпись: {allocation.label} / {mealMeta[slot].label.toLowerCase()} / {formatDate(batch.start)}–{formatDate(batch.end)}</em></div></article>)}</div>}
                {componentAllocation && <div className="allocation-results"><Note tone="mint" icon={<Icon name="container" />} label="Теперь разложите компоненты">Никаких процентов — только граммы в каждый контейнер.</Note>{eaters.map((eater, index) => <article className="portion-card component-portion-card" key={eater.id}><div className={`person-dot tone-${index}`}>{eater.name.slice(0, 1)}</div><div><h3>{eater.name}</h3>{componentAllocation.components.map((component) => { const allocation = component.allocations.find((item) => item.personId === eater.id); return <p key={component.componentId}><span>{component.label}</span><b>{allocation?.perContainerG[0] ?? 0} г</b></p>; })}<small>В каждый из {batch.days} контейнеров</small><em>Подпись: {eater.name} / {mealMeta[slot].label.toLowerCase()} / {formatDate(batch.start)}–{formatDate(batch.end)}</em></div></article>)}</div>}
                <Note
                  tone="mint"
                  icon={
                    freezeDays > 0 ? (
                      <Icon name="snowflake" />
                    ) : (
                      <Icon name="check" />
                    )
                  }
                  label={
                    freezeDays > 0
                      ? "Часть порций заморозить"
                      : recipe.storage.ambient
                        ? "Хранить в сухой банке"
                        : "Хранить в холодильнике"
                  }
                >
                  {freezeDays > 0
                    ? `Оставьте на ${recipe.storageDays} дня в холодильнике, ещё ${freezeDays} порц. каждого человека заморозьте.`
                    : (recipe.storage.ambient ??
                      `Ориентир для холодильника — до ${recipe.storageDays} дней.`)}
                </Note>
              </>
            ) : (
              <Note
                tone="mint"
                icon={<Icon name="info" />}
                label="Точная раскладка появится в плане"
              >
                Мы учтём КБЖУ и цели каждого человека.
              </Note>
            )}
          </div>
        )}
      </section>
      <section className="label-reminder glass-card">
        <span>i</span>
        <p>
          <b>Проверьте конкретный продукт</b>
          <small>
            Сверьте состав и пометку «может содержать следы» на каждой
            упаковке. Mise не заявляет медицинскую безопасность блюда.
          </small>
        </p>
      </section>
      <section className="recipe-storage glass-card">
        <p className="kicker">Ориентиры хранения</p>
        <h2>
          {recipe.storage.ambient
            ? `Сухое хранение — до ${recipe.storageDays} дн.`
            : recipe.freezable
              ? `Холодильник ${recipe.storageDays} дн. или заморозка`
              : `Только холодильник — до ${recipe.storageDays} дн.`}
        </h2>
        <p>{recipe.storage.ambient ?? recipe.storage.refrigerator}</p>
        {recipe.storage.freezer && (
          <p>
            <b>
              Морозилка
              {recipe.storage.freezerDays
                ? ` — до ${recipe.storage.freezerDays} дней`
                : ""}
              :
            </b>{" "}
            {recipe.storage.freezer}
          </p>
        )}
        {recipe.storage.freezeParts && (
          <p>
            <b>Что замораживать:</b> {recipe.storage.freezeParts}
          </p>
        )}
        {recipe.storage.thaw && (
          <p>
            <b>Как разморозить:</b> {recipe.storage.thaw}
          </p>
        )}
        <small>Сроки — консервативные ориентиры, а не гарантия.</small>
      </section>
      <section className="recipe-source glass-card">
        <p className="kicker">Происхождение</p>
        <h2>{originLabel}</h2>
        {recipe.provenance.kind === "parsed" ? (
          <>
            <a
              href={recipe.provenance.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {recipe.provenance.sourceTitle} <Icon name="chevron" size={12} />
            </a>
            {recipe.provenance.adaptation && (
              <p>Адаптация для Mise: {recipe.provenance.adaptation}</p>
            )}
            <small>Найдено по запросу «{recipe.provenance.sourceQuery}».</small>
          </>
        ) : (
          <>
            <p>Рецепт собран для курированного каталога Mise.</p>
            <small>
              {recipe.provenance.basedOn?.length
                ? `Опирается на ${recipe.provenance.basedOn.length} отобранных источника.`
                : "Без внешнего рецепта-прототипа."}
            </small>
          </>
        )}
      </section>
    </main>
  );
}
