import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the wizard keeps the user's work", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /const builderDraftKey = "mise-builder-draft/, "the draft has a storage key");
  assert.match(page, /localStorage\.setItem\(activeBuilderDraftKey/, "the active new-plan or settings draft is written while the wizard is open");
  assert.match(page, /localStorage\.getItem\(activeBuilderDraftKey/, "the active new-plan or settings draft is restored on the next open");
  assert.match(page, /selectionAssignments/, "personal slot assignments are durable");
  assert.match(page, /menuMode/, "the selected menu-building path is durable");
  assert.doesNotMatch(page, /setSelections\(\{\}\)/, "editing a plan never wipes every menu pick");
  assert.match(page, /const validSelections =/, "picks are pruned to what still fits");
  assert.ok(
    page.indexOf("const validSelections =") < page.indexOf("const allSelected ="),
    "selection validity is initialized before the wizard reads it",
  );
});

test("the wizard offers manual menu building without skipping required answers", async () => {
  const [page, product] = await Promise.all([
    read("app/page.tsx"),
    read("PRODUCT.md"),
  ]);
  assert.match(page, /Составить самому/);
  assert.match(page, /Собрать с Mise/);
  assert.match(page, /function ManualMenuStep/);
  assert.match(page, /function automaticAssignmentsFor/);
  assert.match(page, /Подобрать персональные варианты/);
  assert.match(page, /Собрать остальные \{remaining\} за меня/);
  assert.match(product, /обязательные вопросы нельзя пропустить/i);
  const automaticAssembly = page.slice(
    page.indexOf("function assembleMenu"),
    page.indexOf("function replaceSelection"),
  );
  assert.doesNotMatch(
    automaticAssembly,
    /includeDisliked:\s*true/,
    "automatic assembly never bypasses a person's dislikes",
  );
});

test("the hardware back button stays inside the app", async () => {
  const page = await read("app/page.tsx");
  const listeners = page.match(/addEventListener\("popstate"/g) ?? [];
  assert.ok(listeners.length >= 2, "the wizard and the recipe card both trap back");
  assert.match(page, /mise: "builder"[\s\S]*?builderStep:/);
  assert.match(page, /mise: "recipe"[\s\S]*?recipeId:/);
  assert.match(page, /event\.state\?\.mise === "builder"/);
});

test("the week screen answers what to do today", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /clampDate\(today, plan\.start, plan\.end\)/, "the week opens on today");
  assert.match(page, /Повторить план/, "a finished plan offers the next cycle");
  assert.match(page, /today-dot/, "today is marked in the date strip");
  assert.match(page, /Вечером переложите в холодильник/, "frozen portions are announced a day ahead");
  assert.doesNotMatch(page, /name: index === 0 \? "Максим"/, "no personal name is hardcoded");
});

test("batch cooking follows screen 5b without inventing a parallel schedule", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /function BatchCookingView/, "batch cooking is a dedicated view");
  assert.match(page, /function buildBatchCookingModel/, "one view model aggregates the batch");
  assert.match(page, /Готовить партию по шагам/, "the week exposes the cooking mode");
  assert.match(page, /Шаг готов — дальше/, "the primary action advances one step");
  assert.match(page, /Продукты шага/, "calculated products stay available in context");
  assert.match(page, /Активное время · ориентир/, "time is not presented as an exact schedule");
  assert.match(page, /history\.pushState\(\{ mise: "batch-cooking" \}/, "hardware back closes cooking mode");
  assert.match(
    page,
    /function BatchCookingView[\s\S]*?window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/,
    "batch cooking always opens from its summary",
  );
  assert.match(page, /localStorage\.setItem\(progressKey/, "progress survives an accidental close");
  assert.match(page, /localStorage\.removeItem\(progressKey\)/, "completed progress is cleared");
  assert.doesNotMatch(page, /runCount|runPlan/, "cooking is not split into automatic cookware runs");
  assert.match(page, /session\.cookingAmounts/, "cooking uses one total amount for the selected batch");
  assert.match(css, /\.cooking-batch-header/, "screen 5b owns its glass header");
  assert.match(css, /\.cooking-action-bar/, "the action stays reachable at the bottom");
  assert.doesNotMatch(page, /Сейчас · параллельно/, "the UI does not claim dependency-aware parallel planning");
});

