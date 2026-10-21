import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

/* Все слои стилей приложения: globals → platform-layout → redesign-c → файлы
   экранов. Инварианты шкалы проверяются на каждом, а не только на globals.css. */
async function appStyles() {
  const dir = new URL("../app/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".css")).sort();
  return Promise.all(names.map(async (name) => [name, await readFile(new URL(name, dir), "utf8")]));
}

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
  assert.match(html, /Готовим приложение/);

  const labels = ["План на неделю", "Рецепты", "Покупки", "Профиль"];
  const positions = labels.map((label) => html.indexOf(`aria-label="${label}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.doesNotMatch(
    html,
    />\s*Добавить план\s*</,
    "the redesign keeps Compose as a separate action, not the old add-plan button",
  );
  // Над сгибом нужны Display 800 и Text 600 — оба из кириллических файлов.
  for (const file of ["WixMadeforDisplay-cyrillic", "WixMadeforText-cyrillic"]) {
    assert.match(
      html,
      new RegExp(`<link rel="preload" href="/fonts/${file}\\.woff2" as="font" type="font/woff2" crossorigin="anonymous"/>`),
      `${file} is preloaded`,
    );
  }
  assert.equal((html.match(/rel="preload"[^>]*as="font"/g) ?? []).length, 2, "only the two above-the-fold fonts are preloaded");
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
  for (const style of ["Высокобелковое", "Бюджетное", "Веганское", "Палео"]) assert.match(page, new RegExp(style));
  assert.match(page, /const releaseMenuStyles: readonly MenuStyle\[\] = \["simple", "protein", "budget", "vegan", "paleo"\]/);
  assert.match(page, /Приготовить остаток отдельно/);
  assert.match(page, /Сначала взвесьте готовую еду/);
  assert.match(page, /Фактический вес готового блюда/);
  assert.match(page, /buildShopping/);
  assert.match(page, /X-Mise-Client/);
  assert.match(page, /mise-onboarding-v3/);
  assert.match(page, /mise-onboarding-progress-v4/);
  assert.match(page, /mise-builder-draft-v\d/);
  assert.match(page, /mise-reminder-defaults-v1/);
  // В мобильном браузере онбординг включает установку между партиями и напоминаниями.
  assert.match(page, /Готовим раз —/);
  assert.match(page, /Готовка партиями/);
  assert.match(page, /— это два вечера/);
  assert.match(page, /Поставьте Mise на домашний экран/);
  assert.match(page, /Что напоминать/);
  assert.match(page, /Приложение не установлено/);
  assert.match(page, /Срок хранения истекает/);
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
  assert.match(page, /aria-label="Настроить людей и цели"\s+onClick=\{onAddPerson\}/);
  assert.match(page, /navigate\(builderEntry\.returnTab \?\? "week"\)/);
  for (const preset of ["Сбалансировано", "Больше белка", "Больше углеводов", "Больше жиров"]) assert.match(page, new RegExp(preset));
  assert.match(page, /Как распределить БЖУ/);
  assert.match(page, /recalculateDailyMacros/);
  assert.match(page, /macroPreset: "custom"/);
  assert.doesNotMatch(page, /mealsPerDay|Приёмов пищи в день/);
  for (const allergyCopy of [
    "Аллергия / мне нельзя",
    "Показать варианты из «не люблю»",
    "Риск перекрёстного контакта",
    "При аллергии сверяйте состав и возможные следы на упаковке",
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
  assert.match(page, /Завершить готовку и раскладку/);

  assert.match(route, /where\(eq\(mealPlans\.clientId, clientId\)\)/);
  assert.match(route, /id: `\$\{clientId\}:\$\{plan\.id\}`/);
  assert.match(schema, /clientId: text\("client_id"\)\.notNull\(\)/);
  assert.match(schema, /analyticsEvents = sqliteTable\("analytics_events"/);
  assert.match(layout, /images: \[\{ url: "\/og-image\.png", width: 1200, height: 630/);
  assert.match(layout, /applicationName: "Mise"/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(layout, /https:\/\/mise\.ermizinm\.ru/);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.name, "Mise");
  assert.equal(manifest.short_name, "Mise");
  assert.deepEqual(manifest.icons.map((icon) => [icon.sizes, icon.purpose]), [
    ["192x192", "any"],
    ["512x512", "any"],
    ["512x512", "maskable"],
  ]);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.onboarding-shell/);
  assert.match(css, /\.action-bar \{/);
  assert.match(css, /\.rule-card \{/);
  // Экран онбординга — колонка во всю высоту: панель действий не уезжает вверх.
  assert.match(css, /\.onboarding-shell \{[^}]*height: 100dvh/);

  // Стекло описано токенами, а не литералами: блюр приходит из --glass-*-blur.
  assert.match(css, /--glass-2-blur: blur\(14px\) saturate\(120%\)/);
  assert.match(css, /backdrop-filter: var\(--glass-2-blur\)/);

  // Шкалы — на всех слоях стилей (пакет «css»). Ни одного литерального кегля
  // и веса ниже слоя токенов, в том числе внутри шорткода font:; радиус-литерал
  // допустим ровно один на всё приложение — квадрат отметки в списке покупок.
  const styles = await appStyles();
  assert.ok(styles.length >= 9, "все слои стилей прочитаны");
  let radiusLiterals = 0;
  for (const [name, text] of styles) {
    assert.equal(text.match(/font-size: *[0-9]/g), null, `${name}: кегль задаётся только токеном`);
    assert.equal(text.match(/(?:^|[;{\s])font: [^;]*\b[0-9.]+px/g), null, `${name}: кегль в шорткоде font — тоже токеном`);
    assert.equal(
      (text.match(/font-weight: *[0-9]/g) ?? []).length,
      (text.match(/@font-face/g) ?? []).length,
      `${name}: числовой вес остаётся только в @font-face`,
    );
    radiusLiterals += (text.match(/border-radius: *[0-9]+(\.[0-9]+)?px/g) ?? []).length;
  }
  assert.equal(radiusLiterals, 1, "радиус задаётся только токеном");
  // Шрифты: одно @font-face на файл и вес (Display — диапазон 700…800, Text —
  // 400 и 600…700, чтобы вес 500 по-прежнему брал начертание 400); у Text два
  // объявления делят один вариативный файл, и браузер скачивает его один раз.
  const faces = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map(([, body]) => [
    body.match(/font-family: "([^"]+)"/)[1],
    body.match(/url\("([^"]+)"\)/)[1],
    body.match(/font-weight: ([^;]+);/)[1],
  ]);
  assert.deepEqual(faces.map(([family, , weight]) => `${family} ${weight}`), [
    "Wix Madefor Display 700 800",
    "Wix Madefor Display 700 800",
    "Wix Madefor Text 400",
    "Wix Madefor Text 400",
    "Wix Madefor Text 600 700",
    "Wix Madefor Text 600 700",
  ]);
  const fontFiles = (await readdir(new URL("../public/fonts/", import.meta.url))).filter((name) => name.endsWith(".woff2")).sort();
  assert.deepEqual([...new Set(faces.map(([, url]) => url.replace("/fonts/", "")))].sort(), fontFiles, "каждый файл шрифта объявлен, лишних файлов нет");
  assert.doesNotMatch(css, /"Instrument Sans"|"IBM Plex Mono"/, "мёртвые фолбэк-шрифты не возвращаются");
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
  assert.match(page, /favoriteRecipesStorageKey = "mise-favorite-recipes-v1"/);
  assert.match(page, /localStorage\.setItem\(favoriteRecipesStorageKey/);
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
  assert.match(page, /function\* assembleMenuSteps/);
  assert.match(page, /заменено вами/);
  // Заменённое вручную переживает пересборку.
  assert.match(page, /if \(pinned\.includes\(key\)\) continue;/);
  assert.match(page, /pinnedSelectionKeys\?: string\[\]/);
  // Правка плана берёт его закрепления; «Собрать новый план» начинает без них.
  assert.match(page, /menuSource\?\.pinnedSelectionKeys \?\? \[\]/);
  assert.match(page, /draft\.pinnedSelectionKeys \?\?/);
  assert.match(page, /pinnedSelectionKeys: validPinned/);
  // «Собрать заново» обязано дать другое меню, а не то же самое.
  assert.match(page, /avoidPerSlot/);
  assert.match(page, /setPinned\(/);
  // 9c доступен после автоматической сборки как основной ответ чата, а не как
  // пропуск обязательных вопросов до готового меню.
  assert.match(page, /function ManualMenuStep/);
  assert.match(page, /className="builder-chat-alternative"/);
  assert.match(page, /Выбрать вручную/);
  assert.match(page, /selectionAssignments\?: Record<string, RecipeAssignment\[\]>/);
  assert.match(page, /function automaticAssignmentsFor/);
  assert.match(css, /\.manual-progress \{/);
  assert.match(css, /@keyframes ms-swap-a/);
  assert.match(css, /@keyframes ms-swap-b/);
  // Ручная норма хранит режим вместе с человеком и не перезаписывается после
  // повторного открытия настроек.
  assert.match(page, /nutritionTargetMode\?: NutritionTargetMode/);
  assert.match(page, /const nutritionTargetMode = normalizeNutritionTargetMode/);
  assert.match(page, /nutritionTargetMode: "manual"/);
  assert.match(page, /nutritionTargetMode: "auto"/);
  assert.match(page, /function resumeAutoCalculation\(\)/);
  assert.doesNotMatch(page, />\s*(?:Рассчитать|Пересчитать)\s*</);
  assert.match(page, /Ввести своё/);
  assert.match(page, /Считать Mise/);
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
  assert.match(page, /className="eater-tile-tablist" role="tablist" aria-label="Едоки"/);
  assert.match(page, /className=\{`eater-tile glass-card\$\{active \? " is-active"/);
  assert.match(page, /aria-label="Добавить человека"/);
  assert.match(page, /Настраиваю/);
  assert.match(page, /builder-chat-send-count/);
  assert.match(css, /\.eater-tile-layout\.is-scrollable \{/);
  assert.match(css, /\.eater-tile-add \{[\s\S]*?border-style: dashed/s);
  assert.match(page, /className="field-box"/);
  assert.match(css, /\.field-box \{/);
  assert.match(page, /const manual = person\.nutritionTargetMode !== "auto"/);
  assert.doesNotMatch(page, /manualIds/);
  assert.match(page, /onUpdate\(person\.id, \{ estimate: next \}\)/);
  assert.match(page, /calculateNutritionTarget\(next\)/);
  assert.match(page, /daily: nextTarget/);
  assert.match(
    page,
    /nutritionTargetMode === "auto" && calculatedTarget[\s\S]{0,100}\? calculatedTarget[\s\S]{0,60}: daily/,
    "a restored automatic draft cannot show targets calculated from older body parameters",
  );
  assert.match(page, /function resumeAutoCalculation\(\)[\s\S]*?nutritionTargetMode: "auto"/);
  assert.match(page, /manual \|\| !nextTarget/);
  assert.match(page, /className=\{`norm-check \$\{converges \? "is-ok" : "is-off"\}`\}/);
  assert.match(page, /Сумма макросов/);
  assert.match(page, /Скопировать цели у/);
  for (const dead of [
    "person-editor", "goal-estimator", "macro-inputs", "preference-pills",
    "portion-preview",
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${dead}\\b`), `${dead} не пережил 9d`);
    assert.doesNotMatch(page, new RegExp(`"${dead}`), `${dead} не пережил 9d`);
  }

  // Батч 4: узкий экран не ломает поля и кнопку, а мастер не
  // создаёт backdrop-filter на каждой карточке.
  assert.match(page, /className=\{`builder-chat-header/);
  assert.match(page, /className="people-step-lead"/);
  // Подпись главной кнопки мастера переносится, а не обрезается (пакет qa);
  // прежний nowrap из globals.css перекрывался и удалён пакетом css.
  assert.match(
    await readFile(new URL("../app/redesign-c-wizard.css", import.meta.url), "utf8"),
    /Пакет «qa»[\s\S]*?\.builder-chat-send \{[^}]*white-space: normal/,
  );
  assert.match(css, /\.primary-button:disabled \{[^}]*opacity: 1/s);
  assert.match(css, /\.field-box:focus-within \{/);
  assert.match(css, /\.builder-shell \.builder-content \.glass-card \{[^}]*backdrop-filter: none/s);
  assert.match(css, /@media \(max-width: 380px\) \{[\s\S]*?\.field-row-2 \{[^}]*grid-template-columns: 1fr/);

  // Число теней не растёт: стекло описано уровнями, а не по месту.
  // Бюджеты по файлам — фактическое число после консолидации пакета «css»
  // (2026-10-20): globals держит уровни стекла, bottom-nav и compose-действие;
  // redesign-c — общие роли кита (карточка L2, пилюля) и таблетку таб-бара;
  // файлы экранов — только свои фото-рамки, наклейки и капсулы. Новая тень —
  // повод взять --shadow-* или общую роль, а не поднять бюджет.
  const shadowBudget = {
    "globals.css": 42,
    "platform-layout.css": 3,
    "redesign-c.css": 12,
    "redesign-c-week.css": 9,
    "redesign-c-cook.css": 9,
    "redesign-c-recipe.css": 7,
    "redesign-c-wizard.css": 16,
    "redesign-c-wizard-people.css": 21,
    "redesign-c-onboarding.css": 24,
  };
  assert.deepEqual(styles.map(([name]) => name).sort(), Object.keys(shadowBudget).sort(), "у каждого файла стилей есть бюджет теней");
  for (const [name, text] of styles) {
    const shadows = (text.match(/box-shadow:/g) ?? []).length;
    assert.ok(shadows <= shadowBudget[name], `${name}: ${shadows} box-shadow при бюджете ${shadowBudget[name]} — тени задаются уровнями, а не по месту`);
  }
});
