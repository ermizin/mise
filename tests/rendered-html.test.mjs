import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Russian Mise shell and navigation", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ru">/i);
  assert.match(html, /<title>Mise — милпреп без суеты<\/title>/i);
  assert.match(html, /План на неделю/);
  assert.match(html, /Ищем сохранённый план/);

  const labels = ["Составить план", "План на неделю", "Рецепты", "Покупки", "Профиль"];
  const positions = labels.map((label) => html.indexOf(`aria-label="${label}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("includes the complete plan-builder and private persistence model", async () => {
  const [page, route, schema, layout, css, manifestText] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plans/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
  ]);

  for (const step of ["Период", "Приёмы пищи", "Вид меню", "Люди и цели", "Готовка", "Выбор меню", "Проверка"]) assert.match(page, new RegExp(step));
  for (const style of ["Высокобелковое", "Бюджетное", "Палео", "Кето"]) assert.match(page, new RegExp(style));
  assert.match(page, /Приготовить остаток отдельно/);
  assert.match(page, /Сначала взвесьте готовую еду/);
  assert.match(page, /Фактический вес готового блюда/);
  assert.match(page, /buildShopping/);
  assert.match(page, /X-Mise-Client/);
  assert.match(page, /mise-onboarding-v3/);
  assert.match(page, /mise-builder-draft-v\d/);
  assert.match(page, /mise-reminder-defaults-v1/);
  // Онбординг — три экрана: обещание, партии, напоминания (SCREENS.md 7a/8a/8b).
  assert.match(page, /Готовим раз —/);
  assert.match(page, /Готовка партиями —/);
  assert.match(page, /Два напоминания,/);
  for (const promise of ["список покупок на всех", "расчётов в голове"]) assert.match(page, new RegExp(promise));
  // Инструктаж — два экрана, не блокирует и открывается из профиля и из недели.
  for (const rule of ["Остудить за 2 часа", "3–4 дня в холодильнике", "Разморозка — в холодильнике", "Подписывать каждую крышку", "Разогревать до горячего"]) assert.match(page, new RegExp(rule));
  for (const item of ["Кухонные весы", "Место в морозилке", "Маркер или наклейки"]) assert.match(page, new RegExp(item));
  assert.match(page, /Инструкция по милпрепу/);
  assert.match(page, /Как готовить партиями/);
  assert.match(page, /Добавить Mise на экран Домой/);
  assert.match(page, /Настроить напоминания/);
  assert.match(page, /КБЖУ и сроки хранения — ориентиры, а не медицинская гарантия/);
  assert.match(page, /Как работает Mise/);
  assert.match(page, /function editDayMenu\(batchId: string\)/);
  assert.match(page, /setBuilderEntry\(\{[\s\S]*?step: 5,[\s\S]*?batchId,[\s\S]*?returnTab: "week"/);
  assert.match(page, /onClick=\{\(\) => onEditMenu\(batch\.id\)\}/);
  assert.match(page, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
  assert.match(page, /function editPeople\(\)/);
  assert.match(page, /setBuilderEntry\(\{[\s\S]*?step: 3,[\s\S]*?returnTab: "profile"/);
  assert.match(page, /aria-label="Настроить людей и цели"\s+onClick=\{onConfigure\}/);
  assert.match(page, /navigate\(builderEntry\.returnTab \?\? "week"\)/);
  for (const preset of ["Сбалансировано", "Больше белка", "Больше углеводов", "Больше жиров"]) assert.match(page, new RegExp(preset));
  assert.match(page, /Автоматическое распределение/);
  assert.match(page, /recalculateDailyMacros/);
  assert.match(page, /macroPreset: "custom"/);
  assert.doesNotMatch(page, /mealsPerDay|Приёмов пищи в день/);
  for (const allergyCopy of [
    "Аллергия / мне нельзя",
    "Показать варианты из «не люблю»",
    "Риск перекрёстного контакта",
    "Проверяйте этикетку",
    "Mise не заявляет медицинскую безопасность блюда",
  ]) assert.match(page, new RegExp(allergyCopy));
  assert.match(page, /role="checkbox"/);
  assert.match(page, /aria-checked=\{active\}/);
  assert.match(page, /Ещё можно съесть/);
  assert.match(page, /никто не выбрал/);
  assert.match(page, /current\.filter\(\(slot\) => !unassignedSlots\.includes\(slot\)\)/);
  for (const event of [
    "first_open",
    "plan_create_started",
    "plan_created",
    "shopping_item_checked",
    "cooking_instructions_opened",
    "cooking_confirmed",
    "saved_plan_reopened",
    "next_plan_created",
  ]) assert.match(page, new RegExp(event));
  assert.match(page, /Отметить, что партия приготовлена/);

  assert.match(route, /where\(eq\(mealPlans\.clientId, clientId\)\)/);
  assert.match(route, /id: `\$\{clientId\}:\$\{body\.plan\.id\}`/);
  assert.match(schema, /clientId: text\("client_id"\)\.notNull\(\)/);
  assert.match(schema, /analyticsEvents = sqliteTable\("analytics_events"/);
  assert.match(layout, /images: \[\{ url: "\/og\.png"/);
  assert.match(layout, /applicationName: "Mise"/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(layout, /https:\/\/mise\.ermizinm\.ru/);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.name, "Mise");
  assert.equal(manifest.short_name, "Mise");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.onboarding-shell/);
  assert.match(css, /\.action-bar \{/);
  assert.match(css, /\.rule-card \{/);
  // Экран онбординга — колонка во всю высоту: панель действий не уезжает вверх.
  assert.match(css, /\.onboarding-shell \{[^}]*height: 100dvh/);

  // Стекло описано токенами, а не литералами: блюр приходит из --glass-*-blur.
  assert.match(css, /--glass-2-blur: blur\(28px\) saturate\(180%\)/);
  assert.match(css, /backdrop-filter: var\(--glass-2-blur\)/);

  // Шкалы. Ни одного литерального кегля и веса ниже слоя токенов;
  // радиус-литерал допустим ровно один — квадрат отметки в списке покупок.
  assert.equal(css.match(/font-size: *[0-9]/g), null, "кегль задаётся только токеном");
  assert.equal(
    (css.match(/font-weight: *[0-9]/g) ?? []).length,
    2,
    "числовой вес остаётся только в @font-face",
  );
  assert.equal(
    (css.match(/border-radius: *[0-9]+(\.[0-9]+)?px/g) ?? []).length,
    1,
    "радиус задаётся только токеном",
  );
  for (const [, size] of css.matchAll(/--(?:text|glyph)-[a-z0-9]+: *([0-9.]+)px/g)) {
    assert.ok(Number(size) >= 12, `кегль ${size}px ниже пола системы в 12px`);
  }

  // Поверхность одна: .glass / .glass-card — тот же L2, что и .glass-2.
  assert.match(css, /\.glass-2,\n\.glass,\n\.glass-card \{/);
  assert.doesNotMatch(css, /backdrop-filter: blur\(18px\) saturate\(150%\)/);

  // Note — один компонент вместо четырнадцати частных классов.
  assert.match(css, /\n\.note \{/);
  for (const dead of [
    "estimate-note", "inline-note", "inline-warning", "warning-line",
    "result-line", "calculation-note", "detail-note", "storage-card",
    "daily-balance", "schedule-summary", "notification-success",
    "notification-error", "tuner-error", "save-error",
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${dead}\\b`), `${dead} должен уйти в Note`);
    assert.doesNotMatch(page, new RegExp(`"${dead}`), `${dead} должен уйти в Note`);
  }

  for (const dead of [
    "onboarding-welcome", "onboarding-guide", "onboarding-visual", "visual-card",
    "visual-dish", "onboarding-time", "guide-progress", "result-card",
    "prep-offer", "prep-float", "prep-topic-row", "prep-checklist",
    "prep-guide-card", "prep-step-icon", "prep-tutorial-entry",
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${dead}\\b`), `${dead} не пережил редизайн экранов`);
    assert.doesNotMatch(page, new RegExp(`"${dead}`), `${dead} не пережил редизайн экранов`);
  }

  // Каталог 9a: девять полос фильтров заменены одной кнопкой со счётчиком.
  assert.match(page, /Рецепт, продукт или «что убрать»/);
  assert.match(page, /Сначала те, где меньше докупать/);
  assert.match(page, /Фильтры, активно \$\{active\.length\}/);
  // «Докупить N» не рендерится без плана: пустой бейдж хуже отсутствующего.
  assert.match(page, /missing !== null &&/);
  // Отступ скролла под фиксированной шапкой ведёт наблюдатель, а не константа,
  // и меряет border-box — иначе собственный padding шапки теряется.
  assert.match(page, /new ResizeObserver/);
  assert.match(page, /borderBoxSize\?\.\[0\]\?\.blockSize/);
  assert.doesNotMatch(css, /padding-top: 222px/);
  // У карточек сетки блюра нет намеренно: на двадцати карточках он роняет скролл.
  const recipeCardRule = css.slice(css.indexOf("\n.recipe-card {"));
  assert.doesNotMatch(
    recipeCardRule.slice(0, recipeCardRule.indexOf("}")),
    /backdrop-filter/,
    "карточка каталога не несёт backdrop-filter",
  );
  for (const dead of [
    "meal-segment", "catalog-art", "catalog-card", "recipe-badges", "round-arrow",
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${dead}\\b`), `${dead} не пережил каталог 9a`);
    assert.doesNotMatch(page, new RegExp(`"${dead}`), `${dead} не пережил каталог 9a`);
  }

  // Шаг «Выбор меню» (9b): меню приходит собранным, шаг — проверка.
  assert.match(page, /Посмотрите — что не нравится, заменю/);
  assert.match(page, /function assembleMenu/);
  assert.match(page, /заменено вами/);
  // Заменённое вручную переживает пересборку.
  assert.match(page, /if \(pinned\.includes\(key\)\) continue;/);
  assert.match(page, /pinnedSelectionKeys\?: string\[\]/);
  assert.match(page, /initialPlan\?\.pinnedSelectionKeys \?\? \[\]/);
  assert.match(page, /draft\.pinnedSelectionKeys \?\?/);
  assert.match(page, /pinnedSelectionKeys: validPinned/);
  // «Собрать заново» обязано дать другое меню, а не то же самое.
  assert.match(page, /avoidPerSlot/);
  assert.match(page, /setPinned\(/);
  // Ручная норма хранит режим вместе с человеком и не перезаписывается после
  // повторного открытия настроек.
  assert.match(page, /nutritionTargetMode\?: NutritionTargetMode/);
  assert.match(page, /nutritionTargetMode: normalizeNutritionTargetMode/);
  assert.match(page, /nutritionTargetMode: "manual"/);
  assert.match(page, /nutritionTargetMode: "auto"/);
  assert.match(page, /Вернуть расчёт Mise/);
  assert.doesNotMatch(page, /manualIds/);
  // Пошаговый выбор по слотам ушёл вместе со своей разметкой.
  for (const dead of [
    "position-strip", "candidate-card", "candidate-art", "candidate-copy",
    "menu-candidates", "fit-badge", "repeat-button", "disliked-toggle",
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${dead}\\b`), `${dead} не пережил 9b`);
    assert.doesNotMatch(page, new RegExp(`"${dead}`), `${dead} не пережил 9b`);
  }

  // Шаг «Люди и цели» (9d): один человек за раз, поля читаются полями,
  // расчёт Mise не перетирает введённую вручную норму.
  assert.match(page, /className="chip-row person-tabs" role="tablist"/);
  assert.match(page, /role="tab"\s+aria-selected=\{item\.id === person\.id\}/);
  assert.match(page, /className="field-box"/);
  assert.match(css, /\.field-box \{/);
  assert.match(page, /const manual = person\.nutritionTargetMode !== "auto"/);
  assert.doesNotMatch(page, /manualIds/);
  assert.match(page, /manual \|\| !target/);
  assert.match(page, /\{manual \? "Вернуть расчёт Mise" : "Ввести своё"\}/);
  assert.match(page, /Вернуть расчёт Mise/);
  assert.match(page, /className=\{`norm-check \$\{converges \? "is-ok" : "is-off"\}`\} role="status"/);
  assert.match(page, /Сумма макросов/);
  assert.match(page, /Скопировать цели у/);
  for (const dead of [
    "person-editor", "goal-estimator", "macro-inputs", "preference-pills",
    "portion-preview",
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${dead}\\b`), `${dead} не пережил 9d`);
    assert.doesNotMatch(page, new RegExp(`"${dead}`), `${dead} не пережил 9d`);
  }

  // Число теней не растёт: стекло описано уровнями, а не по месту.
  assert.ok(
    (css.match(/box-shadow:/g) ?? []).length <= 44,
    "тени задаются уровнями стекла, а не по месту",
  );
});