test("a failed shopping tick is visible", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /Отметка не сохранилась/, "a failed save is reported");
  assert.match(page, /Снять отметки/, "the list can be cleared");
  assert.match(page, /undo-bar/, "clearing can be undone");
});

test("recipe cards keep photos and cooking measurements actionable", async () => {
  const [page, css] = await Promise.all([
    read("app/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /function RecipeMedia/, "one media component owns the photo fallback");
  assert.match(page, /onError=\{\(\) => setFailedPhoto\(photo\)\}/, "a failed source photo falls back instead of leaving a blank card");
  assert.match(page, /<RecipeMedia recipe=\{recipe\} eager \/>/, "the opened recipe uses its photo too");
  assert.match(
    css,
    /\.recipe-media \{[\s\S]*?height: 100px;[\s\S]*?overflow: hidden;/,
    "catalog photos cannot paint over the recipe text",
  );
  assert.match(
    css,
    /\.recipe-media img \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?height: 100%;/,
    "catalog photos stay inside the fixed media frame",
  );
  assert.match(page, /aria-pressed=\{favorite\}/, "favorite is exposed as a toggle");
  assert.match(
    page,
    /favorite \? "Убрать из избранного" : "В избранное"/,
    "favorite announces both states",
  );
  assert.match(page, /event\.stopPropagation\(\)/, "favorite never opens the recipe card");
  assert.match(
    css,
    /\.recipe-favorite-button \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/,
    "favorite keeps a 44px touch target",
  );
  assert.match(css, /ms-heart-a 380ms/, "favorite keeps the supplied spring response");
  assert.match(css, /\.detail-food img \{[\s\S]*?object-fit: cover;/, "the detail photo fills the existing hero frame");
  assert.match(page, /className="cooking-measures"/, "cooking starts with a structured measurement list");
  assert.match(page, /cookingAmounts\[ingredient\.id\]/, "cooking reads the calculated batch amount");
  assert.doesNotMatch(page, /setSection\("ingredients"\)/, "ingredients are not duplicated in a separate recipe tab");
  assert.match(page, /useState<"steps" \| "portion">\([\s\S]*?batch \? "portion" : "steps"/, "a standalone recipe opens directly on cooking");
  assert.doesNotMatch(page, /function totalIngredientScale/, "the obsolete divergent scale path is gone");
});

test("automatic and manual goals are both durable", async () => {
  const [page, nutrition] = await Promise.all([read("app/page.tsx"), read("domain/nutrition.ts")]);
  assert.match(nutrition, /function calculateNutritionTarget/, "the calculator exists");
  assert.match(nutrition, /10\s*\*\s*input\.weight\s*\+\s*6\.25\s*\*\s*input\.height\s*-\s*5\s*\*\s*input\.age/, "Mifflin-St Jeor");
  assert.match(nutrition, /energyPerKgWeightChange: 7_700/, "monthly weight change uses an explicit energy conversion");
  assert.match(page, /nutritionTargetMode/, "the chosen target source is persisted with the person");
  assert.match(page, />\s*Рассчитать\s*</, "manual targets can be replaced only by an explicit calculation");
  assert.match(page, /function onCalculate\(\)[\s\S]*?nutritionTargetMode: "auto"/);
  assert.doesNotMatch(page, /manualIds/, "manual mode is not ephemeral component state");
  assert.match(page, /Ориентир|Ориентировочный/, "the estimate is framed as an orientation");
});

test("profile settings can add any standard meal slot", async () => {
  const page = await read("app/page.tsx");
  assert.match(
    page,
    /availableMealSlots=\{mode === "settings" \? allMealSlots : mealSlots\}/,
    "settings expose all five standard slots, including snack2",
  );
  assert.match(page, /availableMealSlots\.map\(\(slot\) =>/);
  assert.match(page, /onMealSlotToggle\(person\.id, slot\)/);
  assert.match(page, /Выберите блюдо для нового приёма пищи/);
});

test("profile presents the real household goals and keeps its actions connected", async () => {
  const page = await read("app/page.tsx");
  const start = page.indexOf("function ProfileScreen(");
  const end = page.indexOf("function PlanBuilder(", start);
  assert.ok(start >= 0 && end > start, "the dedicated profile screen is present");
  const profile = page.slice(start, end);

  assert.match(
    page,
    /tab !== "recipes"\s*&&\s*tab !== "profile"/,
    "profile owns its header instead of showing the generic app header",
  );
  assert.match(profile, /<h1>Цели и порции<\/h1>/);
  assert.match(profile, /people\.map\(\(person, index\)/, "profile renders real people");
  assert.match(profile, /profileGoalLabels\[person\.estimate\.goal\]/, "the person goal is shown");
  assert.match(profile, /person\.includedSlots[\s\S]*?mealMeta\[slot\]/, "the included meal slots are shown");
  assert.match(profile, /plannedTargetsFor\(person\)/, "the plan summary derives from current targets");
  assert.match(profile, /onClick=\{onConfigure\}/, "editing a person opens settings");
  assert.match(profile, /onClick=\{onAddPerson\}/, "adding a person creates a new form instead of pretending to add one");
  assert.match(profile, /\{hasPlan && \([\s\S]*?onClick=\{onNotifications\}/, "reminders are available only with a plan");
  assert.match(profile, /onClick=\{onOpenTutorial\}/, "onboarding can be reopened");
  assert.match(profile, /onClick=\{onOpenPrepGuide\}/, "prep guidance can be reopened");
  assert.match(profile, /className="profile-settings-list glass-card"/, "settings remain grouped");
  for (const className of ["profile-kcal-ring", "profile-bars"]) {
    assert.match(profile, new RegExp(`className="${className}`), `${className} remains in the profile`);
  }
  assert.doesNotMatch(profile, /profile-compact-macros/, "every person uses the same expanded macro layout");
  assert.match(profile, /Составить план/, "profile exposes the plan creation action");
  assert.match(profile, /Удалить план/, "profile exposes a connected plan deletion action");
});

test("the interface stays legible", async () => {
  const [page, css, layout] = await Promise.all([read("app/page.tsx"), read("app/globals.css"), read("app/layout.tsx")]);
  const tiny = [...css.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1])).filter((size) => size < 12);
  assert.deepEqual(tiny, [], "nothing is smaller than 12px");
  // Liquid Glass keeps its brighter decorative ramp, while interactive surfaces
  // use the darker ramp whose lightest endpoint still clears white-text AA.
  assert.match(css, /--accent-grad-a: #ff8143/);
  assert.match(css, /--accent-grad-b: #ee4c13/);
  assert.match(css, /--accent-grad-aa: linear-gradient\(150deg, #cf430c, #b8350a\)/);
  assert.match(css, /\.btn-primary \{[\s\S]*?background: var\(--accent-grad-aa\)/);
  assert.match(css, /\.primary-button \{[\s\S]*?background: var\(--accent-grad-aa\)/);
  assert.doesNotMatch(css, /@media \(prefers-color-scheme: dark\)(?![^\n]*min-width)/, "the dark theme is disabled");
  assert.match(css, /color-scheme: light;/, "native controls stay light");
  assert.doesNotMatch(layout, /prefers-color-scheme: dark/, "the PWA chrome stays light");
  assert.match(layout, /statusBarStyle: "default"/, "the iOS status bar stays readable");
  assert.doesNotMatch(page, /aria-pressed=\{origin === "parsed"\}/, "radio groups expose radios");
});
