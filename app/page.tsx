"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NotificationSetupPanel, type NotificationPlan } from "./notification-setup";
import { countRu } from "./format";

type Tab = "week" | "recipes" | "builder" | "shopping" | "profile";
type MealSlot = "breakfast" | "lunch" | "dinner" | "snack1" | "snack2";
type MenuStyle = "protein" | "budget" | "paleo" | "keto";
type RecipeOrigin = "parsed" | "generated";
type MacroKey = "kcal" | "protein" | "fat" | "carbs";
type Macros = Record<MacroKey, number>;
type MacroPreset = "balanced" | "protein" | "carbs" | "fat" | "custom";
type MacroPresetOption = Exclude<MacroPreset, "custom">;

type Ingredient = { id: string; name: string; quantity: number; unit: "г" | "мл" | "шт."; group: string };
type RecipeProvenance = { kind: "parsed"; sourceTitle: string; sourceUrl: string; sourceQuery: string; adaptation?: string; imageUrl?: string; imageAlt?: string } | { kind: "generated"; basedOn?: string[] };
type RecipeStorage = { refrigerator: string; ambient?: string; freezer: string; thaw: string; freezerDays?: number; freezeParts: string };
type RecipeFlex = { protein: [number, number]; fat: [number, number]; carbs: [number, number] };
type RecipeEffort = { level: "low" | "high"; knifeActions: number; cookware: number; activeActions: number; activeMinutes: number };
type RecipeLocalization = { fit: "familiar" | "adapted" | "niche"; availability: "common" | "specialty"; note?: string };
type RecipePacking = { portion: string; separate?: string; label: string };
type Recipe = { id: string; slot: MealSlot; title: string; emoji: string; time: number; macros: Macros; servingWeight: number; cost: number; tags: MenuStyle[]; ingredients: Ingredient[]; steps: string[]; storageDays: number; freezable: boolean; provenance: RecipeProvenance; storage: RecipeStorage; packing: RecipePacking; flex: RecipeFlex; effort: RecipeEffort; localization: RecipeLocalization };
type RecipeTuning = { protein: number; fat: number; carbs: number };
type Person = { id: string; name: string; daily: Macros; macroPreset?: MacroPreset; includedSlots: MealSlot[] };
type Batch = { id: string; index: number; start: string; end: string; days: number };
type ShoppingItem = Ingredient & { key: string; checked: boolean };
type ActivePlan = { id: string; createdAt: string; start: string; end: string; periodDays: number; cookEveryDays: number; menuStyle: MenuStyle; mealSlots: MealSlot[]; people: Person[]; batches: Batch[]; selections: Record<string, string>; tuning?: Record<string, RecipeTuning>; shopping: ShoppingItem[] };
type RecipeContext = { recipe: Recipe; batch?: Batch; slot?: MealSlot; plan?: ActivePlan };
type BuilderEntry = { step: number; batchId?: string; returnTab?: Exclude<Tab, "builder"> };
type OnboardingStep = "welcome" | "guide" | "install" | "prep-offer" | "prep-guide" | "done";

const onboardingStorageKey = "mise-onboarding-v2";
const installOfferStorageKey = "mise-install-offer-v1";
const prepGuideStorageKey = "mise-prep-guide-offer-v1";

const mealMeta: Record<MealSlot, { label: string; short: string; icon: string }> = {
  breakfast: { label: "Завтрак", short: "Завтрак", icon: "☀️" }, lunch: { label: "Обед", short: "Обед", icon: "🥗" }, dinner: { label: "Ужин", short: "Ужин", icon: "🌙" }, snack1: { label: "Перекус 1", short: "Перекус 1", icon: "🍏" }, snack2: { label: "Перекус 2", short: "Перекус 2", icon: "🥛" },
};
const styleMeta: Record<MenuStyle, { label: string; icon: string; description: string }> = {
  protein: { label: "Высокобелковое", icon: "💪", description: "Больше белка для сытости и восстановления" }, budget: { label: "Бюджетное", icon: "◒", description: "Простые продукты и разумная стоимость" }, paleo: { label: "Палео", icon: "🌿", description: "Мясо, рыба, овощи — без зерновых" }, keto: { label: "Кето", icon: "🥑", description: "Меньше углеводов, больше полезных жиров" },
};
const macroLabels: Record<MacroKey, string> = { kcal: "К", protein: "Б", fat: "Ж", carbs: "У" };
const macroPresetMeta: Record<MacroPresetOption, { label: string; description: string; protein: number; fat: number; carbs: number }> = {
  balanced: { label: "Сбалансировано", description: "Б 30% · Ж 30% · У 40%", protein: 0.3, fat: 0.3, carbs: 0.4 },
  protein: { label: "Больше белка", description: "Б 35% · Ж 30% · У 35%", protein: 0.35, fat: 0.3, carbs: 0.35 },
  carbs: { label: "Больше углеводов", description: "Б 25% · Ж 25% · У 50%", protein: 0.25, fat: 0.25, carbs: 0.5 },
  fat: { label: "Больше жиров", description: "Б 30% · Ж 40% · У 30%", protein: 0.3, fat: 0.4, carbs: 0.3 },
};
const defaultMacros: Macros = { kcal: 2100, protein: 158, fat: 70, carbs: 210 };
const i = (id: string, name: string, quantity: number, unit: Ingredient["unit"], group: string): Ingredient => ({ id, name, quantity, unit, group });
const noKnifeIngredientIds = new Set(["oats", "buckwheat", "rice", "brown-rice", "quinoa", "lentils", "white-beans", "red-beans", "pasta", "bulgur", "chia", "seeds", "cocoa", "milk", "kefir", "yogurt", "cottage", "cream", "egg", "oil", "olive-oil", "coconut-oil", "soy", "tomato-passata", "coconut-milk", "protein-powder"]);
function estimateEffort(title: string, time: number, ingredients: Ingredient[], steps: string[]): RecipeEffort {
  const knifeActions = ingredients.filter((ingredient) => !noKnifeIngredientIds.has(ingredient.id) && ingredient.group !== "Крупы").length;
  const text = `${title} ${steps.join(" ")}`.toLowerCase();
  const noCook = !/(?:вар|жар|печ|духов|туш|сковород|кастрюл)/.test(text);
  const onePot = /(?:одной кастрюл|одной форм|блендер)/.test(text);
  const cookware = noCook || onePot ? 1 : /(?:духов|запек).*(?:вар|сковород)|(?:вар|сковород).*(?:духов|запек)/.test(text) ? 3 : 2;
  const activeActions = steps.length + knifeActions;
  const activeMinutes = Math.min(time, Math.max(3, steps.length * 3 + knifeActions * 2));
  return { level: knifeActions + cookware + activeActions <= 9 ? "low" : "high", knifeActions, cookware, activeActions, activeMinutes };
}
type RecipeMeta = { provenance?: RecipeProvenance; storage?: Partial<RecipeStorage>; packing?: Partial<RecipePacking>; flex?: Partial<RecipeFlex>; effort?: Partial<RecipeEffort>; localization?: Partial<RecipeLocalization> };

function ingredientAmount(ingredient: Ingredient) {
  return `${ingredient.name} — ${ingredient.quantity} ${ingredient.unit}`;
}

function generatedRecipeSteps(title: string, ingredients: Ingredient[], totalMinutes: number) {
  const text = title.toLowerCase();
  const ingredientIds = new Set(ingredients.map((ingredient) => ingredient.id));
  const rawProteinIds = new Set(["chicken", "chicken-thigh", "chicken-mince", "turkey", "turkey-mince", "beef", "beef-mince", "pork-mince", "salmon", "cod"]);
  const rawProteins = ingredients.filter((ingredient) => rawProteinIds.has(ingredient.id));
  const produce = ingredients.filter((ingredient) => ingredient.group === "Овощи и фрукты");
  const measured = `На одну базовую порцию отмерьте: ${ingredients.map(ingredientAmount).join("; ")}.`;
  const finish = "Разделите готовое блюдо на равные порции по числу контейнеров; точная масса каждой порции указана во вкладке «Разложить».";

  if (/смузи/.test(text)) return [measured, "Сложите все компоненты в чашу блендера и пробейте до однородности; при необходимости добавляйте воду по 1 столовой ложке.", "Перелейте порцию в бутылку с плотной крышкой и сразу уберите в холодильник."];
  if (/чиа|пудинг|крем с какао/.test(text)) return [measured, "Смешайте жидкую основу с сухими компонентами венчиком, оставьте на 5 минут и перемешайте ещё раз, разбивая комки.", "Разложите по порционным банкам, добавки держите сверху или отдельно и дайте смеси загустеть в холодильнике."];
  if (/йогурт с|творог с огур|моцарелла с|яблоко с|яблочные дольки/.test(text)) return [measured, "Вымойте и обсушите свежие продукты; нарежьте их непосредственно перед раскладкой.", "Разложите основную часть и влажные либо хрустящие добавки по разным отделениям контейнера, чтобы смешать перед едой."];
  if (/тунец с хрустящ|ролл|рулет|тост/.test(text) && !/омлет-ролл/.test(text)) return [measured, "Подготовьте начинку: сырое мясо сначала приготовьте, готовые белковые продукты нарежьте; овощи обсушите и нарежьте тонко.", "Хлеб, лепёшку или внешнюю оболочку держите отдельно от влажной начинки и собирайте перед едой.", finish];
  if (/домашний хумус/.test(text)) return [measured, "Промойте нут, затем пробейте его с тахини, лимонным соком, оливковым маслом и чесноком до однородности.", "Добавьте 15 мл воды и ещё раз взбейте; переложите хумус в маленькую банку, а лепёшку держите отдельно.", finish];
  if (/конфет|шарик|жир-бомб|батончик/.test(text)) return rawProteins.length ? [measured, `Приготовьте ${rawProteins.map((ingredient) => ingredient.name.toLowerCase()).join(" и ")} до полной готовности, остудите и очень мелко нарежьте.`, "Смешайте белковую часть с остальными компонентами, сформуйте одинаковые шарики или батончики и охладите до плотности.", finish] : [measured, "Измельчите сухие компоненты, затем вмешайте связующую основу до пластичной массы; если масса мягкая, охладите её 10 минут.", "Сформуйте одинаковые шарики или утрамбуйте массу пластом и разрежьте на равные батончики.", finish];
  if (/сырник|панкейк|оладь/.test(text)) return [measured, "Измельчите хлопья, если они используются, и смешайте их с остальными компонентами до густого однородного теста.", "Сформуйте одинаковые заготовки и готовьте на антипригарной сковороде небольшими партиями до устойчивой формы и румяной поверхности с обеих сторон.", "Полностью остудите на решётке; крем, йогурт и свежие добавки упакуйте отдельно.", finish];
  if (/омлет-ролл/.test(text)) return [measured, "Приготовьте и мелко нарежьте начинку, яйца размешайте до однородности.", "Вылейте яйца тонким слоем на антипригарную сковороду, распределите начинку и сверните плотный рулет, когда основа схватится.", "Остудите рулет швом вниз, нарежьте поперёк и разложите поровну.", finish];
  if (/авокад.*яйц/.test(text)) return [measured, "Разрежьте авокадо пополам, удалите косточку и ложкой немного расширьте углубление.", "Положите половинки в небольшую форму, в каждое углубление аккуратно добавьте яйцо и запекайте при 180 °C до желаемой плотности.", "Остудите и упакуйте без переворачивания; это блюдо готовьте только для холодильника."];
  if (/омлет|фриттат|маффин|запеканк|брауни|печень|квадратик|суфле|крекер|запечённ.*яйц/.test(text)) {
    const preparation = rawProteins.length
      ? `Мелко нарежьте ${rawProteins.map((ingredient) => ingredient.name.toLowerCase()).join(" и ")} и приготовьте до полной готовности; овощи измельчите, яйца размешайте отдельно.`
      : produce.length
        ? `Нарежьте или натрите ${produce.map((ingredient) => ingredient.name.toLowerCase()).join(" и ")}; яйца и жидкие компоненты перемешайте отдельно.`
        : ingredientIds.has("egg")
          ? "Смешайте сухие компоненты, отдельно размешайте яйца, затем соедините обе части до однородности."
          : "Смешайте сухие и жидкие компоненты отдельно, затем соедините их до однородности.";
    return [measured, preparation, "Распределите смесь ровным слоем в форме или одинаково по ячейкам и запекайте при 180 °C до плотной середины и румяных краёв.", "Дайте заготовке остыть, выньте из формы и разделите на одинаковые части.", finish];
  }
  if (/тефтел|котлет|голубц|наггетс/.test(text)) return [measured, "Если есть крупа или картофель, приготовьте их отдельно; овощи мелко нарежьте или натрите.", "Смешайте фарш с компонентами для связки, сформуйте одинаковые тефтели, котлеты или наггетсы и приготовьте их до полной готовности выбранным способом.", "Соус прогрейте отдельно, затем соедините с мясной частью; гарнир оставьте в соседнем отделении контейнера.", finish];
  if (/карри|похл[её]б|чечевиц|туш[её]н|плов|фасол|сливочном соусе/.test(text)) return [measured, "Промойте крупу или бобовые; мясо и овощи нарежьте одинаковыми небольшими кусочками.", "Подрумяньте мясную часть, добавьте овощи, затем крупу или бобовые и жидкую основу; готовьте под крышкой до мягкости всех компонентов.", "Отрегулируйте густоту небольшим количеством воды, перемешайте и разделите блюдо поровну.", finish];
  if (/паста|лапш|гречк|булгур|киноа|рис/.test(text)) return [measured, "Отдельно приготовьте крупу, пасту или лапшу; мясо и овощи нарежьте удобными для одного укуса кусочками.", "Приготовьте белковую часть, добавьте овощи и соус, затем соедините с гарниром или оставьте компоненты рядом в контейнере.", "Дайте пару выйти в неглубокой посуде и разделите блюдо поровну, не утрамбовывая гарнир.", finish];
  if (/пюре/.test(text)) return [measured, "Нарежьте овощи, предназначенные для пюре, одинаковыми кусочками и приготовьте до мягкости; белковую часть подготовьте отдельно.", "Разомните овощи до нужной текстуры, а мясо или рыбу приготовьте до полной готовности.", "В контейнер положите пюре с одной стороны, белковую часть — с другой, не смешивая до разогрева.", finish];
  if (/лосос|треск|рыб|куриц|индейк|говядин|стейк|свинин|тофу/.test(text)) return [measured, "Нарежьте овощи одинаковыми кусочками, белковую часть обсушите и приправьте по вкусу.", `Приготовьте овощи и белковую часть на противне, сковороде или в сотейнике так, чтобы уложиться примерно в ${totalMinutes} минут общего времени.`, "Соус и свежие добавки держите отдельно; горячие компоненты разделите поровну.", finish];
  return [measured, "Подготовьте каждый компонент отдельно: промойте, обсушите и нарежьте продукты одинаковыми кусочками.", "Приготовьте компоненты до нужной текстуры, соединяя их только там, где это предусмотрено названием блюда.", finish];
}

function packingFor(title: string, ingredients: Ingredient[], servingWeight: number): RecipePacking {
  const text = title.toLowerCase();
  const ids = new Set(ingredients.map((ingredient) => ingredient.id));
  const label = `${title} · около ${servingWeight} г · дата и приём пищи`;
  if (/смузи/.test(text)) return { portion: `Одна порция — бутылка примерно на ${servingWeight} мл с запасом для взбалтывания.`, label };
  if (/чиа|пудинг|крем с какао|йогурт с/.test(text)) return { portion: `Одна порция — банка объёмом не меньше ${Math.ceil(servingWeight / 50) * 50} мл.`, separate: "Ягоды, семечки и хрустящие добавки положить в маленький сухой отсек.", label };
  if (/маффин|сырник|панкейк|олад|котлет|тефтел|наггетс|шарик|рулет|ролл|батончик|квадратик|печень|крекер|брауни|запеканк|фриттат|омлет/.test(text)) return { portion: "Сначала посчитайте все готовые изделия или куски, затем разделите их поровну между контейнерами.", separate: ids.has("yogurt") || ids.has("cream-cheese") || ids.has("hummus") ? "Соус или крем — в отдельную маленькую ёмкость; лепёшку и свежие овощи не прижимать к влажной начинке." : undefined, label };
  const hasFresh = ["avocado", "cucumber", "tomato", "greens", "lettuce", "berries"].some((id) => ids.has(id));
  const hasBase = ["rice", "brown-rice", "buckwheat", "quinoa", "pasta", "bulgur", "potato", "sweet-potato"].some((id) => ids.has(id));
  const mixedDish = /паста|макарон|лапш|карри|плов|похл[её]б|туш[её]н|чечевиц|фасол|запеканк/.test(text);
  return { portion: `Одна готовая порция — ориентировочно ${servingWeight} г; при нескольких контейнерах сначала взвесьте всё блюдо и разделите массу поровну.`, separate: hasBase && !mixedDish ? "Гарнир занимает одно отделение, белковая часть и приготовленные овощи — другое." : hasFresh ? "Свежие добавки держите в отдельном отсеке и добавляйте после разогрева основной части." : undefined, label };
}

function storageFor(storageDays: number, freezable: boolean, ingredients: Ingredient[]): RecipeStorage {
  const freshIds = new Set(["avocado", "cucumber", "tomato", "greens", "lettuce", "berries", "yogurt", "hummus"]);
  const separate = ingredients.some((ingredient) => freshIds.has(ingredient.id));
  if (!freezable) return {
    refrigerator: `В закрытом контейнере при ≤4 °C — ориентировочно до ${storageDays} суток.`,
    freezer: "Не замораживать: после разморозки заметно пострадает текстура блюда.",
    thaw: "Разморозка не предусмотрена; готовьте только объём для холодильного хранения.",
    freezeParts: "Заморозка не предусмотрена.",
  };
  return {
    refrigerator: `В закрытом контейнере при ≤4 °C — ориентировочно до ${storageDays} суток.`,
    freezer: "Разложить в неглубокие порционные контейнеры, охладить в холодильнике и перенести предназначенные для заморозки порции в морозилку.",
    thaw: "Переложить порцию в холодильник накануне; после размораживания разогреть перед подачей.",
    freezerDays: 60,
    freezeParts: separate ? "Замораживать приготовленную основу; свежие овощи, зелень, ягоды и холодные соусы упаковать отдельно и не замораживать вместе с ней." : "Замораживать готовую порцию целиком в подписанном контейнере.",
  };
}

const r = (id: string, slot: MealSlot, title: string, emoji: string, time: number, macros: Macros, servingWeight: number, cost: number, tags: MenuStyle[], ingredients: Ingredient[], suppliedSteps: string[], storageDays = 3, freezable = true, meta: RecipeMeta = {}): Recipe => {
  const steps = suppliedSteps.length ? [
    `На одну базовую порцию отмерьте: ${ingredients.map(ingredientAmount).join("; ")}.`,
    ...suppliedSteps,
    ...(suppliedSteps.some((step) => /контейнер|порци|банк|бутылк|замороз/i.test(step)) ? [] : ["Разделите готовое блюдо на равные порции; практическая схема упаковки указана во вкладке «Разложить»."]),
  ] : generatedRecipeSteps(title, ingredients, time);
  const packing = packingFor(title, ingredients, servingWeight);
  return {
    id, slot, title, emoji, time, macros, servingWeight, cost, tags, ingredients, steps, storageDays, freezable,
    provenance: meta.provenance ?? { kind: "generated" },
    localization: { fit: "familiar", availability: "common", ...meta.localization },
    flex: { protein: [0.8, 1.25], fat: [0.8, 1.2], carbs: [0.7, 1.3], ...meta.flex },
    effort: { ...estimateEffort(title, time, ingredients, steps), ...meta.effort },
    storage: { ...storageFor(storageDays, freezable, ingredients), ...meta.storage },
    packing: { ...packing, ...meta.packing },
  };
};
const commonSteps: string[] = [];

const recipeSources = {
  cottageBake: { title: "ПП творожная запеканка", url: "https://food.ru/recipes/66774-pp-tvorozhnaja-zapekanka", query: "пп питание" },
  syrniki: { title: "Диетические сырники из творога", url: "https://food.ru/recipes/1301-dieticheskie-syrniki-iz-tvoroga", query: "рецепты для похудения" },
  proteinOats: { title: "Protein overnight oats", url: "https://www.bbcgoodfood.com/recipes/protein-overnight-oats", query: "mealprep recipes", imageUrl: "https://images.immediate.co.uk/production/volatile/sites/30/2025/02/OvernightOats-bf5484f.jpg?quality=90&resize=708%2C643", imageAlt: "Ночная овсянка с ягодами" },
  chickenBuckwheat: { title: "Гречка с курицей ПП для похудения", url: "https://food.ru/recipes/106546-grechka-s-kuritsei-pp-dlia-pokhudeniia-1643971324", query: "рецепты для похудения" },
  chickenRice: { title: "Рис с курицей и овощами в рукаве", url: "https://food.ru/recipes/58187-ris-kuricei-i-ovoshchami-v-rukave", query: "пп питание" },
  chickenBowl: { title: "Naked Chicken Burrito Bowl Meal Prep", url: "https://www.myprotein.com/thezone/recipe/naked-chicken-burrito-bowl-meal-prep/", query: "меню на массу" },
  salmonPrep: { title: "Quick Spicy Cajun Salmon & Garlicky Veg", url: "https://us.myprotein.com/thezone/recipe/healthy-meals/salmon-meal-prep-spicy-cajun-salmon/", query: "меню на сушку" },
  turkeyMeatballs: { title: "Тефтели из индейки", url: "https://food.ru/recipes/125276-tefteli-iz-indeiki-1646231123", query: "пп питание" },
  onePotChicken: { title: "One-pot chicken & rice", url: "https://www.bbcgoodfood.com/recipes/one-pot-chicken-rice", query: "mealprep recipes" },
  berrySmoothie: { title: "Berry protein smoothie", url: "https://www.bbcgoodfood.com/recipes/berry-protein-smoothie", query: "mealprep recipes" },
  frozenYogurt: { title: "Instant frozen berry yogurt", url: "https://www.bbcgoodfood.com/recipes/instant-frozen-berry-yogurt", query: "рецепты для похудения" },
  tacoMac: { title: "Taco Mac", url: "https://mealprepmanual.com/taco-mac/", query: "mealprep recipes", imageUrl: "https://mealprepmanual.com/wp-content/uploads/2026/01/Taco-Mac-806x1024.jpg", imageAlt: "Макароны с говядиной, томатами и сыром в контейнере" },
  teriyakiTray: { title: "Sheet Pan Teriyaki Chicken and Vegetables", url: "https://mealprepmanual.com/sheet-pan-teriyaki-chicken-and-vegetables/", query: "mealprep recipes", imageUrl: "https://mealprepmanual.com/wp-content/uploads/2026/02/Sheet-Pan-Teriyaki-Chicken-807x1024.jpg", imageAlt: "Курица терияки с рисом, бататом и брокколи" },
  halalChicken: { title: "Halal Cart Style Chicken Buffet Prep", url: "https://mealprepmanual.com/halal-cart-style-chicken-buffet-prep/", query: "mealprep recipes", imageUrl: "https://mealprepmanual.com/wp-content/uploads/2025/05/Halal-Cart-Chicken-807x1024.jpg", imageAlt: "Пряная курица с золотым рисом, овощами и белым соусом" },
} as const;
type RecipeSource = { title: string; url: string; query: string; imageUrl?: string; imageAlt?: string };
const parsed = (source: RecipeSource, adaptation?: string): RecipeProvenance => ({ kind: "parsed", sourceTitle: source.title, sourceUrl: source.url, sourceQuery: source.query, adaptation, imageUrl: source.imageUrl, imageAlt: source.imageAlt });
const mealPrepManualParsed = (title: string, slug: string, imageUrl: string, imageAlt: string, adaptation?: string): RecipeProvenance => parsed({ title, url: `https://mealprepmanual.com/${slug}/`, query: "mealprep recipes", imageUrl, imageAlt }, adaptation);

