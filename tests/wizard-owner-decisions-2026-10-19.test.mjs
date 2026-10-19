import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./typescript-module.mjs";

/* Решения владельца от 2026-10-19, которые подсветил редизайн C:
   хвост периода решается без вопроса, параметры тела и имя не подставляются,
   повтор плана начинается после окончания текущего, а новые входы круга «+» и
   листа «Следующий план» отправляют те же события, что прежние. */

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const modules = await Promise.all(
  ["recipe-engine", "cooking-duration", "nutrition-history", "recipe-cuisine", "nutrition", "portion-allocation", "meal-execution", "cooking-session"].map(
    (name) => loadTypeScriptModule(new URL(`../domain/${name}.ts`, import.meta.url)),
  ),
);
const nutrition = modules[4];
const { validatePlanForPersistence } = await loadTypeScriptModule(new URL("../lib/plan-validation.ts", import.meta.url));
const plurals = await loadTypeScriptModule(new URL("../lib/plural.ts", import.meta.url));
const page = await read("app/page.tsx");

async function runtime() {
  const start = page.indexOf("const mealMeta");
  const end = page.indexOf("export default function Home");
  const output = ts.transpileModule(
    `${page.slice(start, end)}\nglobalThis.__runtime = { buildBatches, tailJoinAllowed, batchLayoutLabel, savedTailDecision, nextPlanStart, newPerson, normalizePerson, automaticEstimateIssue, personLabel, personInitial, missingBodyFields };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const sandbox = {
    ...Object.assign({}, ...modules.map((module) => ({ ...module }))),
    ...plurals,
    runtimeRecipeCatalogJson: JSON.parse(await read("data/recipe-runtime-catalog.json")),
    portionComponentsJson: JSON.parse(await read("data/recipe-portion-components.json")),
    legacyRecipeImageDownloadSourcesJson: JSON.parse(await read("data/legacy-recipe-image-download-sources.json")),
    nutritionMealProteinFloor: nutrition.mealProteinFloor,
    nutritionMacroCalories: nutrition.macroCalories,
    nutritionMacrosForCalories: nutrition.macrosForCalories,
    nutritionRecalculateDailyMacros: nutrition.recalculateDailyMacros,
    nutritionShareForSlots: nutrition.shareForSlots,
    nutritionRepairLegacyDailyMacros: nutrition.repairLegacyDailyMacros,
    togglePersonMealSlotSelection: nutrition.togglePersonMealSlot,
  };
  vm.runInNewContext(output, sandbox);
  return sandbox.__runtime;
}
const R = await runtime();
const between = (from, to) => page.slice(page.indexOf(from), page.indexOf(to, page.indexOf(from)));
const lengths = (batches) => Array.from(batches, (batch) => batch.days);

test("a leftover joins the last batch only while it stays within four days", () => {
  const joined = R.buildBatches("2026-10-19", 7, 3, true);
  assert.deepEqual(lengths(joined), [3, 4], "7 days by 3 are two cooking evenings");
  assert.deepEqual(Array.from(joined, (batch) => [batch.id, batch.start, batch.end]), [
    ["batch-0", "2026-10-19", "2026-10-21"],
    ["batch-1", "2026-10-22", "2026-10-25"],
  ]);
  assert.deepEqual(lengths(R.buildBatches("2026-10-19", 10, 3, true)), [3, 3, 4]);
  assert.deepEqual(lengths(R.buildBatches("2026-10-19", 7, 2, true)), [2, 2, 3]);
  assert.deepEqual(lengths(R.buildBatches("2026-10-19", 4, 3, true)), [4]);
  // Партия длиннее 4 дней держалась бы на заморозке: хвост остаётся отдельным.
  assert.deepEqual(lengths(R.buildBatches("2026-10-19", 8, 3, true)), [3, 3, 2]);
  assert.deepEqual(lengths(R.buildBatches("2026-10-19", 9, 4, true)), [4, 4, 1]);
  assert.deepEqual(lengths(R.buildBatches("2026-10-19", 2, 3, true)), [2], "no full batch to join");
  assert.deepEqual(lengths(R.buildBatches("2026-10-19", 6, 3, true)), [3, 3]);
  // Без флага разбиение прежнее — им пользуются отдельная мини-партия и тесты меню.
  assert.deepEqual(lengths(R.buildBatches("2026-10-19", 7, 3)), [3, 3, 1]);
  assert.equal(R.tailJoinAllowed(7, 3), true);
  assert.equal(R.tailJoinAllowed(8, 3), false);
  assert.equal(R.tailJoinAllowed(5, 4), false);
});

test("the card names the layout in words", () => {
  assert.equal(R.batchLayoutLabel(R.buildBatches("2026-10-19", 7, 3, true)), "3 дня + 4 дня");
  assert.equal(R.batchLayoutLabel(R.buildBatches("2026-10-19", 14, 3, true)), "4 партии по 3 дня + 2 дня");
  assert.equal(R.batchLayoutLabel(R.buildBatches("2026-10-19", 4, 3, true)), "одна партия на 4 дня");
  assert.equal(R.batchLayoutLabel(R.buildBatches("2026-10-19", 8, 3, true)), "3 дня + 3 дня + 2 дня");
});

test("the leftover is decided without a question, the old choices stay behind «Изменить»", () => {
  assert.match(page, /const autoTail: TailDecision =\s*tailJoinable && joinedTailGaps\.length === 0 \? "join" : "separate";/);
  const cookingStep = between("function CookingStep(", "/* Шаг «Выбор меню»");
  assert.match(cookingStep, /aria-expanded=\{tailOptionsOpen\}/);
  assert.match(cookingStep, /\{tailOptionsOpen \? "Свернуть" : "Изменить"\}/);
  assert.match(cookingStep, /hidden=\{!tailOptionsOpen\}/, "the options are not a mandatory question");
  for (const text of ["хвост присоединён", "Присоединить к последней партии", "Приготовить остаток отдельно", "Добавить {cookEveryDays - remainder} дн.", "Убрать {remainder} дн."])
    assert.ok(cookingStep.includes(text), `the card keeps «${text}»`);
  // Правка сохранённого плана не перекладывает его партии.
  assert.equal(R.savedTailDecision({ cookEveryDays: 3, periodDays: 7, batches: [{ days: 3 }, { days: 4 }] }), "join");
  assert.equal(R.savedTailDecision({ cookEveryDays: 3, periodDays: 7, batches: [{ days: 3 }, { days: 3 }, { days: 1 }] }), "separate");
  assert.equal(R.savedTailDecision({ cookEveryDays: 3, periodDays: 6, batches: [{ days: 3 }, { days: 3 }] }), null);
  assert.match(page, /initialPlan && !repeat \? savedTailDecision\(initialPlan\) : null/);
});

function sevenDayPlan(cookEveryDays, days) {
  const batches = [];
  let start = "2026-09-01";
  const shift = (value, amount) => {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  };
  days.forEach((length, index) => {
    batches.push({ id: `batch-${index}`, index, start, end: shift(start, length - 1), days: length });
    start = shift(start, length);
  });
  const selections = Object.fromEntries(batches.map((batch) => [`${batch.id}:lunch`, "tmpm-28584"]));
  return {
    id: "plan-tail", start: "2026-09-01", end: shift("2026-09-01", days.reduce((sum, value) => sum + value, 0) - 1),
    periodDays: days.reduce((sum, value) => sum + value, 0), cookEveryDays,
    menuStyle: "protein", mealSlots: ["lunch"],
    people: [{ id: "person-1", name: "Я", daily: { kcal: 2200, protein: 150, fat: 70, carbs: 242 }, includedSlots: ["lunch"] }],
    batches, selections,
    selectionAssignments: Object.fromEntries(Object.keys(selections).map((key) => [key, [{ recipeId: "tmpm-28584", personIds: ["person-1"] }]])),
    shopping: [],
  };
}

test("the server accepts a joined last batch and nothing longer", () => {
  assert.equal(JSON.stringify(validatePlanForPersistence(sevenDayPlan(3, [3, 4]))), JSON.stringify({ valid: true }));
  assert.equal(validatePlanForPersistence(sevenDayPlan(2, [2, 2, 3])).valid, true);
  assert.equal(validatePlanForPersistence(sevenDayPlan(3, [3, 3, 1])).valid, true, "a separate mini-batch stays valid");
  for (const [rhythm, days] of [[3, [4, 3]], [4, [4, 5]], [2, [2, 4]], [3, [3, 5]]])
    assert.equal(validatePlanForPersistence(sevenDayPlan(rhythm, days)).error, "plan has an invalid cooking batch", `${rhythm}: ${days.join(" + ")}`);
});

test("a new adult has no body parameters until the person enters them", () => {
  const first = R.newPerson(0);
  assert.equal(first.name, "", "the first person has no default name");
  assert.deepEqual([first.estimate.age, first.estimate.height, first.estimate.weight], [0, 0, 0]);
  assert.equal(R.automaticEstimateIssue(first), "Заполните возраст, рост и вес.");
  const second = R.newPerson(1);
  assert.equal(second.name, "Человек 2");
  assert.equal(second.estimate.goal, "maintenance");
  assert.equal(R.automaticEstimateIssue(second), "Заполните возраст, рост и вес.");
  assert.equal(R.automaticEstimateIssue({ ...first, estimate: { ...first.estimate, age: 34 } }), "Заполните рост и вес.");
  assert.match(R.automaticEstimateIssue({ ...first, estimate: { ...first.estimate, age: 9 } }), /Ребёнок 3–17 лет/, "a child's age still points to the child card");
  const filled = R.normalizePerson({ ...first, estimate: { ...first.estimate, age: 34, height: 178, weight: 76 } });
  assert.equal(R.automaticEstimateIssue(filled), null);
  assert.equal(filled.daily.kcal, nutrition.calculateNutritionTarget(filled.estimate).target.kcal, "the norm is calculated once all three are filled");
  // Сохранённый человек со своими параметрами считается как раньше.
  const saved = { ...R.newPerson(1), name: "Макс", estimate: { sex: "male", age: 30, height: 178, weight: 78, activity: "medium", musclePriority: false, goal: "loss", monthlyWeightChangeKg: 1 }, nutritionTargetMode: "auto", daily: { kcal: 1, protein: 0, fat: 0, carbs: 0 } };
  assert.equal(R.automaticEstimateIssue(saved), null);
  assert.equal(R.normalizePerson(saved).daily.kcal, nutrition.calculateNutritionTarget(saved.estimate).target.kcal);
  // Ручная норма не требует параметров тела.
  assert.equal(R.automaticEstimateIssue({ ...first, nutritionTargetMode: "manual" }), null);
});

test("the people step asks for body parameters instead of prefilling them", () => {
  const peopleStep = between("function PeopleStep(", "function CookingStep(");
  assert.match(page, /placeholder: "например, 34"/);
  assert.match(peopleStep, /placeholder=\{field\.placeholder\}/);
  assert.match(peopleStep, /\{missingBodyMessage\(missingBody\)\} — Mise посчитает норму\./);
  assert.doesNotMatch(page, /age: 30,\s*height: 178,\s*weight: 78,[\s\S]{0,200}\n}\s*;\s*\n\s*function newPerson/);
  assert.match(page, /const blankBodyEstimate: NutritionWizardInput = \{\s*\.\.\.defaultNutritionEstimate,\s*age: 0,\s*height: 0,\s*weight: 0,/);
  // «Дальше» заблокирован с причиной: блокер называет, что заполнить.
  assert.match(page, /detail: `\$\{personLabel\(invalidEstimatePerson, people\.indexOf\(invalidEstimatePerson\)\)\}: \$\{automaticEstimateIssue\(invalidEstimatePerson\)\}`/);
  // До параметров тела мастер не показывает норму-заготовку на шаге «Что готовим?».
  assert.match(page, /const dailyKcal = person && !automaticEstimateIssue\(person\) \? person\.daily\.kcal : 0;/);
});

test("the first person may stay unnamed: «Я» on labels, an icon on avatars", () => {
  assert.equal(R.personLabel({ name: "" }, 0), "Я");
  assert.equal(R.personLabel({ name: "  " }, 1), "Человек 2");
  assert.equal(R.personLabel({ name: "Алина" }, 1), "Алина");
  assert.equal(R.personInitial(""), null);
  assert.equal(R.personInitial("Я"), null, "the default label is not an initial");
  assert.equal(R.personInitial("макс"), "М");
  const peopleStep = between("function PeopleStep(", "function CookingStep(");
  assert.match(peopleStep, /placeholder="Имя для подписи контейнеров"/);
  assert.match(page, /\(index === 0 \|\| person\.name\.trim\(\)\) &&/, "only the first person may skip the name");
  assert.match(page, /people: labeledPeople,/, "the saved plan and containers are labelled «Я»");
  const picker = between("function WeekPersonPicker(", "function useCalendarAdded(");
  assert.match(picker, /personInitial\(name\) === null\s*\? <Icon name="person" size=\{16\} \/>/);
  assert.match(page, /\{personInitial\(person\.name\) \?\? <Icon name="person" size=\{20\} \/>\}/, "the profile avatar");
});

test("repeating a plan starts after the current one ends", () => {
  const plan = { end: "2026-10-25" };
  assert.equal(R.nextPlanStart(plan, "2026-10-19"), "2026-10-26");
  assert.equal(R.nextPlanStart(plan, "2026-10-25"), "2026-10-26", "the last day still belongs to the current plan");
  assert.equal(R.nextPlanStart(plan, "2026-10-27"), "2026-10-27", "a finished plan repeats from today");
  assert.equal(R.nextPlanStart(null, "2026-10-19"), "2026-10-19");
  const builder = between("function PlanBuilder(", "function StepIntro(");
  assert.match(builder, /const repeatStart = nextPlanStart\(initialPlan, today\);/);
  assert.match(builder, /repeat \? repeatStart : \(initialPlan\?\.start \?\? today\)/);
  assert.match(builder, /addDays\(repeatStart, Math\.max\(0, \(initialPlan\?\.periodDays \?\? 7\) - 1\)\)/);
  const sheet = between("function NextPlanSheet(", "/* Каталог «Рецепты»");
  assert.match(sheet, /const repeatStart = nextPlanStart\(plan, today\);/);
  assert.match(sheet, /с \{formatDate\(repeatStart\)\}/);
});

test("the «+» circle and the next-plan sheet send the same events as the old entries", () => {
  const home = between("export default function Home(", "function OnboardingShell(");
  // Круг «+» без плана ведёт туда же, куда прежняя кнопка «Составить план».
  const nav = between("function BottomNav(", "function EmptyState(");
  assert.equal((nav.match(/onClick=\{\(\) => onNavigate\("builder"\)\}/g) ?? []).length, 2);
  assert.match(home, /if \(next === "builder"\) \{\s*startPlanFlow\(false\);/);
  // Все пути нового плана проходят через startPlanFlow: «начал план» и флаг следующего плана.
  const startFlow = between("function startPlanFlow(", "function navigate(");
  assert.match(startFlow, /isNextPlan: Boolean\(activePlan\)/);
  assert.match(startFlow, /trackAnalytics\("plan_create_started", \{ flowId \}\)/);
  assert.match(home, /function repeatPlan\(\) \{\s*startPlanFlow\(true\);\s*\}/);
  const sheetWiring = between("<NextPlanSheet", "<BottomNav");
  assert.match(sheetWiring, /onRepeat=\{\(\) => \{\s*setNextPlanOpen\(false\);\s*repeatPlan\(\);/);
  assert.match(sheetWiring, /onBuild=\{\(\) => \{\s*setNextPlanOpen\(false\);\s*startPlanFlow\(false\);/);
  // «Изменить людей и цели» правит текущий план, как «Изменить» в профиле: без событий нового плана.
  assert.match(sheetWiring, /onEditPeople=\{\(\) => \{\s*setNextPlanOpen\(false\);\s*editPeople\(\);/);
  // Календарь из листа — тот же компонент, что отправляет calendar_exported.
  assert.match(between("function NextPlanSheet(", "/* Каталог «Рецепты»"), /<CalendarExportLink plan=\{notificationPlanFor\(plan\)\} device=\{clientId\(\)\} \/>/);
  // Сохранение плана после существующего — «следующий план».
  assert.match(page, /if \(isNextPlan\)\s*void trackAnalytics\(\s*"next_plan_created"/);
});