const recipes: Recipe[] = [
  r("oats-berry", "breakfast", "Овсянка с ягодами и творогом", "🫐", 12, { kcal: 430, protein: 32, fat: 11, carbs: 52 }, 360, 145, ["protein", "budget"], [i("oats", "Овсяные хлопья", 60, "г", "Крупы"), i("cottage", "Творог 5%", 120, "г", "Молочное"), i("berries", "Ягоды", 80, "г", "Овощи и фрукты")], commonSteps, 3, false),
  r("omelet-green", "breakfast", "Омлет со шпинатом и фетой", "🍳", 15, { kcal: 410, protein: 31, fat: 27, carbs: 9 }, 300, 170, ["protein", "keto"], [i("egg", "Яйца", 3, "шт.", "Молочное"), i("spinach", "Шпинат", 70, "г", "Овощи и фрукты"), i("feta", "Фета", 45, "г", "Молочное")], commonSteps, 3, false),
  r("syrniki", "breakfast", "Сырники с йогуртом", "🥞", 25, { kcal: 455, protein: 38, fat: 16, carbs: 40 }, 330, 155, ["protein", "budget"], [i("cottage", "Творог 5%", 220, "г", "Молочное"), i("egg", "Яйца", 1, "шт.", "Молочное"), i("yogurt", "Греческий йогурт", 80, "г", "Молочное")], commonSteps, 4, true),
  r("chia-coconut", "breakfast", "Чиа-пудинг с кокосом", "🥥", 8, { kcal: 390, protein: 18, fat: 27, carbs: 18 }, 310, 195, ["keto", "paleo"], [i("chia", "Семена чиа", 35, "г", "Бакалея"), i("coconut-milk", "Кокосовое молоко", 180, "мл", "Бакалея"), i("berries", "Ягоды", 60, "г", "Овощи и фрукты")], commonSteps, 4, false),
  r("turkey-toast", "breakfast", "Тост с индейкой и авокадо", "🥑", 10, { kcal: 440, protein: 34, fat: 20, carbs: 31 }, 320, 205, ["protein"], [i("turkey", "Филе индейки", 120, "г", "Мясо и рыба"), i("bread", "Цельнозерновой хлеб", 70, "г", "Хлеб"), i("avocado", "Авокадо", 0.5, "шт.", "Овощи и фрукты")], commonSteps, 2, false),
  r("panang", "lunch", "Пананг карри с курицей", "🍛", 25, { kcal: 540, protein: 54, fat: 19, carbs: 44 }, 430, 245, ["protein"], [i("brown-rice", "Коричневый рис", 55, "г", "Крупы"), i("chicken", "Куриное филе", 200, "г", "Мясо и рыба"), i("pepper", "Болгарский перец", 0.5, "шт.", "Овощи и фрукты"), i("beans", "Стручковая фасоль", 70, "г", "Овощи и фрукты"), i("coconut-milk", "Кокосовое молоко", 75, "мл", "Бакалея")], commonSteps, 3, true),
  r("korean-bowl", "lunch", "Куриный боул по-корейски", "🥗", 22, { kcal: 510, protein: 48, fat: 14, carbs: 52 }, 420, 225, ["protein", "budget"], [i("chicken", "Куриное филе", 180, "г", "Мясо и рыба"), i("rice", "Рис", 60, "г", "Крупы"), i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"), i("carrot", "Морковь", 0.5, "шт.", "Овощи и фрукты"), i("soy", "Соевый соус", 20, "мл", "Бакалея")], commonSteps, 3, true),
  r("turkey-veg", "lunch", "Индейка с печёными овощами", "🥘", 30, { kcal: 485, protein: 46, fat: 17, carbs: 37 }, 430, 215, ["protein", "paleo"], [i("turkey", "Филе индейки", 190, "г", "Мясо и рыба"), i("potato", "Картофель", 180, "г", "Овощи и фрукты"), i("tomato", "Томаты", 1, "шт.", "Овощи и фрукты"), i("zucchini", "Кабачок", 120, "г", "Овощи и фрукты")], commonSteps, 4, true),
  r("salmon-quinoa", "lunch", "Лосось с киноа и брокколи", "🐟", 28, { kcal: 560, protein: 42, fat: 28, carbs: 34 }, 400, 365, ["protein"], [i("salmon", "Филе лосося", 170, "г", "Мясо и рыба"), i("quinoa", "Киноа", 55, "г", "Крупы"), i("broccoli", "Брокколи", 160, "г", "Овощи и фрукты")], commonSteps, 2, true),
  r("lentil-stew", "lunch", "Чечевица с курицей и томатами", "🫘", 35, { kcal: 525, protein: 44, fat: 12, carbs: 58 }, 450, 155, ["budget", "protein"], [i("chicken", "Куриное филе", 140, "г", "Мясо и рыба"), i("lentils", "Красная чечевица", 75, "г", "Крупы"), i("tomato", "Томаты", 1, "шт.", "Овощи и фрукты"), i("onion", "Лук", 0.5, "шт.", "Овощи и фрукты")], commonSteps, 4, true),
  r("aji-chicken", "dinner", "Курица ахи-верде с картофелем", "🍗", 30, { kcal: 520, protein: 50, fat: 18, carbs: 39 }, 420, 240, ["protein", "paleo"], [i("chicken", "Куриное филе", 190, "г", "Мясо и рыба"), i("potato", "Картофель", 190, "г", "Овощи и фрукты"), i("greens", "Зелень", 30, "г", "Овощи и фрукты"), i("yogurt", "Греческий йогурт", 45, "г", "Молочное")], commonSteps, 3, true),
  r("beef-wok", "dinner", "Говядина вок с овощами", "🥩", 24, { kcal: 500, protein: 43, fat: 25, carbs: 24 }, 390, 285, ["protein", "keto", "paleo"], [i("beef", "Постная говядина", 180, "г", "Мясо и рыба"), i("pepper", "Болгарский перец", 0.5, "шт.", "Овощи и фрукты"), i("broccoli", "Брокколи", 130, "г", "Овощи и фрукты"), i("soy", "Соевый соус", 18, "мл", "Бакалея")], commonSteps, 3, true),
  r("cod-potato", "dinner", "Треска с молодым картофелем", "🐟", 26, { kcal: 455, protein: 47, fat: 13, carbs: 38 }, 410, 255, ["protein", "paleo"], [i("cod", "Филе трески", 210, "г", "Мясо и рыба"), i("potato", "Картофель", 185, "г", "Овощи и фрукты"), i("greens", "Зелень", 25, "г", "Овощи и фрукты")], commonSteps, 2, true),
  r("turkey-meatballs", "dinner", "Тефтели из индейки в томатах", "🍅", 35, { kcal: 480, protein: 49, fat: 17, carbs: 32 }, 430, 205, ["protein", "budget", "paleo"], [i("turkey", "Филе индейки", 200, "г", "Мясо и рыба"), i("tomato-passata", "Томатная пассата", 130, "мл", "Бакалея"), i("zucchini", "Кабачок", 150, "г", "Овощи и фрукты")], commonSteps, 4, true),
  r("tofu-curry", "dinner", "Тофу карри с цветной капустой", "🥦", 25, { kcal: 440, protein: 28, fat: 29, carbs: 18 }, 390, 175, ["budget", "keto"], [i("tofu", "Тофу", 220, "г", "Бакалея"), i("cauliflower", "Цветная капуста", 190, "г", "Овощи и фрукты"), i("coconut-milk", "Кокосовое молоко", 80, "мл", "Бакалея")], commonSteps, 4, true),
  r("yogurt-berries", "snack1", "Йогурт с ягодами и семенами", "🥣", 5, { kcal: 230, protein: 24, fat: 7, carbs: 18 }, 250, 115, ["protein", "budget"], [i("yogurt", "Греческий йогурт", 200, "г", "Молочное"), i("berries", "Ягоды", 70, "г", "Овощи и фрукты"), i("seeds", "Семечки", 12, "г", "Бакалея")], commonSteps, 3, false),
  r("cottage-cucumber", "snack1", "Творог с огурцом и зеленью", "🥒", 6, { kcal: 215, protein: 29, fat: 8, carbs: 7 }, 240, 105, ["protein", "budget", "keto"], [i("cottage", "Творог 5%", 180, "г", "Молочное"), i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"), i("greens", "Зелень", 15, "г", "Овощи и фрукты")], commonSteps, 3, false),
  r("egg-hummus", "snack1", "Яйца с хумусом и овощами", "🥚", 10, { kcal: 260, protein: 17, fat: 16, carbs: 12 }, 230, 125, ["budget"], [i("egg", "Яйца", 2, "шт.", "Молочное"), i("hummus", "Хумус", 45, "г", "Бакалея"), i("carrot", "Морковь", 1, "шт.", "Овощи и фрукты")], commonSteps, 3, false),
  r("protein-pudding", "snack1", "Шоколадный протеин-пудинг", "🍫", 7, { kcal: 245, protein: 30, fat: 8, carbs: 13 }, 240, 165, ["protein", "keto"], [i("yogurt", "Греческий йогурт", 190, "г", "Молочное"), i("cocoa", "Какао", 10, "г", "Бакалея"), i("chia", "Семена чиа", 15, "г", "Бакалея")], commonSteps, 4, false),
  r("apple-almond", "snack1", "Яблоко с миндальной пастой", "🍎", 3, { kcal: 235, protein: 7, fat: 12, carbs: 26 }, 220, 135, ["paleo", "budget"], [i("apple", "Яблоко", 1, "шт.", "Овощи и фрукты"), i("almond-paste", "Миндальная паста", 24, "г", "Бакалея")], commonSteps, 5, false),
  r("kefir-smoothie", "snack2", "Кефирный смузи с ягодами", "🥤", 5, { kcal: 220, protein: 19, fat: 6, carbs: 23 }, 320, 110, ["protein", "budget"], [i("kefir", "Кефир", 250, "мл", "Молочное"), i("berries", "Ягоды", 80, "г", "Овощи и фрукты"), i("cottage", "Творог 5%", 60, "г", "Молочное")], commonSteps, 2, false),
  r("tuna-crisp", "snack2", "Тунец с хрустящими овощами", "🐟", 8, { kcal: 240, protein: 32, fat: 8, carbs: 9 }, 250, 180, ["protein", "keto", "paleo"], [i("tuna", "Тунец", 130, "г", "Мясо и рыба"), i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"), i("pepper", "Болгарский перец", 0.5, "шт.", "Овощи и фрукты")], commonSteps, 2, false),
  r("mozzarella-tomato", "snack2", "Моцарелла с томатами", "🧀", 5, { kcal: 265, protein: 21, fat: 18, carbs: 7 }, 230, 190, ["keto"], [i("mozzarella", "Моцарелла", 110, "г", "Молочное"), i("tomato", "Томаты", 1, "шт.", "Овощи и фрукты"), i("greens", "Зелень", 15, "г", "Овощи и фрукты")], commonSteps, 2, false),
  r("turkey-roll", "snack2", "Роллы из индейки с творожным сыром", "🌯", 8, { kcal: 250, protein: 31, fat: 12, carbs: 6 }, 210, 175, ["protein", "keto"], [i("turkey-slices", "Ломтики индейки", 140, "г", "Мясо и рыба"), i("cream-cheese", "Творожный сыр", 45, "г", "Молочное"), i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты")], commonSteps, 3, false),
  r("chia-cacao", "snack2", "Чиа-крем с какао", "🍮", 6, { kcal: 255, protein: 14, fat: 18, carbs: 12 }, 230, 150, ["keto", "paleo"], [i("chia", "Семена чиа", 30, "г", "Бакалея"), i("coconut-milk", "Кокосовое молоко", 160, "мл", "Бакалея"), i("cocoa", "Какао", 10, "г", "Бакалея")], commonSteps, 4, false),
];

recipes.push(
  r("src-cottage-bake", "breakfast", "Творожная запеканка без сахара", "🥧", 55, { kcal: 385, protein: 43, fat: 18, carbs: 13 }, 330, 135, ["protein", "budget", "keto"], [i("cottage", "Творог 5%", 250, "г", "Молочное"), i("egg", "Яйца", 2, "шт.", "Молочное"), i("milk", "Молоко 2,5%", 80, "мл", "Молочное")], ["Разотрите творог с желтками и молоком до однородности.", "Взбейте белки и аккуратно вмешайте в творожную массу.", "Выложите в форму и запекайте около 45 минут при 180 °C.", "Полностью остудите и разрежьте на порции."], 3, true, { provenance: parsed(recipeSources.cottageBake), storage: { freezerDays: 30, freezeParts: "Замораживать порционными кусками без йогурта и ягод." } }),
  r("src-oat-syrniki", "breakfast", "Сырники с овсяными хлопьями", "🥞", 25, { kcal: 420, protein: 42, fat: 15, carbs: 29 }, 320, 140, ["protein", "budget"], [i("cottage", "Творог 5%", 220, "г", "Молочное"), i("egg", "Яйца", 1, "шт.", "Молочное"), i("oats", "Овсяные хлопья", 30, "г", "Крупы")], ["Измельчите овсяные хлопья в муку.", "Смешайте творог, яйцо и овсяную муку.", "Сформуйте сырники и готовьте на антипригарной сковороде до готовности.", "Остудите на решётке перед упаковкой."], 4, true, { provenance: parsed(recipeSources.syrniki), storage: { freezerDays: 30, freezeParts: "Замораживать без соуса, прокладывая сырники пергаментом." } }),
  r("src-protein-oats", "breakfast", "Ночная овсянка с творогом и ягодами", "🫐", 10, { kcal: 415, protein: 31, fat: 11, carbs: 49 }, 360, 155, ["protein", "budget"], [i("oats", "Овсяные хлопья", 65, "г", "Крупы"), i("milk", "Молоко 2,5%", 140, "мл", "Молочное"), i("cottage", "Мягкий творог", 120, "г", "Молочное"), i("berries", "Замороженные ягоды", 70, "г", "Овощи и фрукты")], ["Смешайте хлопья с молоком и мягким творогом.", "Разложите по банкам и добавьте ягоды.", "Закройте и оставьте в холодильнике минимум на 6 часов."], 2, false, { provenance: parsed(recipeSources.proteinOats, "Протеиновый порошок заменён на мягкий творог; кленовый сироп убран."), storage: { refrigerator: "В закрытой банке при ≤4 °C — до 2 суток." } }),
  r("src-chicken-buckwheat", "lunch", "Гречка с курицей и морковью", "🍛", 30, { kcal: 480, protein: 49, fat: 12, carbs: 47 }, 420, 135, ["protein", "budget"], [i("chicken", "Куриное филе", 180, "г", "Мясо и рыба"), i("buckwheat", "Гречка", 65, "г", "Крупы"), i("carrot", "Морковь", 1, "шт.", "Овощи и фрукты"), i("greens", "Зелень", 15, "г", "Овощи и фрукты")], ["Отварите гречку до готовности.", "Нарежьте курицу и морковь, тушите с небольшим количеством воды до готовности курицы.", "Добавьте гречку и зелень, прогрейте ещё 2–3 минуты.", "Быстро остудите и разложите по контейнерам."], 4, true, { provenance: parsed(recipeSources.chickenBuckwheat), storage: { freezerDays: 60 } }),
  r("src-chicken-rice-veg", "lunch", "Курица с рисом и овощами", "🍚", 45, { kcal: 515, protein: 46, fat: 14, carbs: 53 }, 440, 155, ["protein", "budget"], [i("chicken", "Куриное филе", 180, "г", "Мясо и рыба"), i("rice", "Рис", 65, "г", "Крупы"), i("carrot", "Морковь", 0.5, "шт.", "Овощи и фрукты"), i("pepper", "Болгарский перец", 0.5, "шт.", "Овощи и фрукты"), i("peas", "Замороженный горошек", 60, "г", "Овощи и фрукты")], ["Промойте рис, курицу и овощи нарежьте небольшими кусочками.", "Выложите рис и овощи в форму, сверху распределите курицу и добавьте воду.", "Накройте и запекайте при 180 °C до готовности риса и курицы.", "Быстро остудите в неглубоких контейнерах."], 4, true, { provenance: parsed(recipeSources.chickenRice), storage: { freezerDays: 60 } }),
  r("src-chicken-bean-bowl", "lunch", "Курица с рисом, фасолью и томатами", "🫘", 30, { kcal: 560, protein: 48, fat: 13, carbs: 61 }, 450, 185, ["protein", "budget"], [i("chicken", "Куриное филе", 170, "г", "Мясо и рыба"), i("rice", "Рис", 60, "г", "Крупы"), i("red-beans", "Красная фасоль", 100, "г", "Бакалея"), i("tomato-passata", "Протёртые томаты", 100, "мл", "Бакалея"), i("onion", "Лук", 0.5, "шт.", "Овощи и фрукты")], ["Промойте рис и отварите его до готовности по инструкции на упаковке.", "Обжарьте лук, добавьте кубики курицы и паприку, готовьте до полной готовности.", "Добавьте фасоль и протёртые томаты, прогрейте 5 минут.", "Разложите с рисом по контейнерам и быстро охладите."], 4, true, { provenance: parsed(recipeSources.chickenBowl, "Чёрная фасоль заменена на красную, сальса — на протёртые томаты, лайм и кинза убраны."), storage: { freezerDays: 60 } }),
  r("src-salmon-rice-veg", "dinner", "Лосось с рисом и печёными овощами", "🐟", 40, { kcal: 555, protein: 41, fat: 23, carbs: 47 }, 410, 330, ["protein", "paleo"], [i("salmon", "Филе лосося", 170, "г", "Мясо и рыба"), i("rice", "Рис", 55, "г", "Крупы"), i("broccoli", "Брокколи", 150, "г", "Овощи и фрукты"), i("zucchini", "Кабачок", 120, "г", "Овощи и фрукты")], ["Промойте рис и отварите его до готовности по инструкции на упаковке.", "Нарежьте овощи, посыпьте паприкой и сухими травами.", "Выложите лосось на овощи и запекайте до готовности рыбы.", "Остудите и разложите с рисом по трём контейнерам."], 3, true, { provenance: parsed(recipeSources.salmonPrep, "Кускус заменён на рис, каджунская смесь — на паприку и сухие травы."), storage: { freezerDays: 30, freezeParts: "Замораживать рыбу с рисом; свежую зелень добавить после разогрева." } }),
  r("src-turkey-meatballs", "dinner", "Тефтели из индейки с гречкой", "🍅", 45, { kcal: 525, protein: 45, fat: 17, carbs: 48 }, 440, 195, ["protein", "budget"], [i("turkey-mince", "Фарш индейки", 190, "г", "Мясо и рыба"), i("buckwheat", "Гречка", 60, "г", "Крупы"), i("onion", "Лук", 0.5, "шт.", "Овощи и фрукты"), i("carrot", "Морковь", 0.5, "шт.", "Овощи и фрукты"), i("tomato-passata", "Протёртые томаты", 100, "мл", "Бакалея")], ["Промойте гречку и отварите её до готовности по инструкции на упаковке.", "Смешайте фарш с мелко нарезанным луком, сформуйте тефтели.", "Припустите морковь, добавьте протёртые томаты и тефтели, тушите до полной готовности мяса.", "Остудите и разложите с гречкой по контейнерам."], 4, true, { provenance: parsed(recipeSources.turkeyMeatballs, "Рис внутри тефтелей убран; гречка подаётся отдельно, чтобы проще масштабировать порции."), storage: { freezerDays: 60 } }),
  r("src-one-pot-chicken", "dinner", "Курица с бурым рисом в одной кастрюле", "🥘", 50, { kcal: 535, protein: 43, fat: 18, carbs: 52 }, 450, 175, ["protein", "budget"], [i("chicken-thigh", "Филе куриного бедра", 180, "г", "Мясо и рыба"), i("brown-rice", "Бурый рис", 65, "г", "Крупы"), i("mixed-veg", "Замороженная овощная смесь", 160, "г", "Овощи и фрукты"), i("onion", "Лук", 0.5, "шт.", "Овощи и фрукты")], ["Обжарьте курицу с паприкой в глубокой кастрюле.", "Добавьте промытый рис, лук, сухие травы и горячую воду.", "Томите под крышкой до готовности риса и курицы, в конце добавьте овощи.", "Быстро остудите в неглубоких контейнерах."], 4, true, { provenance: parsed(recipeSources.onePotChicken, "Лук-порей заменён на обычный репчатый лук."), storage: { freezerDays: 60 } }),
  r("src-berry-smoothie", "snack1", "Ягодный смузи с кефиром и творогом", "🥤", 5, { kcal: 255, protein: 24, fat: 6, carbs: 28 }, 330, 120, ["protein", "budget"], [i("kefir", "Кефир", 220, "мл", "Молочное"), i("berries", "Ягоды", 100, "г", "Овощи и фрукты"), i("cottage", "Мягкий творог", 80, "г", "Молочное"), i("oats", "Овсяные хлопья", 15, "г", "Крупы")], ["Положите все ингредиенты в блендер.", "Взбейте до однородности и перелейте в плотно закрывающуюся бутылку.", "Храните в холодильнике и взболтайте перед едой."], 1, false, { provenance: parsed(recipeSources.berrySmoothie, "Растительное молоко и протеин заменены на кефир и мягкий творог; банан убран."), storage: { refrigerator: "В плотно закрытой бутылке при ≤4 °C — до 1 суток." } }),
  r("src-frozen-yogurt", "snack2", "Замороженный йогурт с ягодами", "🍧", 5, { kcal: 205, protein: 20, fat: 5, carbs: 19 }, 240, 125, ["protein", "budget"], [i("yogurt", "Греческий йогурт", 200, "г", "Молочное"), i("berries", "Замороженные ягоды", 100, "г", "Овощи и фрукты")], ["Измельчите замороженные ягоды с йогуртом до густой однородной массы.", "Разложите по небольшим контейнерам и сразу уберите в морозилку.", "Перед едой дайте постоять 5–10 минут при комнатной температуре."], 1, true, { provenance: parsed(recipeSources.frozenYogurt, "Мёд убран; берутся обычные замороженные ягоды."), storage: { refrigerator: "Не хранить как заготовку в холодильнике: после измельчения сразу заморозить или съесть.", freezer: "В плотно закрытом порционном контейнере при −18 °C.", thaw: "Не размораживать полностью: дать слегка размягчиться 5–10 минут.", freezerDays: 30 } }),
  r("src-taco-mac", "lunch", "Макароны с говядиной, томатами и сыром", "🍝", 35, { kcal: 674, protein: 54, fat: 24, carbs: 61 }, 470, 245, ["protein", "budget"], [i("beef-mince", "Постный говяжий фарш", 182, "г", "Мясо и рыба"), i("pasta", "Макароны из твёрдых сортов", 57, "г", "Крупы"), i("pepper", "Болгарский перец", 0.4, "шт.", "Овощи и фрукты"), i("tomato-passata", "Протёртые томаты", 84, "мл", "Бакалея"), i("milk", "Молоко 2,5%", 48, "мл", "Молочное"), i("cheese", "Полутвёрдый сыр", 17, "г", "Молочное")], ["Нарежьте перец, обжарьте фарш в глубокой кастрюле и разомните его лопаткой.", "Добавьте перец, паприку и немного зиры; готовьте до мягкости овощей.", "Влейте протёртые томаты и бульон, всыпьте сухие макароны и готовьте под крышкой до мягкости.", "Снимите с огня, вмешайте молоко, разложите по контейнерам и посыпьте сыром."], 4, true, { provenance: parsed(recipeSources.tacoMac, "Количество чили уменьшено; американский shredded cheese заменён обычным полутвёрдым сыром. Это горячее блюдо, а не салат из макарон."), localization: { fit: "adapted", availability: "common", note: "По формату близко к привычным макаронам с фаршем и томатной подливой." }, storage: { freezerDays: 45, freezeParts: "Замораживать готовое блюдо порционно; свежую зелень добавлять после разогрева." }, effort: { knifeActions: 2, cookware: 1, activeActions: 7, activeMinutes: 10, level: "low" } }),
  r("src-teriyaki-tray", "dinner", "Курица терияки с рисом, бататом и брокколи", "🍗", 60, { kcal: 550, protein: 44, fat: 14, carbs: 62 }, 460, 220, ["protein"], [i("chicken-thigh", "Филе куриного бедра", 182, "г", "Мясо и рыба"), i("rice", "Рис", 60, "г", "Крупы"), i("sweet-potato", "Батат", 60, "г", "Овощи и фрукты"), i("broccoli", "Брокколи", 90, "г", "Овощи и фрукты"), i("soy", "Соевый соус", 15, "мл", "Бакалея")], ["Поставьте вариться рис.", "Нарежьте батат и брокколи; запекайте батат 10 минут, затем добавьте брокколи.", "Запеките куриные бёдра до полной готовности и нарежьте ломтиками.", "Смешайте соевый соус, воду, рисовый уксус, немного сахара и чеснок; уварите до лёгкого загустения.", "Покройте курицу соусом и разложите всё по контейнерам."], 4, true, { provenance: parsed(recipeSources.teriyakiTray, "Мирин заменён доступной смесью рисового уксуса, воды и небольшого количества сахара."), localization: { fit: "adapted", availability: "specialty", note: "Батат оставлен, но его можно заменить картофелем; соус собран из доступных продуктов." }, storage: { freezerDays: 45, freezeParts: "Замораживать курицу, рис и овощи; лишний соус лучше хранить отдельно." }, effort: { knifeActions: 3, cookware: 3, activeActions: 11, activeMinutes: 20, level: "high" } }),
  r("src-halal-chicken", "lunch", "Пряная курица с золотым рисом и овощами", "🥙", 75, { kcal: 705, protein: 52, fat: 29, carbs: 61 }, 520, 235, ["protein"], [i("chicken-thigh", "Филе куриного бедра", 220, "г", "Мясо и рыба"), i("rice", "Рис басмати", 60, "г", "Крупы"), i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"), i("tomato", "Томаты", 1, "шт.", "Овощи и фрукты"), i("yogurt", "Греческий йогурт", 30, "г", "Молочное"), i("mayonnaise", "Майонез", 15, "г", "Бакалея")], ["Приготовьте рис с куркумой, зирой и небольшим количеством масла.", "Замаринуйте куриные бёдра в лимонном соке, паприке и специях, затем запеките до полной готовности.", "Нарежьте огурец и томаты; держите овощи отдельно от горячих компонентов.", "Смешайте йогурт, майонез, лимонный сок и чеснок для белого соуса.", "Храните рис, курицу, овощи и соус отдельными блоками и собирайте контейнер перед едой."], 3, true, { provenance: parsed(recipeSources.halalChicken, "Buffet prep сохранён: компоненты хранятся отдельно. Вакуумные контейнеры не обязательны."), localization: { fit: "adapted", availability: "common", note: "По вкусу близко к пряной курице с рисом и свежим салатом; специфических продуктов нет." }, storage: { refrigerator: "Курицу и рис хранить при ≤4 °C до 3 суток; нарезанные овощи и соус — отдельно.", freezerDays: 45, freezeParts: "Замораживать только курицу и рис. Свежие овощи и белый соус не замораживать." }, effort: { knifeActions: 4, cookware: 3, activeActions: 13, activeMinutes: 30, level: "high" } }),
);

recipes.push(
  r("src-sheet-pan-pancakes", "breakfast", "Белковый овсяный блин на противне", "🥞", 35, { kcal: 414, protein: 31.5, fat: 6, carbs: 58.8 }, 330, 145, ["protein", "budget"], [
    i("oats", "Овсяная мука", 60, "г", "Крупы"), i("milk", "Молоко 2,5%", 60, "мл", "Молочное"), i("egg", "Яичный белок", 68, "г", "Молочное"), i("cottage", "Творог 5%", 75, "г", "Молочное"), i("apple-puree", "Яблочное пюре без сахара", 15, "г", "Бакалея"),
  ], [
    "Пробейте молоко, творог и яблочное пюре блендером до гладкости.",
    "Взбейте белок венчиком до пены, затем аккуратно соедините с творожной смесью.",
    "Вмешайте овсяную муку, разрыхлитель и щепотку соли.",
    "Распределите тесто тонким ровным слоем по противню с пергаментом и выпекайте около 20 минут при 190 °C.",
    "Полностью остудите, разрежьте на 12 квадратов и кладите по 3 штуки в порцию.",
  ], 4, true, { provenance: mealPrepManualParsed("Sheet Pan Protein Pancakes", "sheet-pan-protein-pancakes", "https://mealprepmanual.com/wp-content/uploads/2024/11/Sheet-Pan-Protein-Pancakes-Berry.jpg", "Квадраты овсяного белкового блина с ягодами", "Сухое обезжиренное молоко убрано; одна порция Mise — 3 квадрата, а не 1 маленький кусок."), storage: { freezerDays: 45, freezeParts: "Замораживать квадраты сначала отдельно, затем складывать порциями по три." }, effort: { knifeActions: 1, cookware: 3, activeActions: 9, activeMinutes: 15, level: "high" } }),

  r("src-pumpkin-oat-bake", "breakfast", "Тыквенная овсяная запеканка", "🎃", 45, { kcal: 440, protein: 24, fat: 13, carbs: 57 }, 390, 175, ["protein", "budget"], [
    i("oats", "Овсяные хлопья", 40, "г", "Крупы"), i("protein-powder", "Ванильный протеин", 10, "г", "Бакалея"), i("pumpkin", "Тыквенное пюре", 71, "г", "Овощи и фрукты"), i("egg", "Яйцо", 0.5, "шт.", "Молочное"), i("milk", "Молоко 2,5%", 40, "мл", "Молочное"), i("cottage", "Творог 5%", 38, "г", "Молочное"), i("cream-cheese", "Творожный сыр", 17, "г", "Молочное"), i("yogurt", "Греческий йогурт", 17, "г", "Молочное"),
  ], [
    "Пробейте тыквенное пюре, молоко, творог, яйца, протеин, корицу и немного подсластителя до однородности.",
    "Всыпьте хлопья в форму, залейте тыквенной смесью и тщательно перемешайте.",
    "Запекайте при 180 °C до плотной середины, затем дайте запеканке остыть.",
    "Смешайте творожный сыр с йогуртом; храните крем отдельно.",
    "Разрежьте запеканку на 6 порций и добавляйте крем после разогрева.",
  ], 4, true, { provenance: mealPrepManualParsed("Pumpkin Pie Baked Oatmeal", "pumpkin-pie-baked-oatmeal", "https://mealprepmanual.com/wp-content/uploads/2024/10/Pumpkin-Pie-Baked-Oatmeal.jpg", "Тыквенная овсяная запеканка с кремом", "Pumpkin pie spice заменена корицей, имбирём и мускатным орехом; кленовый сироп не обязателен."), storage: { freezerDays: 45, freezeParts: "Замораживать куски без йогуртового крема." }, effort: { knifeActions: 1, cookware: 3, activeActions: 10, activeMinutes: 15, level: "high" } }),

  r("src-waffle-french-toast", "breakfast", "Белковая вафля-френч-тост с ягодами", "🧇", 25, { kcal: 435, protein: 46, fat: 3, carbs: 56 }, 360, 210, ["protein"], [
    i("oats", "Овсяная мука", 40, "г", "Крупы"), i("protein-powder", "Сывороточный протеин", 16, "г", "Бакалея"), i("egg", "Яичный белок", 135, "г", "Молочное"), i("yogurt", "Греческий йогурт", 75, "г", "Молочное"), i("milk", "Молоко 2,5%", 15, "мл", "Молочное"), i("berries", "Клубника или другие ягоды", 100, "г", "Овощи и фрукты"),
  ], [
    "Смешайте овсяную муку, протеин, половину белка, йогурт и немного воды в густое тесто.",
    "Испеките одну большую вафлю до плотной золотистой корочки.",
    "Оставшийся белок смешайте с молоком, ванилью и корицей.",
    "Разрежьте вафлю, быстро окуните кусочки в яичную смесь и подрумяньте на сковороде с двух сторон.",
    "Ягоды разогрейте до появления сока и подавайте отдельно, чтобы вафля не размокла.",
  ], 2, true, { provenance: mealPrepManualParsed("Cinnamon Protein Waffle French Toast", "cinnamon-protein-waffle-french-toast", "https://mealprepmanual.com/wp-content/uploads/2024/03/Cinnamon-Protein-Waffle-French-Toast.jpg", "Белковая вафля с ягодами", "Фирменная смесь для панкейков заменена овсяной мукой и доступным сывороточным протеином."), localization: { fit: "adapted", availability: "common", note: "Формат десертного завтрака понятен, но нужна вафельница." }, storage: { freezerDays: 30, freezeParts: "Замораживать только готовые вафли; ягоды хранить отдельно." }, effort: { knifeActions: 1, cookware: 4, activeActions: 11, activeMinutes: 15, level: "high" } }),

  r("src-banana-oat-bake", "breakfast", "Банановая овсяная запеканка для набора", "🍌", 70, { kcal: 490, protein: 21, fat: 22, carbs: 52 }, 360, 170, ["protein", "budget"], [
    i("oats", "Овсяные хлопья", 40, "г", "Крупы"), i("protein-powder", "Ванильный протеин", 12, "г", "Бакалея"), i("banana", "Спелый банан", 40, "г", "Овощи и фрукты"), i("egg", "Яйцо", 0.4, "шт.", "Молочное"), i("milk", "Молоко 3,2%", 84, "мл", "Молочное"), i("butter", "Сливочное масло", 6, "г", "Молочное"), i("walnut", "Грецкий орех", 11, "г", "Бакалея"), i("peanut-butter", "Арахисовая паста", 5, "г", "Бакалея"),
  ], [
    "Смешайте хлопья, протеин, разрыхлитель и щепотку соли.",
    "Разомните банан, добавьте яйца, молоко и растопленное масло.",
    "Соедините обе смеси, вмешайте рубленые орехи и переложите в форму.",
    "Запекайте 55–60 минут при 180 °C, затем полностью остудите.",
    "Разрежьте на 10 умеренных порций; арахисовую пасту добавляйте при подаче.",
  ], 4, true, { provenance: mealPrepManualParsed("Big Boy Baked Oatmeal", "big-boy-baked-oatmeal", "https://mealprepmanual.com/wp-content/uploads/2023/10/Big-Boy-Baked-Oatmeal.jpg", "Банановая овсяная запеканка с орехами", "Исходная порция на 980 ккал разделена пополам: Mise показывает более практичную порцию около 490 ккал."), localization: { fit: "familiar", availability: "common", note: "Высококалорийный вариант для набора; жиры удобно регулировать орехами и пастой." }, storage: { freezerDays: 45, freezeParts: "Замораживать порционные куски без арахисовой пасты." }, effort: { knifeActions: 2, cookware: 3, activeActions: 10, activeMinutes: 12, level: "high" } }),

  r("src-breakfast-rolls", "breakfast", "Завтрачные роллы со свининой, яйцом и картофелем", "🌯", 90, { kcal: 447, protein: 26.7, fat: 15.3, carbs: 47.7 }, 360, 190, ["protein", "budget"], [
    i("pork-mince", "Постный свиной фарш", 68, "г", "Мясо и рыба"), i("potato", "Картофель", 45, "г", "Овощи и фрукты"), i("cottage", "Творог 5%", 23, "г", "Молочное"), i("cheese", "Полутвёрдый сыр", 9, "г", "Молочное"), i("egg", "Яйцо", 0.5, "шт.", "Молочное"), i("pepper", "Болгарский перец", 8, "г", "Овощи и фрукты"), i("tortilla", "Маленькая пшеничная тортилья", 3, "шт.", "Хлеб"),
  ], [
    "Отварите картофель до мягкости, очистите и разомните вилкой, оставляя небольшие кусочки.",
    "Смешайте фарш с паприкой, чесноком и сухими травами, расплющите на противне и запеките до полной готовности.",
    "Мелко нарежьте перец и приготовьте с ним мягкую яичницу-болтунью.",
    "Соедините картофель, творог, сыр и яйца; мясо нарежьте полосками.",
    "Прогрейте тортильи, распределите начинку, добавьте мясо и плотно сверните.",
    "Сначала заморозьте роллы отдельно, затем сложите по 3 штуки в пакеты или контейнеры.",
  ], 3, true, { provenance: mealPrepManualParsed("Cheesy Potato and Sausage Breakfast Taquitos", "cheesy-potato-and-sausage-breakfast-taquitos", "https://mealprepmanual.com/wp-content/uploads/2025/02/Untitled-design-8.png", "Завтрачные роллы с мясом, картофелем и яйцом", "Corn tortillas заменены маленькими пшеничными тортильями; одна порция Mise — 3 ролла."), localization: { fit: "adapted", availability: "common", note: "По сути это замораживаемые рулетики из лаваша с привычной начинкой." }, storage: { freezerDays: 60, freezeParts: "Замораживать готовые роллы по отдельности; затем объединять в порции." }, effort: { knifeActions: 4, cookware: 5, activeActions: 16, activeMinutes: 60, level: "high" } }),

  r("src-chicken-nuggets", "snack1", "Куриные наггетсы с бататом без панировки", "🍗", 60, { kcal: 178, protein: 20.4, fat: 4.8, carbs: 13.8 }, 180, 115, ["protein", "budget"], [
    i("chicken-mince", "Куриный фарш", 91, "г", "Мясо и рыба"), i("sweet-potato", "Батат", 48, "г", "Овощи и фрукты"), i("egg", "Яйцо", 0.2, "шт.", "Молочное"), i("oats", "Овсяная мука", 4, "г", "Крупы"), i("green-onion", "Зелёный лук", 3, "г", "Овощи и фрукты"),
  ], [
    "Очистите батат и измельчите его в комбайне до мелкой крошки, похожей на рис.",
    "Смешайте батат с фаршем, яйцом, овсяной мукой, зелёным луком и сухими специями.",
    "Влажными руками сформуйте небольшие плоские наггетсы и выложите на пергамент.",
    "Запекайте при 200 °C около 8 минут, переверните и доведите до полной готовности ещё 4–6 минут.",
    "Остудите на решётке и разложите по 6 штук на перекус.",
  ], 3, true, { provenance: mealPrepManualParsed("Chicken Nuggets for Snack City", "chicken-nuggets-for-snack-city", "https://mealprepmanual.com/wp-content/uploads/2025/03/Untitled-design-9.png", "Запечённые куриные наггетсы без панировки", "КБЖУ исходника указаны на один наггетс; Mise пересчитал карточку на порцию из 6 штук."), localization: { fit: "familiar", availability: "common", note: "Батат оставлен; при необходимости его можно заменить тыквой, но КБЖУ потребуется пересчитать." }, storage: { freezerDays: 60, freezeParts: "Сначала заморозить наггетсы одним слоем, затем сложить по 6 штук." }, effort: { knifeActions: 2, cookware: 3, activeActions: 11, activeMinutes: 30, level: "high" } }),

  r("src-cinnamon-granola", "snack2", "Гранола с корицей и изюмом", "🥜", 27, { kcal: 280, protein: 7.5, fat: 8.9, carbs: 42.5 }, 70, 95, ["budget"], [
    i("oats", "Овсяные хлопья", 32, "г", "Крупы"), i("peanut-butter", "Арахисовая паста", 13, "г", "Бакалея"), i("maple-syrup", "Сироп или мёд", 12, "г", "Бакалея"), i("raisins", "Изюм", 10, "г", "Бакалея"),
  ], [
    "Слегка прогрейте арахисовую пасту с мёдом или сиропом, добавьте корицу и щепотку соли.",
    "Перемешайте смесь с хлопьями так, чтобы они равномерно покрылись.",
    "Распределите тонким слоем по противню и выпекайте при 180 °C около 20 минут, один раз перемешав.",
    "Полностью остудите: гранола станет хрустящей только после остывания.",
    "Вмешайте изюм и разложите по сухим порционным банкам.",
  ], 14, false, { provenance: mealPrepManualParsed("Cinnamon Raisin Granola", "cinnamon-raisin-granola", "https://mealprepmanual.com/wp-content/uploads/2023/08/Cinnamon-Raisin-Granola.jpg", "Домашняя гранола с корицей и изюмом", "Парсер ошибочно отнёс гранолу к обедам; в Mise это второй перекус. Кленовый сироп можно заменить мёдом."), storage: { refrigerator: "После смешивания с йогуртом хранить при ≤4 °C не дольше 1 суток.", ambient: "В сухой герметичной банке при комнатной температуре — ориентировочно до 14 суток; не убирать тёплой." }, flex: { protein: [1, 1], fat: [0.7, 1.3], carbs: [0.7, 1.3] }, effort: { knifeActions: 0, cookware: 2, activeActions: 5, activeMinutes: 7, level: "low" } }),

  r("src-crispy-beef-noodles", "lunch", "Острая лапша с хрустящим говяжьим фаршем", "🍜", 35, { kcal: 617, protein: 47, fat: 23, carbs: 55 }, 450, 260, ["protein"], [
    i("beef-mince", "Постный говяжий фарш", 182, "г", "Мясо и рыба"), i("pasta", "Яичная или рисовая лапша", 45, "г", "Крупы"), i("broccoli", "Брокколи", 45, "г", "Овощи и фрукты"), i("cabbage", "Капуста", 36, "г", "Овощи и фрукты"), i("carrot", "Морковь", 23, "г", "Овощи и фрукты"), i("soy", "Соевый соус", 9, "мл", "Бакалея"), i("gochujang", "Паста кочудян", 6, "г", "Бакалея"),
  ], [
    "Приготовьте лапшу по инструкции и сохраните немного воды от варки.",
    "Нарежьте брокколи и капусту, морковь натрите длинными полосками.",
    "Хорошо подрумяньте фарш на сильном огне, разбивая его на мелкие хрустящие кусочки, затем временно переложите.",
    "Быстро обжарьте овощи, верните мясо и добавьте лапшу.",
    "Смешайте соевый соус, кочудян, немного мёда и воды от лапши; влейте и прогрейте до загустения.",
  ], 4, true, { provenance: mealPrepManualParsed("Crispy Chili Beef Noodles", "crispy-chili-beef-noodles", "https://mealprepmanual.com/wp-content/uploads/2026/02/Crispy-Chili-Beef-Noodles.jpg", "Острая лапша с говядиной и овощами", "Острота снижена; паста кочудян оставлена как управляемый нишевый ингредиент."), localization: { fit: "adapted", availability: "specialty", note: "Кочудян продаётся на маркетплейсах; для мягкого варианта можно взять сладкий чили и паприку." }, storage: { freezerDays: 30 }, effort: { knifeActions: 4, cookware: 3, activeActions: 13, activeMinutes: 20, level: "high" } }),

  r("src-mediterranean-wrap", "lunch", "Ролл с пряной курицей, овощами и хумусом", "🌯", 60, { kcal: 494, protein: 34, fat: 19, carbs: 47 }, 430, 240, ["protein"], [
    i("chicken-thigh", "Филе куриного бедра", 151, "г", "Мясо и рыба"), i("tortilla", "Большая пшеничная тортилья", 1, "шт.", "Хлеб"), i("hummus", "Хумус", 16, "г", "Бакалея"), i("cucumber", "Огурец", 33, "г", "Овощи и фрукты"), i("tomato", "Томаты", 40, "г", "Овощи и фрукты"), i("lettuce", "Салат романо", 57, "г", "Овощи и фрукты"), i("feta", "Фета", 7, "г", "Молочное"),
  ], [
    "Смешайте лимонный сок, масло, зиру, орегано, чеснок и паприку; замаринуйте курицу минимум на 30 минут.",
    "Запеките курицу до полной готовности и румяной поверхности, дайте отдохнуть и нарежьте полосками.",
    "Нарежьте огурец и томаты, удалив лишний сок; салат держите сухим.",
    "Храните курицу, овощи, тортильи и хумус отдельными компонентами.",
    "Перед едой смажьте тортилью хумусом, добавьте курицу, овощи и фету, затем плотно сверните.",
  ], 3, true, { provenance: mealPrepManualParsed("Mediterranean Chicken Wraps", "mediterranean-chicken-wraps", "https://mealprepmanual.com/wp-content/uploads/2021/04/mediterranean-chicken-wraps-3-e1617688079573.png", "Ролл с курицей, овощами и хумусом", "Компоненты не собираются заранее, чтобы тортилья и салат не размокали."), localization: { fit: "familiar", availability: "common", note: "Формат близок к привычному роллу в лаваше; все продукты доступны." }, storage: { refrigerator: "Курицу хранить при ≤4 °C до 3 суток; овощи, салат и тортильи — отдельно.", freezerDays: 45, freezeParts: "Замораживать только готовую курицу. Свежие овощи, хумус и тортилью не замораживать вместе." }, effort: { knifeActions: 4, cookware: 2, activeActions: 12, activeMinutes: 25, level: "high" } }),

  r("src-creamy-chicken-pasta", "lunch", "Сливочная паста с курицей и овощным соусом", "🍝", 60, { kcal: 557, protein: 47, fat: 16, carbs: 56 }, 470, 225, ["protein", "budget"], [
    i("chicken-thigh", "Филе куриного бедра", 136, "г", "Мясо и рыба"), i("pasta", "Спагетти из твёрдых сортов", 56, "г", "Крупы"), i("cauliflower", "Замороженная цветная капуста", 45, "г", "Овощи и фрукты"), i("pumpkin", "Замороженная тыква", 45, "г", "Овощи и фрукты"), i("cottage", "Творог 5%", 45, "г", "Молочное"), i("milk", "Молоко 2,5%", 72, "мл", "Молочное"), i("cheese", "Пармезан или полутвёрдый сыр", 11, "г", "Молочное"),
  ], [
    "Нарежьте курицу небольшими кусочками и распределите по дну глубокой формы.",
    "Прогрейте замороженные овощи и пробейте их с творогом, молоком, водой, чесноком и сухими травами.",
    "Выложите сухие спагетти поверх курицы слоями, каждый слой полностью покрывайте соусом.",
    "Плотно накройте форму и запекайте около 45 минут при 190 °C.",
    "Перемешайте пасту, дайте соусу загустеть 10–15 минут и посыпьте сыром.",
  ], 4, true, { provenance: mealPrepManualParsed("Easy Dump and Bake Creamy Chicken Pasta", "easy-dump-and-bake-creamy-chicken-pasta", "https://mealprepmanual.com/wp-content/uploads/2025/10/One-Dish-Baked-Pasta.jpg", "Запечённая паста с курицей в сливочном овощном соусе", "Butternut squash заменён обычной замороженной тыквой; это горячая паста, не салат."), localization: { fit: "familiar", availability: "common", note: "Формат запеканки привычный, а овощи скрыты в соусе." }, storage: { freezerDays: 30, thaw: "Размораживать в холодильнике; при разогреве добавить 1–2 ложки молока." }, effort: { knifeActions: 1, cookware: 3, activeActions: 9, activeMinutes: 15, level: "high" } }),

  r("src-lemon-chicken", "dinner", "Лимонная курица с картофельным пюре и морковью", "🍋", 70, { kcal: 642, protein: 42, fat: 31, carbs: 50 }, 520, 235, ["protein"], [
    i("chicken-thigh", "Филе куриного бедра", 182, "г", "Мясо и рыба"), i("potato", "Картофель", 182, "г", "Овощи и фрукты"), i("carrot", "Морковь", 136, "г", "Овощи и фрукты"), i("butter", "Сливочное масло", 14, "г", "Молочное"), i("milk", "Молоко 2,5%", 24, "мл", "Молочное"), i("mustard", "Дижонская горчица", 5, "г", "Бакалея"),
  ], [
    "Отварите картофель с чесноком до мягкости, слейте воду и разомните с молоком и маслом.",
    "Смешайте лимонный сок, горчицу, орегано, базилик и чеснок; покройте маринадом полоски курицы.",
    "Обжарьте курицу небольшими партиями до румяной корочки и полной готовности.",
    "Нарежьте морковь крупными кусочками и запеките с небольшим количеством масла до мягкости.",
    "Разложите пюре, морковь и курицу по контейнерам, не закрывая их до прекращения пара.",
  ], 4, true, { provenance: mealPrepManualParsed("Lemon Herb Chicken", "lemon-herb-chicken", "https://mealprepmanual.com/wp-content/uploads/2025/01/Lemon-Herb-Chicken.jpg", "Лимонная курица с пюре и печёной морковью", "Состав оставлен почти без изменений: продукты и формат блюда привычны для России."), storage: { freezerDays: 45 }, effort: { knifeActions: 4, cookware: 4, activeActions: 13, activeMinutes: 30, level: "high" } }),

  r("src-curry-fried-rice", "lunch", "Жареный рис с карри и курицей", "🍛", 50, { kcal: 491, protein: 40, fat: 20, carbs: 37 }, 430, 210, ["protein", "budget"], [
    i("chicken-thigh", "Филе куриного бедра", 182, "г", "Мясо и рыба"), i("rice", "Рис, сухой вес", 35, "г", "Крупы"), i("onion", "Лук", 40, "г", "Овощи и фрукты"), i("pepper", "Болгарский перец", 30, "г", "Овощи и фрукты"), i("zucchini", "Кабачок", 30, "г", "Овощи и фрукты"), i("yogurt", "Греческий йогурт", 6, "г", "Молочное"),
  ], [
    "Сварите рис заранее, быстро охладите и уберите в холодильник — подсушенный рис лучше обжаривается.",
    "Смешайте йогурт, лимонный сок, карри, зиру и паприку; замаринуйте тонкие полоски курицы.",
    "Обжарьте курицу партиями до румяности и временно переложите.",
    "На той же сковороде обжарьте лук, перец и кабачок, затем добавьте чеснок и немного томатной пасты.",
    "Вмешайте холодный рис и курицу, хорошо прогрейте и сразу разложите по неглубоким контейнерам.",
  ], 4, true, { provenance: mealPrepManualParsed("Curried Chicken Fried Rice", "curried-chicken-fried-rice", "https://mealprepmanual.com/wp-content/uploads/2024/11/Curried-Chicken-Fried-Rice.jpg", "Жареный рис с курицей карри и овощами", "Кинза оставлена необязательной; остальные продукты доступны."), localization: { fit: "adapted", availability: "common", note: "Карри уже привычный вкус; остроту можно полностью убрать." }, storage: { freezerDays: 45 }, effort: { knifeActions: 4, cookware: 3, activeActions: 13, activeMinutes: 25, level: "high" } }),

  r("src-fajita-rice", "lunch", "Жареный рис с курицей и сладким перцем", "🫑", 50, { kcal: 481, protein: 40, fat: 18, carbs: 41 }, 430, 205, ["protein", "budget"], [
    i("chicken-thigh", "Филе куриного бедра", 182, "г", "Мясо и рыба"), i("rice", "Рис, сухой вес", 35, "г", "Крупы"), i("onion", "Лук", 40, "г", "Овощи и фрукты"), i("pepper", "Болгарский перец", 60, "г", "Овощи и фрукты"), i("lime", "Лайм или лимон", 0.2, "шт.", "Овощи и фрукты"),
  ], [
    "Заранее сварите рис, быстро охладите и храните в холодильнике до готовки.",
    "Нарежьте курицу тонкими полосками и смешайте с паприкой, зирой, кориандром, чесноком и соком лайма.",
    "Обжарьте курицу небольшими партиями и переложите на тарелку.",
    "Нарежьте лук и перец полосками, обжарьте их на той же сковороде до лёгкой румяности.",
    "Добавьте холодный рис, курицу и ещё немного цитрусового сока; прогрейте и разделите на порции.",
  ], 4, true, { provenance: mealPrepManualParsed("Chicken Fajita Fried Rice", "chicken-fajita-fried-rice", "https://mealprepmanual.com/wp-content/uploads/2023/10/Chicken-Fajita-Fried-Rice.jpg", "Жареный рис с курицей и сладким перцем", "Poblano заменён обычным зелёным болгарским перцем; кинза необязательна."), localization: { fit: "adapted", availability: "common", note: "По формату близко к рису с курицей и овощами." }, storage: { freezerDays: 45 }, effort: { knifeActions: 4, cookware: 3, activeActions: 13, activeMinutes: 25, level: "high" } }),

  r("src-japanese-beef-curry", "lunch", "Говяжье карри с картофелем и рисом", "🍛", 60, { kcal: 719, protein: 46, fat: 31, carbs: 65 }, 540, 280, ["protein"], [
    i("beef-mince", "Говяжий фарш 85/15", 182, "г", "Мясо и рыба"), i("rice", "Рис, сухой вес", 45, "г", "Крупы"), i("potato", "Картофель", 50, "г", "Овощи и фрукты"), i("carrot", "Морковь", 30, "г", "Овощи и фрукты"), i("onion", "Лук", 25, "г", "Овощи и фрукты"), i("peas", "Замороженный горошек", 45, "г", "Овощи и фрукты"), i("soy", "Соевый соус", 6, "мл", "Бакалея"),
  ], [
    "Поставьте вариться рис и подготовьте овощи: картофель кубиками, морковь тонкими ломтиками, лук мелко.",
    "Подрумяньте фарш в глубокой кастрюле; в вытопившемся жире обжарьте лук, чеснок и имбирь.",
    "Добавьте мягкую смесь карри и немного муки, прогрейте и постепенно влейте бульон, размешивая комки.",
    "Добавьте картофель и морковь, накройте и тушите до мягкости овощей.",
    "Вмешайте горошек и соевый соус, скорректируйте вкус и разложите с рисом.",
  ], 4, true, { provenance: mealPrepManualParsed("Japanese Ground Beef Curry", "japanese-ground-beef-curry", "https://mealprepmanual.com/wp-content/uploads/2024/02/Japanese-Ground-Beef-Curry.jpg", "Густое говяжье карри с картофелем и рисом", "Количество карри и гарам масалы уменьшено; вустерский соус можно не покупать."), localization: { fit: "adapted", availability: "common", note: "По текстуре это знакомое мясное рагу; специи остаются регулируемыми." }, storage: { freezerDays: 60 }, effort: { knifeActions: 4, cookware: 2, activeActions: 11, activeMinutes: 20, level: "high" } }),

  r("src-gochujang-beef", "lunch", "Говядина кочудян с капустой и рисом", "🥩", 50, { kcal: 572, protein: 42, fat: 22, carbs: 52 }, 460, 265, ["protein", "budget"], [
    i("beef-mince", "Постный говяжий фарш", 182, "г", "Мясо и рыба"), i("rice", "Рис, сухой вес", 40, "г", "Крупы"), i("cabbage", "Белокочанная капуста", 45, "г", "Овощи и фрукты"), i("carrot", "Морковь", 30, "г", "Овощи и фрукты"), i("pepper", "Болгарский перец", 30, "г", "Овощи и фрукты"), i("gochujang", "Паста кочудян", 9, "г", "Бакалея"), i("soy", "Соевый соус", 6, "мл", "Бакалея"),
  ], [
    "Сварите рис и нарежьте перец, лук, капусту и морковь тонкой соломкой.",
    "Подрумяньте фарш на широкой сковороде и временно переложите.",
    "Быстро обжарьте овощи, сохраняя лёгкий хруст, затем верните мясо.",
    "Смешайте кочудян, соевый соус, воду, немного мёда, чеснок и имбирь.",
    "Влейте соус, прогрейте до блеска и разделите между контейнерами с рисом.",
  ], 4, true, { provenance: mealPrepManualParsed("Gochujang Glazed Beef & Vegetables", "gochujang-glazed-beef-vegetables", "https://mealprepmanual.com/wp-content/uploads/2024/01/High-Volume-Korean-Beef-Bowls.jpg", "Говядина кочудян с капустой, морковью и рисом", "Кочудян оставлен, но его количество ограничено; капуста обычная белокочанная."), localization: { fit: "adapted", availability: "specialty", note: "Специально оставленный нишевый соус; остальные продукты максимально обычные." }, storage: { freezerDays: 45 }, effort: { knifeActions: 4, cookware: 3, activeActions: 12, activeMinutes: 20, level: "high" } }),

  r("src-peanut-turkey", "dinner", "Индейка с овощами в арахисовом соусе", "🥜", 30, { kcal: 632, protein: 42, fat: 26, carbs: 57 }, 480, 235, ["protein", "budget"], [
    i("turkey-mince", "Фарш индейки", 182, "г", "Мясо и рыба"), i("rice", "Рис, сухой вес", 40, "г", "Крупы"), i("mixed-veg", "Замороженная овощная смесь", 136, "г", "Овощи и фрукты"), i("peanut-butter", "Арахисовая паста", 11, "г", "Бакалея"), i("soy", "Соевый соус", 9, "мл", "Бакалея"), i("honey", "Мёд", 17, "г", "Бакалея"),
  ], [
    "Сварите рис; замороженные овощи прогрейте отдельно и слейте лишнюю воду.",
    "Подрумяньте фарш индейки на широкой сковороде до почти полной готовности.",
    "Смешайте тёплую арахисовую пасту, мёд, соевый соус, рисовый уксус и немного воды.",
    "Добавьте овощи к индейке, затем влейте соус и готовьте 1–2 минуты до загустения.",
    "Разложите рис и индейку по контейнерам; соус при разогреве можно разбавить ложкой воды.",
  ], 4, true, { provenance: mealPrepManualParsed("Peanut Turkey Stir Fry", "peanut-turkey-stir-fry", "https://mealprepmanual.com/wp-content/uploads/2024/04/Peanut-Turkey-Stir-Fry.jpg", "Индейка с замороженными овощами и арахисовым соусом", "Chinese cooking wine заменено рисовым или обычным мягким уксусом; острота снижена."), localization: { fit: "familiar", availability: "common", note: "Низкая сложность за счёт замороженных овощей и одной сковороды." }, storage: { freezerDays: 45 }, effort: { knifeActions: 0, cookware: 2, activeActions: 6, activeMinutes: 10, level: "low" } }),

  r("src-hot-honey-pork", "dinner", "Свинина с рисом, фасолью и острым мёдом", "🍯", 35, { kcal: 616, protein: 43, fat: 25, carbs: 55 }, 470, 220, ["protein", "budget"], [
    i("pork-mince", "Постный свиной фарш", 182, "г", "Мясо и рыба"), i("rice", "Рис, сухой вес", 40, "г", "Крупы"), i("green-beans", "Стручковая фасоль", 68, "г", "Овощи и фрукты"), i("pepper", "Болгарский перец", 30, "г", "Овощи и фрукты"), i("honey", "Мёд", 17, "г", "Бакалея"), i("soy", "Соевый соус", 9, "мл", "Бакалея"), i("chili-oil", "Масло чили", 6, "мл", "Бакалея"),
  ], [
    "Сварите рис, а перец и стручковую фасоль нарежьте небольшими кусочками.",
    "Подрумяньте фарш на сильном огне и уберите лишний вытопившийся жир.",
    "Добавьте овощи и готовьте до мягкости с лёгким хрустом.",
    "Смешайте мёд, соевый соус, уксус и масло чили; начните с половины острого компонента.",
    "Влейте соус к мясу, прогрейте до глазировки и разложите с рисом по контейнерам.",
  ], 4, true, { provenance: mealPrepManualParsed("Hot Honey Pork Stir Fry", "hot-honey-pork-stir-fry", "https://mealprepmanual.com/wp-content/uploads/2023/09/Hot-Honey-Pork-Stir-Fry.jpg", "Свинина с овощами в медово-остром соусе", "Crunchy chili garlic oil заменено обычным маслом чили; остроту можно свести к нулю."), localization: { fit: "adapted", availability: "common", note: "Основа блюда привычная: фарш, рис и овощи; необычен только сладко-острый соус." }, storage: { freezerDays: 45 }, effort: { knifeActions: 2, cookware: 3, activeActions: 10, activeMinutes: 15, level: "high" } }),
);

const generatedTitles: Record<MenuStyle, Record<MealSlot, string[]>> = {
  protein: {
    breakfast: ["Яичные маффины с индейкой", "Творожная запеканка с ягодами", "Белковые панкейки", "Омлет-ролл с курицей", "Сырники с протеиновым кремом"],
    lunch: ["Курица терияки с гречкой", "Индейка с булгуром и овощами", "Тунец с пастой и томатами", "Говядина с рисом и брокколи", "Куриные тефтели с киноа"],
    dinner: ["Лосось с зелёными овощами", "Курица с чечевицей", "Индейка с печёным картофелем", "Треска с фасолью", "Говяжьи тефтели с гречкой"],
    snack1: ["Творожные маффины", "Белковые конфеты с какао", "Яичные мини-запеканки", "Протеиновое печенье", "Роллы из индейки"],
    snack2: ["Творожный брауни", "Маффины с тунцом", "Белковые сырники мини", "Куриные суфле-кубики", "Протеиновые шарики"],
  },
  budget: {
    breakfast: ["Овсяная запеканка с яблоком", "Ленивые сырники", "Омлет с замороженными овощами", "Гречневые панкейки", "Яичные маффины с морковью"],
    lunch: ["Куриные бёдра с гречкой", "Чечевичная похлёбка с курицей", "Рис с индейкой и капустой", "Тушёная фасоль с фаршем", "Куриный плов с овощами"],
    dinner: ["Тефтели с картофельным пюре", "Курица с капустой в духовке", "Рыбные котлеты с гречкой", "Ленивые голубцы", "Чечевица с индейкой"],
    snack1: ["Овсяные квадратики", "Яичные маффины", "Творожное печенье", "Морковные сырники", "Домашний хумус с лепёшкой"],
    snack2: ["Запечённая овсянка мини", "Куриные маффины", "Творожные батончики", "Яблочные оладьи", "Яичные рулетики"],
  },
  paleo: {
    breakfast: ["Фриттата с индейкой и шпинатом", "Батат с яйцом и зеленью", "Куриные маффины с овощами", "Яблоко с запечёнными яйцами", "Омлет с лососем"],
    lunch: ["Курица с бататом и брокколи", "Говядина с тыквой", "Лосось с овощами гриль", "Индейка с цветной капустой", "Треска с корнеплодами"],
    dinner: ["Стейк с печёными овощами", "Курица с кабачком и травами", "Индейка с тыквенным пюре", "Белая рыба с брокколи", "Говяжьи котлеты с бататом"],
    snack1: ["Куриные мини-котлеты", "Яичные маффины со шпинатом", "Орехово-яблочные шарики", "Роллы из индейки и огурца", "Запечённый тунец с овощами"],
    snack2: ["Кокосовые шарики с орехами", "Мини-фриттата с лососем", "Бататовые маффины с индейкой", "Куриное суфле с зеленью", "Яблочные дольки с орехами"],
  },
  keto: {
    breakfast: ["Яичные маффины с беконом", "Омлет с лососем и шпинатом", "Кето-сырники", "Фриттата с курицей", "Запеканка с индейкой и сыром"],
    lunch: ["Курица с пюре из цветной капусты", "Лосось с брокколи и авокадо", "Говядина с кабачковой лапшой", "Индейка в сливочном соусе", "Тунец с зелёной фасолью"],
    dinner: ["Куриные бёдра с брокколи", "Лосось со шпинатом", "Говяжьи котлеты с цветной капустой", "Индейка с кабачком", "Треска с авокадо-соусом"],
    snack1: ["Кето-маффины с яйцом", "Сырные шарики с индейкой", "Кокосовые жир-бомбы", "Мини-фриттата с тунцом", "Ореховые батончики без сахара"],
    snack2: ["Яичные маффины с лососем", "Куриные рулетики с сыром", "Кето-брауни мини", "Запечённое авокадо с яйцом", "Сырные крекеры с индейкой"],
  },
};
const generatedMacros: Record<MenuStyle, Record<MealSlot, Macros>> = {
  protein: { breakfast: { kcal: 430, protein: 39, fat: 15, carbs: 34 }, lunch: { kcal: 530, protein: 53, fat: 17, carbs: 42 }, dinner: { kcal: 500, protein: 50, fat: 19, carbs: 34 }, snack1: { kcal: 245, protein: 29, fat: 8, carbs: 15 }, snack2: { kcal: 235, protein: 28, fat: 8, carbs: 13 } },
  budget: { breakfast: { kcal: 420, protein: 27, fat: 14, carbs: 48 }, lunch: { kcal: 515, protein: 39, fat: 16, carbs: 54 }, dinner: { kcal: 490, protein: 38, fat: 17, carbs: 48 }, snack1: { kcal: 230, protein: 18, fat: 8, carbs: 25 }, snack2: { kcal: 225, protein: 18, fat: 7, carbs: 24 } },
  paleo: { breakfast: { kcal: 410, protein: 31, fat: 22, carbs: 22 }, lunch: { kcal: 520, protein: 45, fat: 24, carbs: 31 }, dinner: { kcal: 495, protein: 44, fat: 23, carbs: 27 }, snack1: { kcal: 240, protein: 21, fat: 14, carbs: 12 }, snack2: { kcal: 235, protein: 20, fat: 14, carbs: 11 } },
  keto: { breakfast: { kcal: 430, protein: 30, fat: 31, carbs: 8 }, lunch: { kcal: 535, protein: 42, fat: 36, carbs: 10 }, dinner: { kcal: 510, protein: 41, fat: 35, carbs: 9 }, snack1: { kcal: 255, protein: 20, fat: 19, carbs: 6 }, snack2: { kcal: 250, protein: 21, fat: 18, carbs: 5 } },
};
const generatedIngredients: Record<MenuStyle, Record<MealSlot, Ingredient[]>> = {
  protein: { breakfast: [i("egg", "Яйца", 2, "шт.", "Молочное"), i("cottage", "Творог 5%", 120, "г", "Молочное"), i("turkey", "Филе индейки", 70, "г", "Мясо и рыба")], lunch: [i("chicken", "Куриное филе", 190, "г", "Мясо и рыба"), i("buckwheat", "Гречка", 55, "г", "Крупы"), i("broccoli", "Брокколи", 140, "г", "Овощи и фрукты")], dinner: [i("turkey", "Филе индейки", 190, "г", "Мясо и рыба"), i("potato", "Картофель", 150, "г", "Овощи и фрукты"), i("zucchini", "Кабачок", 150, "г", "Овощи и фрукты")], snack1: [i("cottage", "Творог 5%", 170, "г", "Молочное"), i("egg", "Яйца", 1, "шт.", "Молочное"), i("berries", "Ягоды", 50, "г", "Овощи и фрукты")], snack2: [i("turkey", "Филе индейки", 110, "г", "Мясо и рыба"), i("egg", "Яйца", 1, "шт.", "Молочное"), i("spinach", "Шпинат", 50, "г", "Овощи и фрукты")] },
  budget: { breakfast: [i("oats", "Овсяные хлопья", 60, "г", "Крупы"), i("egg", "Яйца", 1, "шт.", "Молочное"), i("apple", "Яблоко", 0.5, "шт.", "Овощи и фрукты")], lunch: [i("chicken-thigh", "Куриные бёдра", 190, "г", "Мясо и рыба"), i("buckwheat", "Гречка", 65, "г", "Крупы"), i("cabbage", "Капуста", 150, "г", "Овощи и фрукты")], dinner: [i("turkey-mince", "Фарш индейки", 170, "г", "Мясо и рыба"), i("potato", "Картофель", 190, "г", "Овощи и фрукты"), i("carrot", "Морковь", 1, "шт.", "Овощи и фрукты")], snack1: [i("cottage", "Творог 5%", 120, "г", "Молочное"), i("oats", "Овсяные хлопья", 35, "г", "Крупы"), i("egg", "Яйца", 1, "шт.", "Молочное")], snack2: [i("egg", "Яйца", 2, "шт.", "Молочное"), i("carrot", "Морковь", 0.5, "шт.", "Овощи и фрукты"), i("oats", "Овсяные хлопья", 25, "г", "Крупы")] },
  paleo: { breakfast: [i("egg", "Яйца", 2, "шт.", "Молочное"), i("turkey", "Филе индейки", 90, "г", "Мясо и рыба"), i("spinach", "Шпинат", 70, "г", "Овощи и фрукты")], lunch: [i("chicken", "Куриное филе", 190, "г", "Мясо и рыба"), i("sweet-potato", "Батат", 170, "г", "Овощи и фрукты"), i("broccoli", "Брокколи", 140, "г", "Овощи и фрукты")], dinner: [i("beef", "Постная говядина", 180, "г", "Мясо и рыба"), i("pumpkin", "Тыква", 180, "г", "Овощи и фрукты"), i("zucchini", "Кабачок", 140, "г", "Овощи и фрукты")], snack1: [i("turkey", "Филе индейки", 100, "г", "Мясо и рыба"), i("apple", "Яблоко", 0.5, "шт.", "Овощи и фрукты"), i("almond", "Миндаль", 18, "г", "Бакалея")], snack2: [i("tuna", "Тунец", 100, "г", "Мясо и рыба"), i("egg", "Яйца", 1, "шт.", "Молочное"), i("greens", "Зелень", 30, "г", "Овощи и фрукты")] },
  keto: { breakfast: [i("egg", "Яйца", 3, "шт.", "Молочное"), i("cheese", "Твёрдый сыр", 45, "г", "Молочное"), i("spinach", "Шпинат", 70, "г", "Овощи и фрукты")], lunch: [i("salmon", "Филе лосося", 170, "г", "Мясо и рыба"), i("cauliflower", "Цветная капуста", 190, "г", "Овощи и фрукты"), i("avocado", "Авокадо", 0.5, "шт.", "Овощи и фрукты")], dinner: [i("chicken-thigh", "Куриные бёдра", 200, "г", "Мясо и рыба"), i("broccoli", "Брокколи", 170, "г", "Овощи и фрукты"), i("olive-oil", "Оливковое масло", 15, "мл", "Бакалея")], snack1: [i("egg", "Яйца", 2, "шт.", "Молочное"), i("cheese", "Твёрдый сыр", 40, "г", "Молочное"), i("almond", "Миндаль", 15, "г", "Бакалея")], snack2: [i("turkey", "Филе индейки", 100, "г", "Мясо и рыба"), i("cream-cheese", "Творожный сыр", 35, "г", "Молочное"), i("spinach", "Шпинат", 40, "г", "Овощи и фрукты")] },
};
const titleIngredientRules: { pattern: RegExp; kind: "protein" | "base" | "extra"; ingredient: Ingredient }[] = [
  { pattern: /курин.*б[её]др/, kind: "protein", ingredient: i("chicken-thigh", "Куриные бёдра", 190, "г", "Мясо и рыба") },
  { pattern: /куриц|курин/, kind: "protein", ingredient: i("chicken", "Куриное филе", 180, "г", "Мясо и рыба") },
  { pattern: /индейк/, kind: "protein", ingredient: i("turkey", "Филе индейки", 180, "г", "Мясо и рыба") },
  { pattern: /лосос/, kind: "protein", ingredient: i("salmon", "Филе лосося", 170, "г", "Мясо и рыба") },
  { pattern: /туне?ц|тунц/, kind: "protein", ingredient: i("tuna", "Тунец", 140, "г", "Мясо и рыба") },
  { pattern: /говядин|говяж|стейк/, kind: "protein", ingredient: i("beef", "Постная говядина", 180, "г", "Мясо и рыба") },
  { pattern: /треск|белая рыба|рыбн/, kind: "protein", ingredient: i("cod", "Филе белой рыбы", 190, "г", "Мясо и рыба") },
  { pattern: /яйц|яич|омлет|фриттат/, kind: "protein", ingredient: i("egg", "Яйца", 3, "шт.", "Молочное") },
  { pattern: /творож|сырник/, kind: "protein", ingredient: i("cottage", "Творог 5%", 180, "г", "Молочное") },
  { pattern: /протеин|белков/, kind: "protein", ingredient: i("protein-powder", "Сывороточный протеин", 30, "г", "Бакалея") },
  { pattern: /бекон/, kind: "protein", ingredient: i("bacon", "Бекон", 70, "г", "Мясо и рыба") },
  { pattern: /хумус/, kind: "protein", ingredient: i("chickpeas", "Нут консервированный", 120, "г", "Бакалея") },
  { pattern: /чечевиц/, kind: "base", ingredient: i("lentils", "Чечевица", 70, "г", "Крупы") },
  { pattern: /фасол/, kind: "base", ingredient: i("white-beans", "Фасоль", 120, "г", "Бакалея") },
  { pattern: /греч/, kind: "base", ingredient: i("buckwheat", "Гречка", 60, "г", "Крупы") },
  { pattern: /рис|плов/, kind: "base", ingredient: i("rice", "Рис", 60, "г", "Крупы") },
  { pattern: /булгур/, kind: "base", ingredient: i("bulgur", "Булгур", 60, "г", "Крупы") },
  { pattern: /паст/, kind: "base", ingredient: i("pasta", "Паста", 65, "г", "Крупы") },
  { pattern: /киноа/, kind: "base", ingredient: i("quinoa", "Киноа", 55, "г", "Крупы") },
  { pattern: /овсян/, kind: "base", ingredient: i("oats", "Овсяные хлопья", 55, "г", "Крупы") },
  { pattern: /батат/, kind: "base", ingredient: i("sweet-potato", "Батат", 170, "г", "Овощи и фрукты") },
  { pattern: /картоф/, kind: "base", ingredient: i("potato", "Картофель", 180, "г", "Овощи и фрукты") },
  { pattern: /леп[её]ш/, kind: "base", ingredient: i("flatbread", "Цельнозерновая лепёшка", 60, "г", "Хлеб") },
  { pattern: /зел[её]н.*фасол|стручков.*фасол/, kind: "extra", ingredient: i("green-beans", "Стручковая фасоль", 140, "г", "Овощи и фрукты") },
  { pattern: /брокк/, kind: "extra", ingredient: i("broccoli", "Брокколи", 150, "г", "Овощи и фрукты") },
  { pattern: /цветн.*капуст/, kind: "extra", ingredient: i("cauliflower", "Цветная капуста", 170, "г", "Овощи и фрукты") },
  { pattern: /капуст/, kind: "extra", ingredient: i("cabbage", "Капуста", 160, "г", "Овощи и фрукты") },
  { pattern: /кабач/, kind: "extra", ingredient: i("zucchini", "Кабачок", 150, "г", "Овощи и фрукты") },
  { pattern: /тыкв/, kind: "extra", ingredient: i("pumpkin", "Тыква", 170, "г", "Овощи и фрукты") },
  { pattern: /шпинат/, kind: "extra", ingredient: i("spinach", "Шпинат", 70, "г", "Овощи и фрукты") },
  { pattern: /морков/, kind: "extra", ingredient: i("carrot", "Морковь", 1, "шт.", "Овощи и фрукты") },
  { pattern: /яблоч|яблок/, kind: "extra", ingredient: i("apple", "Яблоко", 1, "шт.", "Овощи и фрукты") },
  { pattern: /ягод/, kind: "extra", ingredient: i("berries", "Ягоды", 70, "г", "Овощи и фрукты") },
  { pattern: /авокад/, kind: "extra", ingredient: i("avocado", "Авокадо", 0.5, "шт.", "Овощи и фрукты") },
  { pattern: /томат/, kind: "extra", ingredient: i("tomato", "Томаты", 1, "шт.", "Овощи и фрукты") },
  { pattern: /огур/, kind: "extra", ingredient: i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты") },
  { pattern: /корнеплод/, kind: "extra", ingredient: i("root-veg", "Корнеплоды", 170, "г", "Овощи и фрукты") },
  { pattern: /овощ/, kind: "extra", ingredient: i("mixed-veg", "Овощная смесь", 160, "г", "Овощи и фрукты") },
  { pattern: /зеленью|трав/, kind: "extra", ingredient: i("greens", "Зелень", 25, "г", "Овощи и фрукты") },
  { pattern: /сливочн/, kind: "extra", ingredient: i("cream", "Сливки 20%", 70, "мл", "Молочное") },
  { pattern: /кокос/, kind: "extra", ingredient: i("coconut-flakes", "Кокосовая стружка", 25, "г", "Бакалея") },
  { pattern: /орех/, kind: "extra", ingredient: i("almond", "Миндаль", 22, "г", "Бакалея") },
  { pattern: /какао|брауни|шоколад/, kind: "extra", ingredient: i("cocoa", "Какао", 12, "г", "Бакалея") },
  { pattern: /сыр(?!ник)/, kind: "extra", ingredient: i("cheese", "Твёрдый сыр", 45, "г", "Молочное") },
];
function ingredientsForTitle(title: string, base: Ingredient[], style: MenuStyle) {
  const normalized = title.toLowerCase();
  let matched = titleIngredientRules.filter((rule) => rule.pattern.test(normalized));
  if (/курин.*б[её]др/.test(normalized)) matched = matched.filter((rule) => rule.ingredient.id !== "chicken");
  if (/зел[её]н.*фасол|стручков.*фасол/.test(normalized)) matched = matched.filter((rule) => rule.ingredient.id !== "white-beans");
  if (/цветн.*капуст/.test(normalized)) matched = matched.filter((rule) => rule.ingredient.id !== "cabbage");

  const merged = new Map<string, Ingredient>();
  const add = (ingredient: Ingredient) => merged.set(`${ingredient.id}:${ingredient.unit}`, ingredient);
  matched.forEach((rule) => add(rule.ingredient));

  const animalProteinIds = new Set(["chicken", "chicken-thigh", "turkey", "turkey-mince", "beef", "salmon", "cod", "tuna", "bacon"]);
  const proteinIds = new Set([...animalProteinIds, "egg", "cottage", "tofu", "protein-powder", "hummus", "chickpeas"]);
  const baseIds = new Set(["oats", "buckwheat", "rice", "brown-rice", "quinoa", "lentils", "white-beans", "potato", "sweet-potato", "bulgur", "pasta", "flatbread"]);
  const sweet = /творожн.*(?:запеканк|маффин)|сырник|панкейк|конфет|печень|брауни|батончик|овсян.*(?:запеканк|квадратик)|яблоч.*олад|(?:кокосов|орехов|протеинов).*шарик|жир-бомб/.test(normalized);
  const formed = /тефтел|котлет|голубц/.test(normalized);
  const baked = /маффин|запеканк|панкейк|сырник|печень|брауни|олад|суфле|тефтел|котлет|голубц|крекер|квадратик/.test(normalized);
  const needsFlour = /маффин|панкейк|сырник|печень|брауни|олад|крекер|квадратик|творожн.*запеканк/.test(normalized);

  if (formed && ![...merged.values()].some((ingredient) => animalProteinIds.has(ingredient.id))) add(i("turkey-mince", "Фарш индейки", 170, "г", "Мясо и рыба"));
  if (/голубц/.test(normalized) && !merged.has("rice:г")) add(i("rice", "Рис", 45, "г", "Крупы"));
  if (baked && !merged.has("egg:шт.")) add(i("egg", "Яйца", 1, "шт.", "Молочное"));
  if (needsFlour && ![...merged.values()].some((ingredient) => baseIds.has(ingredient.id))) {
    add(style === "keto" || style === "paleo" ? i("almond-flour", "Миндальная мука", 35, "г", "Бакалея") : i("oats", "Овсяные хлопья", 35, "г", "Крупы"));
  }
  if (/терияки/.test(normalized)) add(i("soy", "Соевый соус", 20, "мл", "Бакалея"));
  if (/домашний хумус/.test(normalized)) {
    add(i("tahini", "Тахини", 15, "г", "Бакалея"));
    add(i("lemon-juice", "Лимонный сок", 10, "мл", "Овощи и фрукты"));
    add(i("olive-oil", "Оливковое масло", 5, "мл", "Бакалея"));
    add(i("garlic", "Чеснок", 0.25, "шт.", "Овощи и фрукты"));
  }
  if (/рулл|ролл|рулет/.test(normalized) && !sweet) {
    add(style === "paleo" ? i("avocado", "Авокадо", 0.5, "шт.", "Овощи и фрукты") : i("cream-cheese", "Творожный сыр", 35, "г", "Молочное"));
    if (!merged.has("cucumber:шт.")) add(i("cucumber", "Огурец", 0.5, "шт.", "Овощи и фрукты"));
  }
  if (/конфет|шарик|батончик|жир-бомб/.test(normalized)) {
    if (!merged.has("almond:г")) add(i("almond", "Миндаль", 22, "г", "Бакалея"));
    add(style === "keto" || style === "paleo" || /жир-бомб/.test(normalized) ? i("coconut-oil", "Кокосовое масло", 15, "мл", "Бакалея") : i("peanut-butter", "Арахисовая паста", 20, "г", "Бакалея"));
  }
  if ((/яйц|яич/.test(normalized)) && /маффин|запеканк/.test(normalized) && merged.size < 2) add(i("mixed-veg", "Овощная смесь", 120, "г", "Овощи и фрукты"));

  if (merged.size < 2) {
    const hasProtein = [...merged.values()].some((ingredient) => proteinIds.has(ingredient.id));
    const hasBase = [...merged.values()].some((ingredient) => baseIds.has(ingredient.id));
    for (const ingredient of base) {
      if (hasProtein && proteinIds.has(ingredient.id)) continue;
      if (hasBase && baseIds.has(ingredient.id)) continue;
      if (sweet && animalProteinIds.has(ingredient.id)) continue;
      if (style === "keto" && baseIds.has(ingredient.id)) continue;
      if (style === "paleo" && (baseIds.has(ingredient.id) || ["cottage", "cheese", "cream-cheese"].includes(ingredient.id))) continue;
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
  return !/авокад.*яйц|яблочные дольки|роллы из индейки(?: и огурца)?$/i.test(title);
}
for (const style of Object.keys(generatedTitles) as MenuStyle[]) for (const slot of Object.keys(mealMeta) as MealSlot[]) generatedTitles[style][slot].forEach((title, index) => recipes.push(r(`gen-${style}-${slot}-${index}`, slot, title, mealMeta[slot].icon, 18 + index * 3, scaleMacros(generatedMacros[style][slot], 0.94 + index * 0.03), slot.startsWith("snack") ? 240 : 410, style === "budget" ? 105 + index * 9 : 175 + index * 18, [style], ingredientsForTitle(title, generatedIngredients[style][slot], style), commonSteps, 4, generatedRecipeFreezable(title), { provenance: { kind: "generated", basedOn: generatedReferences[style] } })));

const recipesById = Object.fromEntries(recipes.map((recipe) => [recipe.id, recipe])) as Record<string, Recipe>;
function clientId() { const key = "mise-client-id"; const saved = localStorage.getItem(key); if (saved) return saved; const created = crypto.randomUUID(); localStorage.setItem(key, created); return created; }
function deviceId() { const key = "mise-device-id"; const saved = localStorage.getItem(key); if (saved) return saved; const created = crypto.randomUUID(); localStorage.setItem(key, created); return created; }
function parseDate(value: string) { return new Date(`${value}T12:00:00`); }
function isoDate(date: Date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }
function addDays(value: string, amount: number) { const date = parseDate(value); date.setDate(date.getDate() + amount); return isoDate(date); }
function daysInclusive(start: string, end: string) { return Math.floor((parseDate(end).getTime() - parseDate(start).getTime()) / 86_400_000) + 1; }
function formatDate(value: string, withWeekday = false) { return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", ...(withWeekday ? { weekday: "short" } : {}) }).format(parseDate(value)).replace(".", ""); }
function round(value: number, digits = 0) { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function macroCalories(macros: Pick<Macros, "protein" | "fat" | "carbs">) { return macros.protein * 4 + macros.fat * 9 + macros.carbs * 4; }
function macrosForCalories(kcal: number, preset: MacroPresetOption): Macros { const safeKcal = Math.max(0, round(kcal)); const shares = macroPresetMeta[preset]; return { kcal: safeKcal, protein: round((safeKcal * shares.protein) / 4), fat: round((safeKcal * shares.fat) / 9), carbs: round((safeKcal * shares.carbs) / 4) }; }
function recalculateDailyMacros(kcal: number, current: Macros, preset: MacroPreset): Macros { const safeKcal = Math.max(0, round(kcal)); if (preset !== "custom") return macrosForCalories(safeKcal, preset); const currentKcal = macroCalories(current); if (currentKcal <= 0) return macrosForCalories(safeKcal, "balanced"); const factor = safeKcal / currentKcal; return { kcal: safeKcal, protein: round(current.protein * factor), fat: round(current.fat * factor), carbs: round(current.carbs * factor) }; }
function scaleMacros(macros: Macros, factor: number): Macros { return { kcal: round(macros.kcal * factor), protein: round(macros.protein * factor), fat: round(macros.fat * factor), carbs: round(macros.carbs * factor) }; }
function addMacros(values: Macros[]): Macros { return values.reduce<Macros>((sum, item) => ({ kcal: sum.kcal + item.kcal, protein: sum.protein + item.protein, fat: sum.fat + item.fat, carbs: sum.carbs + item.carbs }), { kcal: 0, protein: 0, fat: 0, carbs: 0 }); }
const singleMealShares: Record<MealSlot, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.4, snack1: 0.1, snack2: 0.1 };
function shareFor(person: Person, slot: MealSlot) { return person.includedSlots.includes(slot) ? singleMealShares[slot] : 0; }
function targetFor(person: Person, slot: MealSlot): Macros { return scaleMacros(person.daily, shareFor(person, slot)); }
function plannedTargetsFor(person: Person): Macros { const share = [...new Set(person.includedSlots)].reduce((sum, slot) => sum + singleMealShares[slot], 0); return scaleMacros(person.daily, share); }
function macroDifference(goal: Macros, planned: Macros): Macros { return { kcal: round(goal.kcal - planned.kcal), protein: round(goal.protein - planned.protein), fat: round(goal.fat - planned.fat), carbs: round(goal.carbs - planned.carbs) }; }
const proteinIngredientIds = new Set(["chicken", "chicken-thigh", "chicken-mince", "turkey", "turkey-mince", "turkey-slices", "beef", "beef-mince", "pork-mince", "salmon", "cod", "tuna", "egg", "cottage", "yogurt", "kefir", "tofu", "hummus", "protein-powder"]);
const carbIngredientIds = new Set(["oats", "buckwheat", "rice", "brown-rice", "quinoa", "lentils", "white-beans", "red-beans", "potato", "sweet-potato", "bulgur", "pasta", "flatbread", "tortilla", "bread"]);
const fatIngredientIds = new Set(["oil", "olive-oil", "coconut-oil", "peanut-butter", "almond-paste", "almond", "walnut", "seeds", "chia", "avocado", "cheese", "feta", "mozzarella", "cream-cheese", "cream", "butter", "coconut-milk", "mayonnaise"]);
function portionFor(person: Person, slot: MealSlot, recipe: Recipe, tuning?: RecipeTuning) {
  const target = targetFor(person, slot); const factor = target.kcal > 0 ? target.kcal / recipe.macros.kcal : 0; const proportional = scaleMacros(recipe.macros, factor);
  const automatic = { protein: proportional.protein ? clamp(target.protein / proportional.protein, ...recipe.flex.protein) : 1, fat: proportional.fat ? clamp(target.fat / proportional.fat, ...recipe.flex.fat) : 1, carbs: proportional.carbs ? clamp(target.carbs / proportional.carbs, ...recipe.flex.carbs) : 1 };
  const ratios = tuning ? { protein: clamp(tuning.protein, ...recipe.flex.protein), fat: clamp(tuning.fat, ...recipe.flex.fat), carbs: clamp(tuning.carbs, ...recipe.flex.carbs) } : automatic;
  const protein = round(proportional.protein * ratios.protein);
  const fat = round(proportional.fat * ratios.fat);
  const carbs = round(proportional.carbs * ratios.carbs);
  const actual = { kcal: round(protein * 4 + fat * 9 + carbs * 4), protein, fat, carbs };
  const gramsFactor = factor * (ratios.protein * 0.35 + ratios.fat * 0.2 + ratios.carbs * 0.45);
  return { target, factor, actual, ratios, grams: round(recipe.servingWeight * gramsFactor) };
}
function ingredientRatioFor(ingredient: Ingredient, ratios: RecipeTuning) {
  if (proteinIngredientIds.has(ingredient.id)) return ratios.protein;
  if (carbIngredientIds.has(ingredient.id)) return ratios.carbs;
  if (fatIngredientIds.has(ingredient.id)) return ratios.fat;
  return 1;
}
function ingredientScaleFor(ingredient: Ingredient, portion: ReturnType<typeof portionFor>) {
  return portion.factor * ingredientRatioFor(ingredient, portion.ratios);
}
function buildBatches(start: string, periodDays: number, cookEveryDays: number): Batch[] { const result: Batch[] = []; let offset = 0; while (offset < periodDays) { const days = Math.min(cookEveryDays, periodDays - offset); result.push({ id: `batch-${result.length}`, index: result.length, start: addDays(start, offset), end: addDays(start, offset + days - 1), days }); offset += days; } return result; }
function notificationPlanFor(plan: ActivePlan): NotificationPlan {
  const frozenUseDates = plan.batches.flatMap((batch) => Array.from({ length: batch.days }, (_, dayIndex) => ({ date: addDays(batch.start, dayIndex), dayIndex })).filter(({ dayIndex }) => plan.mealSlots.some((slot) => { const recipe = recipesById[plan.selections[selectionKey(batch, slot)]]; return Boolean(recipe?.freezable && dayIndex >= recipe.storageDays); })).map(({ date }) => date));
  return { id: plan.id, end: plan.end, batches: plan.batches.map(({ id, index, start }) => ({ id, index, start })), frozenUseDates };
}
function selectionKey(batch: Batch, slot: MealSlot) { return `${batch.id}:${slot}`; }
function tuningKey(batch: Batch, slot: MealSlot, person: Person) { return `${batch.id}:${slot}:${person.id}`; }
function buildShopping(plan: Pick<ActivePlan, "batches" | "selections" | "people" | "tuning">): ShoppingItem[] { const aggregate = new Map<string, ShoppingItem>(); for (const batch of plan.batches) for (const slot of Object.keys(mealMeta) as MealSlot[]) { const recipe = recipesById[plan.selections[selectionKey(batch, slot)]]; if (!recipe) continue; const portions = plan.people.filter((person) => person.includedSlots.includes(slot)).map((person) => portionFor(person, slot, recipe, plan.tuning?.[tuningKey(batch, slot, person)])); for (const ingredient of recipe.ingredients) { const key = `${ingredient.id}:${ingredient.unit}`; const existing = aggregate.get(key); const totalScale = portions.reduce((sum, portion) => sum + ingredientScaleFor(ingredient, portion), 0) * batch.days; const quantity = ingredient.quantity * totalScale; if (existing) existing.quantity += quantity; else aggregate.set(key, { ...ingredient, key, quantity, checked: false }); } } return [...aggregate.values()].filter((item) => item.quantity > 0).map((item) => ({ ...item, quantity: item.unit === "шт." ? Math.ceil(item.quantity) : Math.ceil(item.quantity / 10) * 10 })).sort((a, b) => a.group.localeCompare(b.group, "ru") || a.name.localeCompare(b.name, "ru")); }
function styleScore(recipe: Recipe, style: MenuStyle) { if (style === "protein") return recipe.macros.protein * 3 - recipe.macros.kcal * 0.025 + (recipe.tags.includes(style) ? 50 : 0); if (style === "budget") return 400 - recipe.cost + (recipe.tags.includes(style) ? 70 : 0); if (style === "keto") return 160 - recipe.macros.carbs * 3 + (recipe.tags.includes(style) ? 80 : 0); return (recipe.tags.includes(style) ? 120 : 0) + recipe.macros.protein - recipe.macros.carbs * 0.5; }
type CatalogFilters = { origin?: RecipeOrigin; effort?: "low" | "high"; time?: "quick" | "medium" | "long"; limit?: number | "all" };
function timeBand(recipe: Recipe): NonNullable<CatalogFilters["time"]> { return recipe.time <= 20 ? "quick" : recipe.time <= 40 ? "medium" : "long"; }
function candidateRecipes(slot: MealSlot, style: MenuStyle, people: Person[] = [], batchDays = 1, filters: CatalogFilters = {}) { const sorted = recipes.filter((recipe) => recipe.slot === slot && recipe.tags.includes(style) && (recipe.storageDays >= batchDays || recipe.freezable) && (!filters.origin || recipe.provenance.kind === filters.origin) && (!filters.effort || recipe.effort.level === filters.effort) && (!filters.time || timeBand(recipe) === filters.time)).sort((a, b) => (fitScore(b, people, slot) * 4 + styleScore(b, style) + (b.provenance.kind === "parsed" ? 12 : 0)) - (fitScore(a, people, slot) * 4 + styleScore(a, style) + (a.provenance.kind === "parsed" ? 12 : 0))); return filters.limit === "all" ? sorted : sorted.slice(0, filters.limit ?? 5); }
function fitScore(recipe: Recipe, people: Person[], slot: MealSlot) { const eaters = people.filter((person) => person.includedSlots.includes(slot)); if (!eaters.length) return 0; const scores = eaters.map((person) => { const { target, actual } = portionFor(person, slot, recipe); if (target.kcal <= 0) return 0; const p = Math.abs(actual.protein - target.protein) / Math.max(target.protein, 1); const f = Math.abs(actual.fat - target.fat) / Math.max(target.fat, 1); const c = Math.abs(actual.carbs - target.carbs) / Math.max(target.carbs, 1); return Math.max(0, Math.round(100 - (p * 45 + f * 25 + c * 20))); }); return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length); }
function styleNote(recipe: Recipe, style: MenuStyle) { if (style === "protein") return `${recipe.macros.protein} г белка`; if (style === "budget") return `≈ ${recipe.cost} ₽ / порция`; if (style === "keto") return `${recipe.macros.carbs} г углеводов`; return recipe.tags.includes("paleo") ? "Палео-совместимо" : "Легко адаптировать"; }
function newPerson(index = 0): Person { return { id: `person-${Date.now()}-${index}`, name: index === 0 ? "Максим" : `Человек ${index + 1}`, daily: { ...defaultMacros }, macroPreset: "balanced", includedSlots: ["breakfast", "lunch", "dinner"] }; }
function groupedShopping(items: ShoppingItem[]) { return items.reduce<Record<string, ShoppingItem[]>>((groups, item) => { (groups[item.group] ??= []).push(item); return groups; }, {}); }

export default function Home() {
  const [tab, setTab] = useState<Tab>("week");
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);
  const [recipeContext, setRecipeContext] = useState<RecipeContext | null>(null);
  const [builderEntry, setBuilderEntry] = useState<BuilderEntry>({ step: 0 });
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("done");
  const [onboardingReturnTab, setOnboardingReturnTab] = useState<Tab | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notificationSetupOpen, setNotificationSetupOpen] = useState(false);
  const persistQueue = useRef<Promise<void>>(Promise.resolve());
  // eslint-disable-next-line react-hooks/set-state-in-effect -- bootstraps onboarding and persisted plan state once on mount
  useEffect(() => { let mounted = true; if (!localStorage.getItem(onboardingStorageKey)) setOnboardingStep("welcome"); else if (!localStorage.getItem(installOfferStorageKey)) setOnboardingStep("install"); else if (!localStorage.getItem(prepGuideStorageKey)) setOnboardingStep("prep-offer"); if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined); const params = new URLSearchParams(location.search); if (params.get("tab") === "shopping") setTab("shopping"); if (params.get("new-plan") === "1") { setBuilderEntry({ step: 0 }); setTab("builder"); } fetch("/api/plans", { headers: { "X-Mise-Client": clientId() } }).then((response) => response.ok ? response.json() : Promise.reject()).then((data: { plan?: ActivePlan | null }) => { if (mounted && data.plan) setActivePlan(data.plan); }).catch(() => { if (mounted) setLoadError(true); }).finally(() => { if (mounted) setLoadingPlan(false); }); return () => { mounted = false; }; }, []);
  async function persistPlan(plan: ActivePlan) { const run = async () => { const response = await fetch("/api/plans", { method: "POST", headers: { "Content-Type": "application/json", "X-Mise-Client": clientId() }, body: JSON.stringify({ plan }) }); if (!response.ok) throw new Error("Не удалось сохранить план"); }; persistQueue.current = persistQueue.current.catch(() => undefined).then(run); await persistQueue.current; setActivePlan(plan); }
  function navigate(next: Tab) { setRecipeContext(null); if (next === "builder") setBuilderEntry({ step: 0 }); setTab(next); }
  function editDayMenu(batchId: string) { setRecipeContext(null); setBuilderEntry({ step: 5, batchId, returnTab: "week" }); setTab("builder"); }
  function editPeople() { setRecipeContext(null); setBuilderEntry({ step: 3, returnTab: "profile" }); setTab("builder"); }
  function completeCoreOnboarding() { localStorage.setItem(onboardingStorageKey, "complete"); setOnboardingStep("install"); }
  function completeInstallOffer() { localStorage.setItem(installOfferStorageKey, "complete"); setOnboardingStep("prep-offer"); }
  function finishOnboarding() { localStorage.setItem(onboardingStorageKey, "complete"); localStorage.setItem(installOfferStorageKey, "complete"); localStorage.setItem(prepGuideStorageKey, "complete"); setOnboardingStep("done"); const destination = onboardingReturnTab ?? (activePlan ? "week" : "builder"); setOnboardingReturnTab(null); navigate(destination); }
  if (onboardingStep !== "done") return <OnboardingScreen step={onboardingStep} hasPlan={Boolean(activePlan)} onNext={() => setOnboardingStep("guide")} onCoreComplete={completeCoreOnboarding} onInstallComplete={completeInstallOffer} onShowPrepGuide={() => setOnboardingStep("prep-guide")} onBack={() => setOnboardingStep(onboardingStep === "prep-guide" ? "prep-offer" : onboardingStep === "install" ? "guide" : "welcome")} onFinish={finishOnboarding} />;
  if (recipeContext) return <RecipeView context={recipeContext} onBack={() => setRecipeContext(null)} onChangePlan={recipeContext.plan ? async (plan) => { await persistPlan(plan); setRecipeContext((current) => current ? { ...current, plan } : current); } : undefined} />;
  if (tab === "builder") return <PlanBuilder initialPlan={activePlan} initialStep={builderEntry.step} initialBatchId={builderEntry.batchId} onClose={() => navigate(builderEntry.returnTab ?? "week")} onSaved={(plan, destination) => { setActivePlan(plan); navigate(destination); }} persistPlan={persistPlan} />;
  const titles = { week: { kicker: "Mise · на этой неделе", title: "План на неделю" }, recipes: { kicker: "Под ваши цели", title: "Рецепты" }, shopping: { kicker: activePlan ? `${formatDate(activePlan.start)} — ${formatDate(activePlan.end)}` : "Список появится вместе с планом", title: "Покупки" }, profile: { kicker: "Люди и цели", title: "Профиль" } };
  const currentTitle = titles[tab as Exclude<Tab, "builder">];
  return <main className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="ambient ambient-three" />
    <header className="app-header"><div><p className="kicker">{currentTitle.kicker}</p><h1>{currentTitle.title}</h1></div><button className="avatar glass" onClick={() => navigate("profile")} aria-label="Открыть профиль">М</button></header>
    {tab === "week" && <WeekScreen key={activePlan?.id ?? "empty"} plan={activePlan} loading={loadingPlan} loadError={loadError} onBuild={() => navigate("builder")} onEditMenu={editDayMenu} onOpenRecipe={setRecipeContext} />}
    {tab === "recipes" && <RecipesScreen onOpenRecipe={(recipe) => setRecipeContext({ recipe })} />}
    {tab === "shopping" && <ShoppingScreen plan={activePlan} onBuild={() => navigate("builder")} onChange={async (next) => { const previous = activePlan; setActivePlan(next); try { await persistPlan(next); return true; } catch { if (previous) setActivePlan(previous); return false; } }} />}
    {tab === "profile" && <ProfileScreen people={activePlan?.people ?? [newPerson()]} hasPlan={Boolean(activePlan)} onConfigure={editPeople} onOpenTutorial={() => { setOnboardingReturnTab("profile"); setOnboardingStep("welcome"); }} onOpenPrepGuide={() => { setOnboardingReturnTab("profile"); setOnboardingStep("prep-guide"); }} onNotifications={() => setNotificationSetupOpen(true)} />}
    {activePlan && notificationSetupOpen && <Modal className="success-sheet glass notification-modal" labelledBy="notifications-title" onClose={() => setNotificationSetupOpen(false)}><NotificationSetupPanel plan={notificationPlanFor(activePlan)} clientId={clientId()} deviceId={deviceId()} onDone={() => setNotificationSetupOpen(false)} onCancel={() => setNotificationSetupOpen(false)} /></Modal>}
    <BottomNav tab={tab} onNavigate={navigate} />
  </main>;
}

function Modal({ children, onClose, labelledBy, className = "" }: { children: React.ReactNode; onClose: () => void; labelledBy: string; className?: string }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  return <div className="modal-backdrop"><button className="modal-dismiss" onClick={onClose} aria-label="Закрыть окно" /><section ref={dialogRef} tabIndex={-1} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>{children}</section></div>;
}

function OnboardingScreen({ step, hasPlan, onNext, onCoreComplete, onInstallComplete, onShowPrepGuide, onBack, onFinish: onDone }: { step: Exclude<OnboardingStep, "done">; hasPlan: boolean; onNext: () => void; onCoreComplete: () => void; onInstallComplete: () => void; onShowPrepGuide: () => void; onBack: () => void; onFinish: () => void }) {
  if (step === "install") return <InstallOffer onBack={onBack} onContinue={onInstallComplete} />;
  if (step === "prep-offer") return <PrepGuideOffer hasPlan={hasPlan} onShow={onShowPrepGuide} onSkip={onDone} />;
  if (step === "prep-guide") return <MealPrepGuide hasPlan={hasPlan} onBack={onBack} onFinish={onDone} />;
  const onFinish = onCoreComplete;
  return <main className="app-shell onboarding-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="ambient ambient-three" /><header className="onboarding-header"><div className="mise-mark" aria-label="Mise">M</div><span>mise</span>{step === "guide" && <button className="text-button" onClick={onFinish}>Пропустить</button>}</header>{step === "welcome" ? <section className="onboarding-welcome"><div className="onboarding-visual" aria-hidden><div className="visual-card visual-week"><span>▦</span><small>7 дней</small></div><div className="visual-card visual-shopping"><span>⌑</span><small>покупки</small></div><div className="visual-dish"><span>🍲</span></div><div className="visual-card visual-prep"><span>♨</span><small>готовка</small></div></div><p className="kicker">Милпреп без ежедневных расчётов</p><h1>Питаться легко,<br />когда есть план</h1><p className="onboarding-lead">Mise рассчитает меню, покупки и порции на несколько дней — под цели каждого человека.</p><div className="onboarding-time glass-card"><span>◷</span><p><b>Первый план — около 5–10 минут</b><small>Потом можно идти в магазин и готовить без новой арифметики.</small></p></div><div className="onboarding-actions"><button className="primary-button" onClick={onNext}>Показать, что получится <span>→</span></button><button className="text-button" onClick={onFinish}>{hasPlan ? "Вернуться к плану" : "Составить план сразу"}</button></div></section> : <section className="onboarding-guide"><div className="guide-progress" aria-label="Шаг 2 из 2"><span /><span className="active" /></div><p className="kicker">Один план · три результата</p><h1>Всё нужное для цикла милпрепа</h1><p className="onboarding-lead">Mise ведёт от решения «что есть» до подписанных готовых порций.</p><div className="result-cards"><article className="result-card glass-card"><span className="result-number">1</span><div className="result-icon result-week">▦</div><div><h2>План недели</h2><p>Что есть каждый день и когда готовить следующую партию.</p></div></article><article className="result-card glass-card"><span className="result-number">2</span><div className="result-icon result-shopping">⌑</div><div><h2>Общие покупки</h2><p>Один список с количествами для всех людей и всех блюд.</p></div></article><article className="result-card glass-card"><span className="result-number">3</span><div className="result-icon result-prep">♨</div><div><h2>Готовка и контейнеры</h2><p>Шаги, порции и подписи: имя, дата и приём пищи.</p></div></article></div><aside className="estimate-note"><span>i</span><p><b>Без ложной точности</b><small>КБЖУ и сроки хранения — полезные ориентиры, а не медицинская или лабораторная гарантия.</small></p></aside><div className="onboarding-actions"><button className="primary-button" onClick={onFinish}>{hasPlan ? "Вернуться к плану" : "Составить первый план"} <span>→</span></button><button className="text-button" onClick={onBack}>Назад</button></div></section>}</main>;
}

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function InstallOffer({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setStandalone(window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)));
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", capture);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("beforeinstallprompt", capture); };
  }, []);
  async function install() { if (prompt) { await prompt.prompt(); await prompt.userChoice; } onContinue(); }
  return <main className="app-shell onboarding-shell install-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="ambient ambient-three" /><header className="onboarding-header"><div className="mise-mark" aria-label="Mise">M</div><span>mise</span><button className="text-button" onClick={onContinue}>Не сейчас</button></header><section className="install-offer"><div className="install-phone" aria-hidden><div className="install-status">9:41</div><div className="install-icon">M</div><div className="install-notification"><span>🔔</span><div><b>Mise</b><small>Пора проверить покупки</small></div><em>сейчас</em></div></div><p className="kicker">Следующий шаг</p><h1>{standalone ? "Mise уже на экране Домой" : "Добавьте Mise на экран Домой"}</h1><p className="onboarding-lead">Так Mise открывается как приложение и сможет присылать выбранные вами напоминания о покупках, готовке и разморозке.</p>{!standalone && !prompt && <div className="install-instructions glass-card">{isIos ? <><p><span>1</span><b>Нажмите «Поделиться»</b><small>Кнопка со стрелкой вверх в Safari</small></p><p><span>2</span><b>Выберите «На экран Домой»</b><small>Затем подтвердите добавление Mise</small></p></> : <p><span>＋</span><b>Добавьте сайт через меню браузера</b><small>Ищите пункт «Установить приложение» или «На главный экран».</small></p>}</div>}<aside className="estimate-note install-privacy"><span>i</span><p><b>Разрешение спросим позже</b><small>Сейчас уведомления не включаются. Сначала вы создадите план, выберете время и увидите расписание.</small></p></aside><div className="onboarding-actions"><button className="primary-button" onClick={install}>{standalone ? "Продолжить" : prompt ? "Добавить Mise" : "Готово, дальше"} <span>→</span></button><button className="text-button" onClick={onBack}>Назад</button></div></section></main>;
}
function PrepGuideOffer({ hasPlan, onShow, onSkip }: { hasPlan: boolean; onShow: () => void; onSkip: () => void }) {
  return <main className="app-shell onboarding-shell prep-offer-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="ambient ambient-three" /><header className="onboarding-header"><div className="mise-mark" aria-label="Mise">M</div><span>mise</span><button className="text-button" onClick={onSkip}>Не сейчас</button></header><section className="prep-offer"><div className="prep-offer-visual" aria-hidden><div className="prep-offer-main">🥣</div><span className="prep-float prep-float-containers">▤ Контейнеры</span><span className="prep-float prep-float-cooking">♨ Готовка</span><span className="prep-float prep-float-labels">✎ Подписи</span></div><p className="kicker">Перед первым милпрепом</p><h1>Нужна инструкция<br />по милпрепу?</h1><p className="onboarding-lead">За пару минут покажем, как подготовить контейнеры, организовать готовку, разложить порции и хранить их.</p><div className="prep-topic-row"><span>Контейнеры</span><span>Готовка</span><span>Раскладка</span><span>Хранение</span></div><div className="onboarding-actions"><button className="primary-button" onClick={onShow}>Да, показать <span>→</span></button><button className="text-button" onClick={onSkip}>{hasPlan ? "Вернуться к плану" : "Нет, составить план"}</button></div></section></main>;
}

function MealPrepGuide({ hasPlan, onBack, onFinish }: { hasPlan: boolean; onBack: () => void; onFinish: () => void }) {
  const steps = [
    { icon: "▤", title: "Подготовьте контейнеры", text: "По одному контейнеру на каждую порцию, подходящие крышки и наклейки или маркер для подписей." },
    { icon: "♨", title: "Готовьте партиями", text: "Сверьтесь со списком покупок, начните с самых долгих блюд и следуйте шагам в карточках рецептов." },
    { icon: "◎", title: "Охладите и разложите", text: "Не держите готовую еду надолго в тепле. Разделите её по рассчитанным Mise порциям." },
    { icon: "❄", title: "Подпишите и уберите", text: "Укажите имя, дату и приём пищи. Ближние порции храните в холодильнике, остальные заморозьте по подсказке плана." },
  ];
  return <main className="app-shell onboarding-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="ambient ambient-three" /><header className="onboarding-header"><div className="mise-mark" aria-label="Mise">M</div><span>mise</span><button className="text-button" onClick={onFinish}>Закрыть</button></header><section className="onboarding-guide prep-guide"><p className="kicker">Практическая инструкция</p><h1>От продуктов до готовых контейнеров</h1><p className="onboarding-lead">Простой порядок, чтобы не считать и не вспоминать всё во время готовки.</p><div className="prep-checklist">{steps.map((item, index) => <article className="prep-guide-card glass-card" key={item.title}><span className="prep-step-number">{index + 1}</span><div className="prep-step-icon">{item.icon}</div><div><h2>{item.title}</h2><p>{item.text}</p></div></article>)}</div><aside className="estimate-note prep-storage-note"><span>i</span><p><b>Для каждого блюда — свои условия</b><small>Проверьте срок, способ хранения и разморозку в карточке конкретного рецепта.</small></p></aside><div className="onboarding-actions"><button className="primary-button" onClick={onFinish}>{hasPlan ? "Вернуться к плану" : "Составить первый план"} <span>→</span></button><button className="text-button" onClick={onBack}>Назад</button></div></section></main>;
}

function BottomNav({ tab, onNavigate }: { tab: Tab; onNavigate: (tab: Tab) => void }) {
  const items: { id: Tab; label: string; full: string; icon: string }[] = [{ id: "week", label: "Неделя", full: "План на неделю", icon: "▦" }, { id: "recipes", label: "Рецепты", full: "Рецепты", icon: "♨" }, { id: "builder", label: "Составить", full: "Составить план", icon: "+" }, { id: "shopping", label: "Покупки", full: "Покупки", icon: "⌑" }, { id: "profile", label: "Профиль", full: "Профиль", icon: "●" }];
  return <nav className="bottom-nav glass" aria-label="Основная навигация">{items.map((item) => <button key={item.id} className={`${tab === item.id ? "is-active" : ""} ${item.id === "builder" ? "compose" : ""}`} aria-label={item.full} aria-current={tab === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}><span aria-hidden>{item.icon}</span><small>{item.label}</small></button>)}</nav>;
}

function EmptyState({ onBuild, title, text }: { onBuild: () => void; title: string; text: string }) { return <section className="empty-state glass-card"><div className="empty-orbit"><span>✦</span></div><p className="kicker">Персональный милпреп</p><h2>{title}</h2><p>{text}</p><button className="primary-button" onClick={onBuild}>Составить план <span>→</span></button></section>; }

function DailyBalance({ goal, planned, context = "После блюд из Mise" }: { goal: Macros; planned: Macros; context?: string }) {
  const difference = macroDifference(goal, planned);
  const closeToGoal = Math.abs(difference.kcal) <= 50 && Math.abs(difference.protein) <= 5 && Math.abs(difference.fat) <= 3 && Math.abs(difference.carbs) <= 10;
  const underGoal = difference.kcal > 50;
  const overGoal = difference.kcal < -50;
  const macroKeys: Exclude<MacroKey, "kcal">[] = ["protein", "fat", "carbs"];
  const macroText = macroKeys.map((key) => difference[key] >= 0 ? `${difference[key]} ${macroLabels[key]} добрать` : `${Math.abs(difference[key])} ${macroLabels[key]} сверх`).join(" · ");
  return <aside className={`daily-balance ${overGoal ? "over" : closeToGoal ? "complete" : underGoal ? "remaining" : "mixed"}`} role="status">
    <span>{overGoal ? "Выше дневной цели" : closeToGoal ? "Дневная цель" : underGoal ? "Останется на день" : "Калории близки к цели"}</span>
    <b>{overGoal ? `Примерно на ${Math.abs(difference.kcal)} ккал больше` : closeToGoal ? "Примерно закрыта" : underGoal ? `Можно съесть ещё ≈ ${difference.kcal} ккал` : "Проверьте разницу по БЖУ"}</b>
    <small>{closeToGoal ? `${context}: ${planned.kcal} из ${goal.kcal} ккал.` : `${macroText}.${overGoal ? " Можно уменьшить порцию или убрать одну позицию." : ""}`}</small>
  </aside>;
}

function WeekScreen({ plan, loading, loadError, onBuild, onEditMenu, onOpenRecipe }: { plan: ActivePlan | null; loading: boolean; loadError: boolean; onBuild: () => void; onEditMenu: (batchId: string) => void; onOpenRecipe: (context: RecipeContext) => void }) {
  const [selectedDate, setSelectedDate] = useState(plan?.start ?? isoDate(new Date()));
  const [personId, setPersonId] = useState(plan?.people[0]?.id ?? "");
  if (loading) return <section className="loading-card glass-card"><span className="spinner" /><p>Ищем сохранённый план…</p></section>;
  if (loadError) return <section className="empty-state glass-card" role="alert"><div className="empty-orbit"><span>↻</span></div><p className="kicker">Данные на месте</p><h2>План пока не загрузился</h2><p>Похоже, соединение прервалось. Повторите загрузку — мы не будем показывать пустую неделю вместо ошибки.</p><button className="primary-button" onClick={() => location.reload()}>Повторить <span>→</span></button></section>;
  if (!plan) return <EmptyState onBuild={onBuild} title="Неделя пока свободна" text="Ответьте на несколько вопросов — мы рассчитаем порции, подберём рецепты и соберём покупки." />;
  const dates = Array.from({ length: plan.periodDays }, (_, index) => addDays(plan.start, index));
  const batch = plan.batches.find((item) => selectedDate >= item.start && selectedDate <= item.end) ?? plan.batches[0];
  const person = plan.people.find((item) => item.id === personId) ?? plan.people[0];
  const dayMeals = plan.mealSlots.flatMap((slot) => { const recipe = recipesById[plan.selections[selectionKey(batch, slot)]]; return recipe ? [{ slot, recipe }] : []; });
  const plannedMacros = addMacros(dayMeals.filter(({ slot }) => person?.includedSlots.includes(slot)).map(({ slot, recipe }) => portionFor(person, slot, recipe, plan.tuning?.[tuningKey(batch, slot, person)]).actual));
  return <section className="screen week-screen">
    <div className="date-strip" role="radiogroup" aria-label="Дни плана">{dates.map((date) => <button key={date} role="radio" aria-checked={date === selectedDate} className={date === selectedDate ? "selected" : ""} onClick={() => setSelectedDate(date)}><small>{new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(parseDate(date)).replace(".", "")}</small><b>{parseDate(date).getDate()}</b></button>)}</div>
    <section className="macro-hero glass-card"><div className="macro-top"><div><p className="kicker">Блюда из Mise на этот день</p><h2>{person.name}</h2></div><select value={person.id} onChange={(event) => setPersonId(event.target.value)} aria-label="Выбрать человека">{plan.people.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div><div className="macro-grid">{(["kcal", "protein", "fat", "carbs"] as MacroKey[]).map((key) => <div key={key}><span>{macroLabels[key]}</span><b>{plannedMacros[key]}</b><small>{key === "kcal" ? "ккал" : "г"}</small></div>)}</div><DailyBalance goal={person.daily} planned={plannedMacros} context="В выбранных блюдах" /></section>
    <button className="prep-callout glass-card" onClick={() => setSelectedDate(batch.start)} aria-label={`Открыть день готовки ${batch.index + 1}`}><span className="prep-icon">♨</span><div><p className="kicker">Готовка {batch.index + 1}</p><h3>{formatDate(batch.start)} — {formatDate(batch.end)}</h3><p>{countRu(batch.days, "день", "дня", "дней")} · {countRu(dayMeals.length, "блюдо", "блюда", "блюд")}</p></div><span className="soft-chevron">›</span></button>
    <div className="section-heading"><div><p className="kicker">{formatDate(selectedDate, true)}</p><h2>Меню дня</h2></div><button className="text-button" aria-label={`Изменить меню на ${formatDate(selectedDate, true)}`} onClick={() => onEditMenu(batch.id)}>Изменить</button></div>
    <div className="day-meals">{dayMeals.map(({ slot, recipe }, index) => { const portion = person?.includedSlots.includes(slot) ? portionFor(person, slot, recipe, plan.tuning?.[tuningKey(batch, slot, person)]) : null; const prepStatus = selectedDate === batch.start ? (selectedDate === isoDate(new Date()) ? "Готовить сегодня" : "День готовки") : "Разогреть"; return <button className="week-meal glass-card" key={`${slot}-${recipe.id}`} onClick={() => onOpenRecipe({ recipe, batch, slot, plan })}><div className={`food-art art-${index % 5}`}><span>{recipe.emoji}</span><small>{mealMeta[slot].label}</small></div><div className="week-meal-copy"><p className="kicker">{prepStatus}</p><h3>{recipe.title}</h3>{portion ? <p>{portion.actual.kcal} ккал · {portion.actual.protein} Б · около {portion.grams} г</p> : <p>Не входит в меню {person.name}</p>}</div><span className="soft-chevron">›</span></button>; })}</div>
  </section>;
}

function RecipesScreen({ onOpenRecipe }: { onOpenRecipe: (recipe: Recipe) => void }) {
  const [style, setStyle] = useState<MenuStyle>("protein"); const [slot, setSlot] = useState<MealSlot>("lunch"); const [origin, setOrigin] = useState<RecipeOrigin>("parsed"); const [effort, setEffort] = useState<"all" | "low" | "high">("all"); const [time, setTime] = useState<"all" | "quick" | "medium" | "long">("all"); const visible = candidateRecipes(slot, style, [], 1, { origin, effort: effort === "all" ? undefined : effort, time: time === "all" ? undefined : time, limit: "all" });
  return <section className="screen recipes-screen"><div className="origin-segment" role="radiogroup" aria-label="Происхождение рецепта"><button aria-pressed={origin === "parsed"} className={origin === "parsed" ? "selected" : ""} onClick={() => setOrigin("parsed")}>Спаршенные</button><button aria-pressed={origin === "generated"} className={origin === "generated" ? "selected" : ""} onClick={() => setOrigin("generated")}>Сгенерированные</button></div><div className="horizontal-pills" role="radiogroup" aria-label="Тип меню">{(Object.keys(styleMeta) as MenuStyle[]).map((value) => <button key={value} aria-pressed={style === value} className={style === value ? "selected" : ""} onClick={() => setStyle(value)}>{styleMeta[value].icon} {styleMeta[value].label}</button>)}</div><div className="meal-segment">{(Object.keys(mealMeta) as MealSlot[]).map((value) => <button key={value} className={slot === value ? "selected" : ""} onClick={() => setSlot(value)}>{mealMeta[value].label}</button>)}</div><div className="catalog-filters"><label>Сложность<select value={effort} onChange={(event) => setEffort(event.target.value as typeof effort)}><option value="all">Любая</option><option value="low">Низкая</option><option value="high">Высокая</option></select></label><label>Время<select value={time} onChange={(event) => setTime(event.target.value as typeof time)}><option value="all">Любое</option><option value="quick">До 20 мин</option><option value="medium">21–40 мин</option><option value="long">41+ мин</option></select></label></div><div className="section-heading"><div><p className="kicker">{visible.length} {visible.length === 1 ? "вариант" : "вариантов"}</p><h2>{mealMeta[slot].label}</h2></div></div>{visible.length ? <div className="catalog-grid">{visible.map((recipe, index) => { const sourceImage = recipe.provenance.kind === "parsed" ? recipe.provenance.imageUrl : undefined; return <button className="catalog-card glass-card" key={recipe.id} onClick={() => onOpenRecipe(recipe)}><div className={`catalog-art art-${index} ${sourceImage ? "has-photo" : ""}`}>{sourceImage ? <img src={sourceImage} alt={recipe.provenance.kind === "parsed" ? recipe.provenance.imageAlt ?? recipe.title : recipe.title} loading="lazy" referrerPolicy="no-referrer" /> : <span>{recipe.emoji}</span>}<em>{recipe.time} мин</em></div><h3>{recipe.title}</h3><p>{recipe.macros.kcal} ккал · {styleNote(recipe, style)}</p><div className="recipe-badges"><span>{recipe.effort.level === "low" ? "Мало действий" : "Много действий"}</span><span>{recipe.storage.ambient ? `Сухая банка ${recipe.storageDays} дн.` : recipe.freezable ? "Морозилка" : `Холодильник ${recipe.storageDays} дн.`}</span>{recipe.localization.fit !== "familiar" && <span>{recipe.localization.fit === "adapted" ? "Адаптирован" : "Нишевый вкус"}</span>}</div><span className="round-arrow">↗</span></button>; })}</div> : <section className="catalog-empty glass-card"><span>⌕</span><h3>Пока нет совпадений</h3><p>Смените время, сложность или категорию.</p></section>}</section>;
}

function ShoppingScreen({ plan, onBuild, onChange }: { plan: ActivePlan | null; onBuild: () => void; onChange: (plan: ActivePlan) => Promise<boolean> }) {
  const [failed, setFailed] = useState(false);
  if (!plan) return <section className="screen"><EmptyState onBuild={onBuild} title="Список покупок ждёт меню" text="После создания плана одинаковые продукты объединятся, а количества пересчитаются под всех людей." /></section>;
  const currentPlan = plan;
  const groups = groupedShopping(plan.shopping); const checked = plan.shopping.filter((item) => item.checked).length;
  async function toggle(key: string) { setFailed(false); const ok = await onChange({ ...currentPlan, shopping: currentPlan.shopping.map((item) => item.key === key ? { ...item, checked: !item.checked } : item) }); setFailed(!ok); }
  return <section className="screen shopping-screen"><section className="shopping-summary glass-card"><div><p className="kicker">Куплено {checked} из {plan.shopping.length}</p><h2>{Math.round((checked / Math.max(plan.shopping.length, 1)) * 100)}%</h2></div><div className="progress-ring" style={{ "--progress": `${Math.round((checked / Math.max(plan.shopping.length, 1)) * 100) * 3.6}deg` } as React.CSSProperties}><span>✓</span></div></section>{failed && <div className="save-error inline-error" role="alert">Отметка не сохранилась — проверьте связь и нажмите ещё раз.</div>}{Object.entries(groups).map(([group, items]) => <section className="shopping-group glass-card" key={group}><div className="group-title"><h3>{group}</h3><span>{items.length}</span></div>{items.map((item) => <button className={`grocery-row ${item.checked ? "checked" : ""}`} key={item.key} role="checkbox" aria-checked={item.checked} onClick={() => void toggle(item.key)}><span className="checkmark">{item.checked ? "✓" : ""}</span><span className="grocery-name">{item.name}</span><b>{item.quantity.toLocaleString("ru-RU")} {item.unit}</b></button>)}</section>)}</section>;
}

function ProfileScreen({ people, hasPlan, onConfigure, onOpenTutorial, onOpenPrepGuide, onNotifications }: { people: Person[]; hasPlan: boolean; onConfigure: () => void; onOpenTutorial: () => void; onOpenPrepGuide: () => void; onNotifications: () => void }) {
  return <section className="screen profile-screen"><section className="profile-hero glass-card"><div className="large-avatar">М</div><div><p className="kicker">Ваше пространство</p><h2>{people.length} {people.length === 1 ? "человек" : "человека"}</h2><p>Цели используются для расчёта каждой порции.</p></div></section><div className="section-heading"><div><p className="kicker">Участники плана</p><h2>КБЖУ и блюда</h2></div><button className="text-button" aria-label="Настроить людей и цели" onClick={onConfigure}>Настроить</button></div>{people.map((person, index) => { const planned = plannedTargetsFor(person); const difference = macroDifference(person.daily, planned); const positionLabel = person.includedSlots.length === 1 ? "позиция" : person.includedSlots.length < 5 ? "позиции" : "позиций"; return <section className="person-summary glass-card" key={person.id}><div className={`person-dot tone-${index}`}>{person.name.slice(0, 1)}</div><div className="person-main"><h3>{person.name}</h3><p>{person.includedSlots.length} {positionLabel} из Mise · {difference.kcal > 50 ? `ещё ≈ ${difference.kcal} ккал` : difference.kcal < -50 ? `выше цели на ≈ ${Math.abs(difference.kcal)} ккал` : "цель примерно закрыта"}</p><div className="mini-macros">{(["kcal", "protein", "fat", "carbs"] as MacroKey[]).map((key) => <span key={key}><b>{person.daily[key]}</b> {macroLabels[key]}</span>)}</div></div></section>; })}{hasPlan && <button className="tutorial-entry notification-entry glass-card" onClick={onNotifications}><span>🔔</span><div><b>Напоминания</b><small>Время готовки, покупок и разморозки</small></div><i>›</i></button>}<button className="tutorial-entry glass-card" onClick={onOpenTutorial}><span>?</span><div><b>Как работает Mise</b><small>Ещё раз открыть короткий онбординг</small></div><i>›</i></button><button className="tutorial-entry prep-tutorial-entry glass-card" onClick={onOpenPrepGuide}><span>♨</span><div><b>Инструкция по милпрепу</b><small>Контейнеры, готовка, раскладка и хранение</small></div><i>›</i></button></section>;
}

function PlanBuilder({ initialPlan, initialStep = 0, initialBatchId, onClose, onSaved, persistPlan }: { initialPlan: ActivePlan | null; initialStep?: number; initialBatchId?: string; onClose: () => void; onSaved: (plan: ActivePlan, destination: Tab) => void; persistPlan: (plan: ActivePlan) => Promise<void> }) {
  const initialChoiceIndex = initialPlan && initialBatchId ? Math.max(0, initialPlan.batches.findIndex((batch) => batch.id === initialBatchId) * initialPlan.mealSlots.length) : 0;
  const today = isoDate(new Date()); const [step, setStep] = useState(initialStep); const [start, setStart] = useState(initialPlan?.start ?? today); const [end, setEnd] = useState(initialPlan?.end ?? addDays(today, 6)); const [mealSlots, setMealSlots] = useState<MealSlot[]>(initialPlan?.mealSlots ?? ["breakfast", "lunch", "dinner"]); const [menuStyle, setMenuStyle] = useState<MenuStyle>(initialPlan?.menuStyle ?? "protein"); const [people, setPeople] = useState<Person[]>(initialPlan?.people ?? [{ ...newPerson(0), includedSlots: ["breakfast", "lunch", "dinner"] }]); const [cookEveryDays, setCookEveryDays] = useState(initialPlan?.cookEveryDays ?? 3); const [remainderDecision, setRemainderDecision] = useState<"separate" | "extend" | "shorten" | null>(initialPlan && initialPlan.periodDays % initialPlan.cookEveryDays ? "separate" : null); const [selections, setSelections] = useState<Record<string, string>>(initialPlan?.selections ?? {}); const [choiceIndex, setChoiceIndex] = useState(initialChoiceIndex); const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle"); const [successPlan, setSuccessPlan] = useState<ActivePlan | null>(null);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }, [step, choiceIndex]);
  const rawDays = daysInclusive(start, end); const validPeriod = rawDays >= 1 && rawDays <= 14; const remainder = validPeriod ? rawDays % cookEveryDays : 0; const resolvedDays = !remainder ? rawDays : remainderDecision === "extend" ? rawDays + cookEveryDays - remainder : remainderDecision === "shorten" ? rawDays - remainder : rawDays; const resolvedPeriodValid = resolvedDays >= 1 && resolvedDays <= 14; const resolvedEnd = addDays(start, Math.max(0, resolvedDays - 1)); const batches = useMemo(() => buildBatches(start, Math.max(1, resolvedDays), cookEveryDays), [start, resolvedDays, cookEveryDays]); const positions = useMemo(() => batches.flatMap((batch) => mealSlots.map((slot) => ({ batch, slot }))), [batches, mealSlots]); const currentPosition = positions[Math.min(choiceIndex, Math.max(0, positions.length - 1))];
  const validSelections = ((): Record<string, string> => { const valid: Record<string, string> = {}; for (const batch of batches) for (const slot of mealSlots) { const key = selectionKey(batch, slot); const recipe = recipesById[selections[key]]; if (recipe && recipe.slot === slot && recipe.tags.includes(menuStyle) && (recipe.storageDays >= batch.days || recipe.freezable)) valid[key] = recipe.id; } return valid; })();
  const allSelected = positions.every(({ batch, slot }) => Boolean(validSelections[selectionKey(batch, slot)])); const unassignedSlots = mealSlots.filter((slot) => !people.some((person) => person.includedSlots.includes(slot))); const staleCount = positions.filter(({ batch, slot }) => selections[selectionKey(batch, slot)] && !validSelections[selectionKey(batch, slot)]).length;
  const draftPlan = ((): ActivePlan => { const base: ActivePlan = { id: "draft", createdAt: new Date().toISOString(), start, end: resolvedEnd, periodDays: resolvedDays, cookEveryDays, menuStyle, mealSlots, people, batches, selections: validSelections, shopping: [] }; return { ...base, shopping: buildShopping(base) }; })();
  const steps = ["Период", "Приёмы пищи", "Вид меню", "Люди и цели", "Готовка", "Выбор меню", "Проверка"];
  function setQuickPeriod(days: number) { setEnd(addDays(start, days - 1)); setRemainderDecision(null); }
  function updatePerson(id: string, patch: Partial<Person>) { setPeople((current) => current.map((person) => person.id === id ? { ...person, ...patch } : person)); }
  function updateMacro(id: string, key: MacroKey, value: number) { setPeople((current) => current.map((person) => { if (person.id !== id) return person; const safeValue = Math.max(0, value); if (key === "kcal") { const preset = person.macroPreset ?? "balanced"; return { ...person, daily: recalculateDailyMacros(safeValue, person.daily, preset), macroPreset: preset }; } return { ...person, daily: { ...person.daily, [key]: safeValue }, macroPreset: "custom" }; })); }
  function applyMacroPreset(id: string, preset: MacroPresetOption) { setPeople((current) => current.map((person) => person.id === id ? { ...person, daily: macrosForCalories(person.daily.kcal, preset), macroPreset: preset } : person)); }
  function toggleMealSlot(slot: MealSlot) { const removing = mealSlots.includes(slot); setMealSlots((current) => removing ? current.filter((item) => item !== slot) : [...current, slot]); setPeople((current) => current.map((person, index) => { if (removing) return { ...person, includedSlots: person.includedSlots.filter((item) => item !== slot) }; if (index !== 0 || person.includedSlots.includes(slot)) return person; return { ...person, includedSlots: [...person.includedSlots, slot] }; })); }
  function stepIsValid(index = step) { if (index === 0) return validPeriod; if (index === 1) return mealSlots.length > 0; if (index === 3) return people.length > 0 && people.every((person) => person.name.trim() && person.daily.kcal > 0 && person.includedSlots.some((slot) => mealSlots.includes(slot))); if (index === 4) return resolvedPeriodValid && (remainder === 0 || remainderDecision !== null); if (index === 5) return allSelected; return true; }
  function next() { if (!stepIsValid()) return; if (step === 3 && unassignedSlots.length) setMealSlots((current) => current.filter((slot) => !unassignedSlots.includes(slot))); if (step === 4) { const firstMissing = positions.findIndex((position) => !validSelections[selectionKey(position.batch, position.slot)]); setChoiceIndex(firstMissing >= 0 ? firstMissing : 0); } setStep((value) => Math.min(6, value + 1)); }
  function choose(recipeId: string) { if (!currentPosition) return; const key = selectionKey(currentPosition.batch, currentPosition.slot); const updated = { ...validSelections, [key]: recipeId }; setSelections(updated); const nextMissing = positions.findIndex((position, index) => index > choiceIndex && !updated[selectionKey(position.batch, position.slot)]); if (nextMissing >= 0) setChoiceIndex(nextMissing); }
  function repeatForSlot(recipeId: string, slot: MealSlot) { const updated = { ...validSelections }; for (const batch of batches) updated[selectionKey(batch, slot)] = recipeId; setSelections(updated); }
  async function save() { const plan: ActivePlan = { ...draftPlan, id: initialPlan?.id ?? crypto.randomUUID(), createdAt: initialPlan?.createdAt ?? new Date().toISOString() }; setSaveState("saving"); try { await persistPlan(plan); setSaveState("idle"); setSuccessPlan(plan); } catch { setSaveState("error"); } }
  return <main className="app-shell builder-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="builder-header">
      <button className="icon-button glass" onClick={step === initialStep ? onClose : () => setStep((value) => value - 1)} aria-label={step === initialStep ? "Вернуться к неделе" : "Назад"}>{initialStep === 0 && step === 0 ? "×" : "‹"}</button>
      <div><p className="kicker">Шаг {step + 1} из {steps.length}</p><h1>{steps[step]}</h1></div>
      <span className="step-count">{Math.round(((step + 1) / steps.length) * 100)}%</span>
    </header>
    <div className="progress-track"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
    <section className="builder-content">
      {staleCount > 0 && <p className="inline-note" role="status">{staleCount === 1 ? "Одно блюдо не подходит под новые настройки — выберите его заново на шаге «Выбор меню»." : `${staleCount} блюда не подходят под новые настройки — выберите их заново на шаге «Выбор меню».`}</p>}
      {step === 0 && <PeriodStep start={start} end={end} rawDays={rawDays} valid={validPeriod} onStart={(value) => { setStart(value); if (daysInclusive(value, end) < 1) setEnd(value); setRemainderDecision(null); }} onEnd={(value) => { setEnd(value); setRemainderDecision(null); }} onQuick={setQuickPeriod} />}
      {step === 1 && <MealStep selected={mealSlots} periodDays={rawDays} onToggle={toggleMealSlot} />}
      {step === 2 && <StyleStep selected={menuStyle} onSelect={setMenuStyle} />}
      {step === 3 && <PeopleStep people={people} mealSlots={mealSlots} onUpdate={updatePerson} onMacro={updateMacro} onPreset={applyMacroPreset} onAdd={() => { if (people.length < 4) setPeople((current) => [...current, { ...newPerson(current.length), includedSlots: [...mealSlots] }]); }} onRemove={(id) => { if (people.length > 1) setPeople((current) => current.filter((person) => person.id !== id)); }} />}
      {step === 3 && unassignedSlots.length > 0 && <p className="inline-note" role="status">{unassignedSlots.map((slot) => mealMeta[slot].label).join(", ")} никто не выбрал — {unassignedSlots.length === 1 ? "эта позиция не войдёт" : "эти позиции не войдут"} в план.</p>}
      {step === 4 && <CookingStep periodDays={rawDays} cookEveryDays={cookEveryDays} remainder={remainder} decision={remainderDecision} start={start} resolvedDays={resolvedDays} canExtend={rawDays + cookEveryDays - remainder <= 14} onDays={(value) => { setCookEveryDays(value); setRemainderDecision(null); }} onDecision={setRemainderDecision} />}
      {step === 5 && currentPosition && <MenuStep position={currentPosition} positions={positions} currentIndex={choiceIndex} selections={validSelections} style={menuStyle} people={people} onJump={setChoiceIndex} onChoose={choose} onRepeat={repeatForSlot} />}
      {step === 6 && <ReviewStep plan={draftPlan} onEdit={(target) => setStep(target)} />}
    </section>
    <footer className="builder-actions glass">
      <button className="secondary-button" onClick={step === initialStep ? onClose : () => setStep((value) => value - 1)}>{step === initialStep ? "Отмена" : "Назад"}</button>
      {step < 6 ? <button className="primary-button" disabled={!stepIsValid()} onClick={next}>{step === 5 ? "Проверить план" : "Продолжить"} <span>→</span></button> : <button className="primary-button" disabled={saveState === "saving"} onClick={save}>{saveState === "saving" ? "Сохраняем…" : initialPlan ? "Сохранить изменения" : "Создать план и покупки"}</button>}
    </footer>
    {saveState === "error" && <div className="save-error" role="alert">Не получилось сохранить. Проверьте соединение и попробуйте ещё раз.</div>}
    {successPlan && <SuccessSheet plan={successPlan} onOpen={(destination) => onSaved(successPlan, destination)} onEdit={() => { setSuccessPlan(null); setStep(0); }} />}
  </main>;
}

function StepIntro({ icon, kicker, title, text }: { icon: string; kicker: string; title: string; text: string }) { return <div className="step-intro"><span>{icon}</span><p className="kicker">{kicker}</p><h2>{title}</h2><p>{text}</p></div>; }
function PeriodStep({ start, end, rawDays, valid, onStart, onEnd, onQuick }: { start: string; end: string; rawDays: number; valid: boolean; onStart: (value: string) => void; onEnd: (value: string) => void; onQuick: (days: number) => void }) { return <><StepIntro icon="◷" kicker="Когда едим" title="Выберите период" text="До 14 дней — так проще сохранить свежесть и разнообразие." /><section className="glass-card form-card"><div className="date-fields"><label>Начало<input type="date" value={start} onChange={(event) => onStart(event.target.value)} /></label><span>→</span><label>Конец<input type="date" value={end} onChange={(event) => onEnd(event.target.value)} /></label></div><div className="quick-periods">{[3, 5, 7, 14].map((days) => <button key={days} className={rawDays === days ? "selected" : ""} onClick={() => onQuick(days)}>{days} дней</button>)}</div>{valid ? <div className="result-line"><span>✓</span><p><b>{formatDate(start)} — {formatDate(end)}</b><small>{rawDays} дней в плане</small></p></div> : <div className="warning-line">Период должен быть от 1 до 14 дней.</div>}</section></>; }
function MealStep({ selected, periodDays, onToggle }: { selected: MealSlot[]; periodDays: number; onToggle: (slot: MealSlot) => void }) { return <><StepIntro icon="◉" kicker="Что планируем" title="Выберите блюда из Mise" text="Отметьте только то, что хотите приготовить заранее. Остаток дневной цели мы покажем отдельно." /><div className="choice-grid meals-grid">{(Object.keys(mealMeta) as MealSlot[]).map((slot) => { const active = selected.includes(slot); return <button key={slot} className={`choice-card glass-card ${active ? "selected" : ""}`} role="checkbox" aria-checked={active} onClick={() => onToggle(slot)}><span className="choice-icon">{mealMeta[slot].icon}</span><b>{mealMeta[slot].label}</b><small>{active ? "Включён ✓" : "Добавить"}</small></button>; })}</div><section className="calculation-note glass-card"><span>∑</span><p><b>{countRu(selected.length, "позиция", "позиции", "позиций")} меню на день</b><small>{countRu(selected.length * periodDays, "порция", "порции", "порций")} на человека за период, если он ест все выбранные блюда</small></p></section></>; }
function StyleStep({ selected, onSelect }: { selected: MenuStyle; onSelect: (style: MenuStyle) => void }) { return <><StepIntro icon="✦" kicker="Какое меню" title="Выберите направление" text="Мы изменим порядок рекомендаций и покажем самые подходящие варианты первыми." /><div className="style-list" role="radiogroup">{(Object.keys(styleMeta) as MenuStyle[]).map((style) => <button key={style} className={`style-card glass-card ${selected === style ? "selected" : ""}`} role="radio" aria-checked={selected === style} onClick={() => onSelect(style)}><span>{styleMeta[style].icon}</span><div><h3>{styleMeta[style].label}</h3><p>{styleMeta[style].description}</p></div><i>{selected === style ? "✓" : ""}</i></button>)}</div></>; }

function PeopleStep({ people, mealSlots, onUpdate, onMacro, onPreset, onAdd, onRemove }: { people: Person[]; mealSlots: MealSlot[]; onUpdate: (id: string, patch: Partial<Person>) => void; onMacro: (id: string, key: MacroKey, value: number) => void; onPreset: (id: string, preset: MacroPresetOption) => void; onAdd: () => void; onRemove: (id: string) => void }) {
  const presetOptions = Object.keys(macroPresetMeta) as MacroPresetOption[];
  return <><StepIntro icon="◎" kicker="Для кого готовим" title="Люди и цели" text="Введите калории и выберите распределение — БЖУ пересчитаются автоматически." />{people.map((person, index) => {
    const plannedTargets = plannedTargetsFor(person);
    const calculatedCalories = macroCalories(person.daily);
    const mismatch = Math.abs(calculatedCalories - person.daily.kcal) / Math.max(person.daily.kcal, 1) > 0.1;
    const selectedPreset = person.macroPreset ?? "balanced";
    return <section className="person-editor glass-card" key={person.id}>
      <div className="person-editor-head"><span className={`person-dot tone-${index}`}>{person.name.slice(0, 1) || index + 1}</span><label>Имя<input value={person.name} onChange={(event) => onUpdate(person.id, { name: event.target.value })} /></label>{people.length > 1 && <button className="delete-person" onClick={() => onRemove(person.id)} aria-label={`Удалить ${person.name}`}>×</button>}</div>
      <div className="macro-inputs">{(["kcal", "protein", "fat", "carbs"] as MacroKey[]).map((key) => <label key={key} className={key === "kcal" ? "calorie-input" : ""}><span>{macroLabels[key]}</span><input aria-label={key === "kcal" ? `Калории для ${person.name}` : `${macroLabels[key]} для ${person.name}`} type="number" min="0" inputMode="numeric" value={person.daily[key]} onChange={(event) => onMacro(person.id, key, Number(event.target.value))} /><small>{key === "kcal" ? "ккал" : "г"}</small></label>)}</div>
      <div className="macro-presets"><div className="macro-preset-heading"><p><b>Распределить калории</b><small>При изменении калорий БЖУ обновятся сами</small></p>{selectedPreset === "custom" && <em>Вручную</em>}</div><div className="macro-preset-grid" role="radiogroup" aria-label={`Распределение калорий для ${person.name}`}>{presetOptions.map((preset) => { const meta = macroPresetMeta[preset]; const selected = selectedPreset === preset; return <button key={preset} className={selected ? "selected" : ""} role="radio" aria-checked={selected} onClick={() => onPreset(person.id, preset)}><b>{meta.label}</b><small>{meta.description}</small></button>; })}</div><p className="macro-preset-note">Доли считаются от калорий. Это ориентир, не медицинская рекомендация; любое БЖУ можно поправить вручную.</p></div>
      {mismatch && <p className="inline-warning">Калории и БЖУ отличаются больше чем на 10% — выберите профиль ещё раз или проверьте ручные значения.</p>}
      <div className="person-slots"><p>Что из плана ест {person.name || "человек"}</p><div>{mealSlots.map((slot) => { const active = person.includedSlots.includes(slot); return <button key={slot} role="checkbox" aria-checked={active} className={active ? "selected" : ""} onClick={() => onUpdate(person.id, { includedSlots: active ? person.includedSlots.filter((item) => item !== slot) : [...person.includedSlots, slot] })}>{active ? "✓ " : "+ "}{mealMeta[slot].short}</button>; })}</div></div>
      <div className="portion-preview">{person.includedSlots.filter((slot) => mealSlots.includes(slot)).map((slot) => { const target = targetFor(person, slot); return <p key={slot}><span>{mealMeta[slot].label}</span><b>{target.kcal} К · {target.protein} Б · {target.fat} Ж · {target.carbs} У</b></p>; })}</div>
      <DailyBalance goal={person.daily} planned={plannedTargets} context="В выбранных позициях" />
    </section>;
  })}<button className="add-person glass-card" disabled={people.length >= 4} onClick={onAdd}><span>＋</span><div><b>Добавить человека</b><small>До четырёх профилей в одном плане</small></div></button></>;
}

function CookingStep({ periodDays, cookEveryDays, remainder, decision, start, resolvedDays, canExtend, onDays, onDecision }: { periodDays: number; cookEveryDays: number; remainder: number; decision: "separate" | "extend" | "shorten" | null; start: string; resolvedDays: number; canExtend: boolean; onDays: (days: number) => void; onDecision: (value: "separate" | "extend" | "shorten") => void }) {
  const blocks = buildBatches(start, resolvedDays, cookEveryDays);
  return <><StepIntro icon="♨" kicker="Ритм готовки" title="На сколько дней готовим за раз?" text="Выберите размер одной партии. Мы учтём хранение и заморозку." /><section className="glass-card cooking-card"><div className="day-scale">{[1, 2, 3, 4, 5, 6, 7].map((days) => <button key={days} aria-pressed={cookEveryDays === days} className={cookEveryDays === days ? "selected" : ""} onClick={() => onDays(days)}><b>{days}</b><small>{days === 1 ? "день" : "дней"}</small></button>)}</div><div className="batch-timeline">{blocks.map((batch) => <div key={batch.id}><span>{batch.index + 1}</span><p><b>Готовка {batch.index + 1}</b><small>{formatDate(batch.start)} — {formatDate(batch.end)} · {batch.days} дн.</small></p></div>)}</div></section>{remainder > 0 && <section className="remainder-sheet glass-card"><p className="kicker">Нужно ваше решение</p><h3>{periodDays} дней не делятся на {cookEveryDays} без остатка</h3><p>Последний блок — {remainder} {remainder === 1 ? "день" : "дня"}. Как поступить?</p><button aria-pressed={decision === "separate"} className={decision === "separate" ? "selected" : ""} onClick={() => onDecision("separate")}><span>◒</span><div><b>Приготовить остаток отдельно</b><small>Оставить даты, финальная мини-готовка на {remainder} дн.</small></div><i>{decision === "separate" ? "✓" : ""}</i></button><button aria-pressed={decision === "extend"} className={decision === "extend" ? "selected" : ""} disabled={!canExtend} onClick={() => onDecision("extend")}><span>＋</span><div><b>Добавить {cookEveryDays - remainder} дн.</b><small>{canExtend ? `Новый конец: ${formatDate(addDays(start, periodDays + cookEveryDays - remainder - 1))}` : "Получится больше 14 дней — выберите другой вариант"}</small></div><i>{decision === "extend" ? "✓" : ""}</i></button><button aria-pressed={decision === "shorten"} className={decision === "shorten" ? "selected" : ""} disabled={periodDays - remainder < 1} onClick={() => onDecision("shorten")}><span>−</span><div><b>Убрать {remainder} дн.</b><small>Новый конец: {formatDate(addDays(start, periodDays - remainder - 1))}</small></div><i>{decision === "shorten" ? "✓" : ""}</i></button></section>}</>;
}

function MenuStep({ position, positions, currentIndex, selections, style, people, onJump, onChoose, onRepeat }: { position: { batch: Batch; slot: MealSlot }; positions: { batch: Batch; slot: MealSlot }[]; currentIndex: number; selections: Record<string, string>; style: MenuStyle; people: Person[]; onJump: (index: number) => void; onChoose: (id: string) => void; onRepeat: (id: string, slot: MealSlot) => void }) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { stripRef.current?.querySelector<HTMLElement>(".current")?.scrollIntoView({ block: "nearest", inline: "center" }); }, [currentIndex]);
  const candidates = candidateRecipes(position.slot, style, people, position.batch.days); const selectedId = selections[selectionKey(position.batch, position.slot)]; const completed = positions.filter(({ batch, slot }) => selections[selectionKey(batch, slot)]).length;
  return <><StepIntro icon={mealMeta[position.slot].icon} kicker={`${completed} из ${positions.length} выбрано`} title={`${mealMeta[position.slot].label} · готовка ${position.batch.index + 1}`} text={`${formatDate(position.batch.start)} — ${formatDate(position.batch.end)}. Выберите один из пяти вариантов.`} /><div ref={stripRef} className="position-strip">{positions.map((item, index) => <button key={`${item.batch.id}-${item.slot}`} className={`${index === currentIndex ? "current" : ""} ${selections[selectionKey(item.batch, item.slot)] ? "done" : ""}`} onClick={() => onJump(index)} aria-label={`Готовка ${item.batch.index + 1}, ${mealMeta[item.slot].label}`}><span>{mealMeta[item.slot].icon}</span><small>{item.batch.index + 1}</small></button>)}</div><div className="menu-candidates" role="radiogroup" aria-label="Выбор блюда">{candidates.map((recipe, index) => { const selected = selectedId === recipe.id; const fit = fitScore(recipe, people, position.slot); return <article className={`candidate-card glass-card ${selected ? "selected" : ""}`} key={recipe.id}><button className="candidate-main" onClick={() => onChoose(recipe.id)} role="radio" aria-checked={selected}><div className={`candidate-art art-${index}`}><span>{recipe.emoji}</span><em>{recipe.time} мин</em></div><div className="candidate-copy"><div className="fit-badge">Совпадение {fit}%</div><h3>{recipe.title}</h3><p>{recipe.macros.kcal} К · {recipe.macros.protein} Б · {recipe.macros.fat} Ж · {recipe.macros.carbs} У</p><small>{styleNote(recipe, style)} · хранится {recipe.storageDays} дн.</small></div><i>{selected ? "✓" : ""}</i></button>{selected && positions.filter((item) => item.slot === position.slot).length > 1 && <button className="repeat-button" onClick={() => onRepeat(recipe.id, position.slot)}>Повторить во всех готовках</button>}</article>; })}</div></>;
}

function ReviewStep({ plan, onEdit }: { plan: ActivePlan; onEdit: (step: number) => void }) {
  const recipeIds = new Set(Object.values(plan.selections)); const totalPortions = plan.batches.reduce((sum, batch) => sum + batch.days * plan.mealSlots.reduce((slotSum, slot) => slotSum + plan.people.filter((person) => person.includedSlots.includes(slot)).length, 0), 0);
  return <><StepIntro icon="✓" kicker="Почти готово" title="Проверьте план" text="После сохранения он появится в неделе, а продукты — в покупках." /><section className="review-hero glass-card"><div><p className="kicker">{formatDate(plan.start)} — {formatDate(plan.end)}</p><h2>{plan.periodDays} дней · {plan.people.length} чел.</h2></div><span>{styleMeta[plan.menuStyle].icon}</span><div className="review-stats"><p><b>{plan.batches.length}</b><small>готовки</small></p><p><b>{recipeIds.size}</b><small>рецептов</small></p><p><b>{totalPortions}</b><small>порций</small></p><p><b>{plan.shopping.length}</b><small>продуктов</small></p></div></section><section className="review-list glass-card"><button onClick={() => onEdit(0)}><span>◷</span><div><b>Период</b><small>{formatDate(plan.start)} — {formatDate(plan.end)}</small></div><i>Изменить</i></button><button onClick={() => onEdit(3)}><span>◎</span><div><b>Люди и КБЖУ</b><small>{plan.people.map((person) => person.name).join(", ")}</small></div><i>Изменить</i></button><button onClick={() => onEdit(4)}><span>♨</span><div><b>График готовки</b><small>Каждые {plan.cookEveryDays} дн. · {plan.batches.length} блока</small></div><i>Изменить</i></button><button onClick={() => onEdit(5)}><span>✦</span><div><b>Выбранное меню</b><small>{Object.keys(plan.selections).length} позиций</small></div><i>Изменить</i></button></section><section className="shopping-preview glass-card"><div className="group-title"><h3>Покупки</h3><span>{plan.shopping.length}</span></div>{plan.shopping.slice(0, 5).map((item) => <p key={item.key}><span>{item.name}</span><b>{item.quantity.toLocaleString("ru-RU")} {item.unit}</b></p>)}{plan.shopping.length > 5 && <small>и ещё {plan.shopping.length - 5} продуктов</small>}</section></>;
}

function SuccessSheet({ plan, onOpen, onEdit }: { plan: ActivePlan; onOpen: (tab: Tab) => void; onEdit: () => void }) {
  const [phase, setPhase] = useState<"summary" | "notifications">("summary");
  return <Modal className={`success-sheet glass ${phase === "notifications" ? "notification-modal" : ""}`} labelledBy={phase === "summary" ? "success-title" : "notifications-title"} onClose={() => onOpen("week")}>{phase === "summary" ? <><div className="success-burst">✓</div><p className="kicker">Всё получилось</p><h2 id="success-title">План готов!</h2><p>{countRu(plan.periodDays, "день", "дня", "дней")} · {countRu(plan.batches.length, "готовка", "готовки", "готовок")} · {countRu(new Set(Object.values(plan.selections)).size, "рецепт", "рецепта", "рецептов")} · {countRu(plan.shopping.length, "продукт", "продукта", "продуктов")}</p><button className="primary-button" onClick={() => setPhase("notifications")}>Настроить напоминания <span>→</span></button><button className="secondary-button" onClick={() => onOpen("week")}>Открыть план без них</button><button className="text-button" onClick={onEdit}>Изменить план</button></> : <NotificationSetupPanel plan={notificationPlanFor(plan)} clientId={clientId()} deviceId={deviceId()} onDone={() => onOpen("week")} onCancel={() => onOpen("week")} />}</Modal>;
}

function RecipePackingGuide({ recipe }: { recipe: Recipe }) {
  return <section className="recipe-packing glass-card"><p className="kicker">Практическая раскладка</p><h2>Как собрать контейнер</h2><p>{recipe.packing.portion}</p>{recipe.packing.separate && <p><b>Отдельно:</b> {recipe.packing.separate}</p>}<small><b>Подпись:</b> {recipe.packing.label}</small></section>;
}

function RecipeView({ context, onBack, onChangePlan }: { context: RecipeContext; onBack: () => void; onChangePlan?: (plan: ActivePlan) => Promise<void> }) {
  const { recipe, batch, slot, plan } = context;
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }, []);
  const [section, setSection] = useState<"ingredients" | "steps" | "portion">(batch ? "portion" : "ingredients");
  const eaters = batch && slot && plan ? plan.people.filter((person) => person.includedSlots.includes(slot)) : [];
  const [personId, setPersonId] = useState(eaters[0]?.id ?? "");
  const person = eaters.find((item) => item.id === personId) ?? eaters[0];
  const automaticTuning = person && slot ? portionFor(person, slot, recipe).ratios : { protein: 1, fat: 1, carbs: 1 };
  const savedTuning = person && batch && slot ? plan?.tuning?.[tuningKey(batch, slot, person)] : undefined;
  const [draft, setDraft] = useState<RecipeTuning>(savedTuning ?? automaticTuning);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const preview = person && slot ? portionFor(person, slot, recipe, draft) : null;
  const displayMacros: Macros = preview?.actual ?? { protein: round(recipe.macros.protein * draft.protein), fat: round(recipe.macros.fat * draft.fat), carbs: round(recipe.macros.carbs * draft.carbs), kcal: round(recipe.macros.kcal + recipe.macros.protein * (draft.protein - 1) * 4 + recipe.macros.fat * (draft.fat - 1) * 9 + recipe.macros.carbs * (draft.carbs - 1) * 4) };
  const freezeDays = batch && recipe.freezable ? Math.max(0, batch.days - recipe.storageDays) : 0;
  const originLabel = recipe.provenance.kind === "parsed" ? "Из источника" : "Сгенерирован и отредактирован";
  function selectPerson(nextId: string) { setPersonId(nextId); const nextPerson = eaters.find((item) => item.id === nextId); if (!nextPerson || !batch || !slot) return; setDraft(plan?.tuning?.[tuningKey(batch, slot, nextPerson)] ?? portionFor(nextPerson, slot, recipe).ratios); setSaveStatus("idle"); }
  function updateDraft(key: keyof RecipeTuning, value: number) { setDraft((current) => ({ ...current, [key]: value })); setSaveStatus("idle"); }
  async function saveTuning() { if (!plan || !batch || !slot || !person || !onChangePlan) return; setSaveStatus("saving"); const next: ActivePlan = { ...plan, tuning: { ...plan.tuning, [tuningKey(batch, slot, person)]: draft } }; next.shopping = buildShopping(next); try { await onChangePlan(next); setSaveStatus("saved"); } catch { setSaveStatus("error"); } }
  function totalIngredientScale(ingredient: Ingredient) { if (!batch || !slot || !plan) return ingredientRatioFor(ingredient, draft); return eaters.reduce((sum, eater) => { const eaterTuning = eater.id === person?.id ? draft : plan.tuning?.[tuningKey(batch, slot, eater)]; return sum + ingredientScaleFor(ingredient, portionFor(eater, slot, recipe, eaterTuning)); }, 0) * batch.days; }
  return <main className="app-shell recipe-detail"><div className="ambient ambient-one" /><header className="detail-header"><button className="icon-button glass" onClick={onBack} aria-label="Назад">‹</button><span className="glass">{recipe.effort.activeMinutes} мин активно · {recipe.time} всего</span></header><section className="detail-hero"><div className="detail-food glass"><span>{recipe.emoji}</span></div><p className="kicker">{mealMeta[recipe.slot].label} · {originLabel}</p><h1>{recipe.title}</h1><div className="detail-macros">{(["kcal", "protein", "fat", "carbs"] as MacroKey[]).map((key) => <span key={key}><b>{displayMacros[key]}</b><small>{macroLabels[key]}{key === "kcal" ? "кал" : ""}</small></span>)}</div></section><section className="macro-tuner glass-card"><div className="tuner-heading"><div><p className="kicker">Гибкая порция</p><h2>Подстройка КБЖУ</h2></div>{person && <select aria-label="Для кого настроить порцию" value={person.id} onChange={(event) => selectPerson(event.target.value)}>{eaters.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>}</div><p className="tuner-copy">{person ? "База уже подогнана под цель. Здесь можно докрутить состав порции в разумных пределах." : "Попробуйте базовую порцию. В плане Mise начнёт с цели каждого человека."}</p><div className="tuner-controls">{([{ key: "protein", label: "Белковая часть", value: displayMacros.protein, range: recipe.flex.protein }, { key: "carbs", label: "Гарнир", value: displayMacros.carbs, range: recipe.flex.carbs }, { key: "fat", label: "Жиры и соус", value: displayMacros.fat, range: recipe.flex.fat }] as const).map((control) => <label key={control.key} aria-label={control.label}><span><b>{control.label}</b><em>{Math.round(draft[control.key] * 100)}% · {control.value} г</em></span><input type="range" min={control.range[0]} max={control.range[1]} step="0.05" value={draft[control.key]} onChange={(event) => updateDraft(control.key, Number(event.target.value))} /></label>)}</div><div className="tuner-actions"><button className="secondary-button" onClick={() => { setDraft(automaticTuning); setSaveStatus("idle"); }}>{person ? "Вернуть к цели" : "Сбросить"}</button>{person && <button className="primary-button" disabled={saveStatus === "saving"} onClick={saveTuning}>{saveStatus === "saving" ? "Сохраняем…" : saveStatus === "saved" ? "Сохранено ✓" : "Сохранить и пересчитать"}</button>}</div>{saveStatus === "error" && <p className="tuner-error" role="alert">Не удалось сохранить. Изменения не попали в план.</p>}</section><section className="recipe-info-grid"><article className="glass-card"><span>⌘</span><div><b>{recipe.effort.level === "low" ? "Низкая сложность" : "Высокая сложность"}</b><small>{recipe.effort.knifeActions} нарезки · {recipe.effort.cookware} ед. посуды · {recipe.effort.activeActions} действий</small></div></article><article className="glass-card"><span>◷</span><div><b>{recipe.effort.activeMinutes} мин активно</b><small>{recipe.time} мин общего времени</small></div></article></section><section className="detail-panel glass-card"><div className="detail-tabs"><button className={section === "ingredients" ? "selected" : ""} onClick={() => setSection("ingredients")}>Ингредиенты</button><button className={section === "steps" ? "selected" : ""} onClick={() => setSection("steps")}>Готовить</button><button className={section === "portion" ? "selected" : ""} onClick={() => setSection("portion")}>Разложить</button></div>{section === "ingredients" && <div className="detail-list"><div className="detail-note"><span>∑</span><p><b>{batch ? `На ${batch.days} дн. · ${eaters.length} чел.` : "На одну базовую порцию"}</b><small>Количество меняется вместе с рычагами КБЖУ</small></p></div>{recipe.ingredients.map((ingredient) => { const totalScale = totalIngredientScale(ingredient); return <div className="ingredient-row" key={ingredient.id}><span>✓</span><p>{ingredient.name}<small>{ingredient.group}</small></p><b>{ingredient.unit === "шт." ? round(ingredient.quantity * totalScale, 1) : round(ingredient.quantity * totalScale / 5) * 5} {ingredient.unit}</b></div>; })}</div>}{section === "steps" && <ol className="cooking-steps">{recipe.steps.map((text, index) => <li key={`${text}-${index}`}><span>{index + 1}</span><p>{text}</p></li>)}</ol>}{section === "portion" && <div className="portion-section">{batch && slot && plan ? <><div className="detail-note"><span>⌑</span><p><b>{batch.days} контейнера на человека</b><small>Подпишите имя, приём пищи и даты</small></p></div>{eaters.map((eater, index) => { const portion = portionFor(eater, slot, recipe, eater.id === person?.id ? draft : plan.tuning?.[tuningKey(batch, slot, eater)]); return <article className="portion-card" key={eater.id}><div className={`person-dot tone-${index}`}>{eater.name.slice(0, 1)}</div><div><h3>{eater.name}</h3><p><b>{batch.days} × примерно {portion.grams} г</b></p><small>{portion.actual.kcal} К · {portion.actual.protein} Б · {portion.actual.fat} Ж · {portion.actual.carbs} У на контейнер</small><em>Подпись: {eater.name} / {mealMeta[slot].label.toLowerCase()} / {formatDate(batch.start)}–{formatDate(batch.end)}</em></div></article>; })}<section className="storage-card"><span>{freezeDays > 0 ? "❄️" : "✓"}</span><div><h3>{freezeDays > 0 ? "Часть порций заморозить" : recipe.storage.ambient ? "Хранить в сухой банке" : "Хранить в холодильнике"}</h3><p>{freezeDays > 0 ? `Оставьте на ${recipe.storageDays} дня в холодильнике, ещё ${freezeDays} порц. каждого человека заморозьте.` : recipe.storage.ambient ?? `Ориентир для холодильника — до ${recipe.storageDays} дней.`}</p></div></section></> : <section className="detail-note"><span>◎</span><p><b>Точная раскладка появится в плане</b><small>Мы учтём КБЖУ и цели каждого человека.</small></p></section>}</div>}</section><RecipePackingGuide recipe={recipe} /><section className="recipe-storage glass-card"><p className="kicker">Ориентиры хранения</p><h2>{recipe.storage.ambient ? `Сухое хранение — до ${recipe.storageDays} дн.` : recipe.freezable ? `Холодильник ${recipe.storageDays} дн. или заморозка` : `Только холодильник — до ${recipe.storageDays} дн.`}</h2><p>{recipe.storage.ambient ?? recipe.storage.refrigerator}</p>{recipe.storage.freezer && <p><b>Морозилка{recipe.storage.freezerDays ? ` — до ${recipe.storage.freezerDays} дней` : ""}:</b> {recipe.storage.freezer}</p>}{recipe.storage.freezeParts && <p><b>Что замораживать:</b> {recipe.storage.freezeParts}</p>}{recipe.storage.thaw && <p><b>Как разморозить:</b> {recipe.storage.thaw}</p>}<small>Сроки — консервативные ориентиры, а не гарантия.</small></section><section className="recipe-source glass-card"><p className="kicker">Происхождение</p><h2>{originLabel}</h2>{recipe.provenance.kind === "parsed" ? <><a href={recipe.provenance.sourceUrl} target="_blank" rel="noreferrer">{recipe.provenance.sourceTitle} ↗</a>{recipe.provenance.adaptation && <p>Адаптация для Mise: {recipe.provenance.adaptation}</p>}<small>Найдено по запросу «{recipe.provenance.sourceQuery}».</small></> : <><p>Рецепт собран для курированного каталога Mise.</p><small>{recipe.provenance.basedOn?.length ? `Опирается на ${recipe.provenance.basedOn.length} отобранных источника.` : "Без внешнего рецепта-прототипа."}</small></>}</section></main>;
}
