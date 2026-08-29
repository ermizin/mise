#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataDir = path.join(root, 'data');
const editorialDir = path.join(dataDir, 'recipe-editorial');
const execFileAsync = promisify(execFile);

const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));

// recipe-engine.ts is TypeScript. Keep the normal generator runnable with plain
// Node by asking a short-lived child process (with Node's built-in type stripping)
// for only the normalization facts needed by this standalone page.
if (process.argv.includes('--engine-snapshot')) {
  const { canonicalIngredients, normalizeRawRecipeCandidate } = await import(pathToFileURL(path.join(root, 'domain/recipe-engine.ts')).href);
  const { sourceAmount } = await import(pathToFileURL(path.join(root, 'scripts/recipe-corpus-normalize.mjs')).href);
  const rawSources = await Promise.all([
    readJson('data/mealprepmanual-candidates.json'),
    readJson('data/goodfood-candidates.json'),
  ]);
  const mappings = {};
  for (const source of rawSources) {
    for (const recipe of source.candidates || []) {
      const normalized = normalizeRawRecipeCandidate(recipe, { publisher: source.source || 'Imported recipe', accessedAt: source.importedAt || '' });
      mappings[recipe.id] = normalized.ingredientMappings.map((mapping, index) => {
        const measured = sourceAmount(normalized.sourceIngredients[index]);
        return {
          sourceAmount: measured?.amount ?? mapping.sourceAmount,
          sourceUnit: measured?.unit ?? mapping.sourceUnit,
          amountStatus: measured?.status ?? 'missing',
          canonicalIngredientId: mapping.canonicalIngredientId,
          status: mapping.status,
        };
      });
    }
  }
  const profiles = Object.fromEntries(Object.entries(canonicalIngredients).map(([id, ingredient]) => [id, {
    sensibleUnit: ingredient.unit.sensibleUnit,
    gramsPerUnit: ingredient.unit.gramsPerUnit,
  }]));
  await new Promise((resolve, reject) => process.stdout.write(JSON.stringify({ mappings, profiles }), (error) => error ? reject(error) : resolve()));
  process.exit(0);
}

const engineSnapshot = JSON.parse((await execFileAsync(process.execPath, [
  '--experimental-strip-types', fileURLToPath(import.meta.url), '--engine-snapshot',
], { maxBuffer: 16 * 1024 * 1024 })).stdout);
const audit = await readJson('data/recipe-release-audit.json');
const sources = await Promise.all([
  readJson('data/mealprepmanual-candidates.json'),
  readJson('data/goodfood-candidates.json'),
]);

const candidates = new Map(sources.flatMap((source) => source.candidates || []).map((recipe) => [recipe.id, recipe]));
const editorialNames = (await readdir(editorialDir))
  .filter((name) => /^cards-.*\.json$/.test(name))
  .sort((left, right) => {
    const leftPatch = left.includes('patch');
    const rightPatch = right.includes('patch');
    return leftPatch === rightPatch ? left.localeCompare(right) : leftPatch ? 1 : -1;
  });
const editorial = new Map();
for (const name of editorialNames) {
  const cards = JSON.parse(await readFile(path.join(editorialDir, name), 'utf8'));
  for (const card of cards) editorial.set(card.id, card);
}

const categoryDefinitions = [
  { key: 'yield', label: 'Проблемный выход', codes: ['fractional_servings', 'fractional_yield', 'invalid_yield', 'missing_yield'], options: [['confirm_yield', 'Подтвердить выход источника'], ['round_yield', 'Округлить выход и пересчитать порцию'], ['split_recipe', 'Разделить рецепт на порции с целым выходом'], ['exclude_card', 'Исключить карточку']] },
  { key: 'label', label: 'Зависит от бренда / этикетки', codes: ['label_dependent_ingredient', 'label_required'], options: [['use_label', 'Внести данные с конкретной этикетки'], ['measured_substitute', 'Заменить на измеримый аналог'], ['exclude_card', 'Исключить карточку']] },
  { key: 'procedure', label: 'Процедуру нужно проверить', codes: ['procedure_review_required'], options: [['verify_source_steps', 'Сверить с первичным источником'], ['rewrite_procedure', 'Уточнить и переписать процедуру'], ['exclude_card', 'Исключить карточку']] },
  { key: 'kcal', label: 'Экстремальная калорийность', codes: ['extreme_kcal'], options: [['confirm_kcal', 'Подтвердить расчёт'], ['recalculate_kcal', 'Пересчитать по полным ингредиентам'], ['adjust_servings', 'Уточнить количество порций'], ['exclude_card', 'Исключить карточку']] },
  { key: 'localization', label: 'Нишевая локализация', codes: ['niche_localization'], options: [['keep_specialty', 'Оставить специализированный продукт'], ['local_substitute', 'Подобрать измеримый локальный аналог'], ['exclude_card', 'Исключить карточку']] },
  { key: 'amount', label: 'Нет количества ингредиента', codes: ['missing_ingredient_amount'], options: [['find_amount', 'Найти точное количество в первичном источнике'], ['set_verified_weight', 'Указать подтверждённый вес'], ['exclude_card', 'Исключить карточку']] },
  { key: 'replacement', label: 'Замена без распределения', codes: ['replacement_without_distribution'], options: [['define_distribution', 'Задать распределение замены'], ['restore_original', 'Вернуть исходный ингредиент'], ['exclude_card', 'Исключить карточку']] },
  { key: 'ambiguity', label: 'Оставшиеся неоднозначности', codes: [], options: [['research_source', 'Проверить первичный источник'], ['manual_review', 'Ручное редакторское решение'], ['exclude_card', 'Исключить карточку']] },
];
const knownCodes = new Set(categoryDefinitions.flatMap((definition) => definition.codes));
const nonBlocking = new Set(['independent_calculation_complete', 'nutrition_delta_within_tolerance']);
const displayDetail = (detail) => detail && typeof detail === 'object' ? detail : detail ?? null;
const numberText = (value) => Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10).replace('.', ',');
const isPieceUnit = (unit) => /^(?:piece|pieces|pc|pcs|шт\.?|штука|штук)$/i.test(String(unit || '').trim());
const isGramUnit = (unit) => /^(?:g|gr|gram|grams|г|гр)$/i.test(String(unit || '').trim());

function ingredientForReview(ingredient, mapping) {
  const sourceAmount = mapping?.sourceAmount ?? (ingredient.amountMetric ?? ingredient.amount ?? ingredient.quantity ?? null);
  const amount = sourceAmount === null || sourceAmount === undefined || sourceAmount === '' || !Number.isFinite(Number(sourceAmount)) ? null : Number(sourceAmount);
  const sourceUnit = mapping?.sourceUnit || ingredient.unitMetric || ingredient.unit || null;
  const profile = mapping?.canonicalIngredientId ? engineSnapshot.profiles[mapping.canonicalIngredientId] : null;
  let measure = null;
  if (amount !== null && isPieceUnit(sourceUnit) && profile?.gramsPerUnit > 0) {
    measure = `${numberText(amount * profile.gramsPerUnit)} г (${numberText(amount)} шт.)`;
  } else if (amount !== null && (isGramUnit(sourceUnit) || profile?.sensibleUnit === 'g')) {
    measure = `${numberText(amount)} г`;
  } else if (amount !== null) {
    measure = `${numberText(amount)}${sourceUnit ? ` ${sourceUnit}` : ''}`;
  }
  return {
    name: ingredient.name || mapping?.sourceName || 'Ингредиент без названия',
    original: ingredient.original ?? null,
    measure,
    sourceAmount: amount,
    sourceUnit,
    normalizedUnit: profile?.sensibleUnit ?? null,
    gramsPerUnit: profile?.gramsPerUnit ?? null,
    canonicalIngredientId: mapping?.canonicalIngredientId ?? null,
    mappingStatus: mapping?.status ?? null,
  };
}

function categoriesFor(reasons) {
  const codes = reasons.map((reason) => reason.code);
  const result = categoryDefinitions.filter((definition) => definition.codes.some((code) => codes.includes(code))).map((definition) => definition.key);
  const hasOtherIssue = reasons.some((reason) => !knownCodes.has(reason.code) && !nonBlocking.has(reason.code) && reason.severity !== 'info');
  if (hasOtherIssue) result.push('ambiguity');
  return result;
}

const records = audit.cards.map((auditCard) => {
  const recipe = candidates.get(auditCard.id) || {};
  const card = editorial.get(auditCard.id) || {};
  const reasons = (auditCard.reasons || []).map((reason) => ({
    gate: reason.gate,
    code: reason.code,
    severity: reason.severity,
    detail: displayDetail(reason.detail),
  }));
  return {
    id: auditCard.id,
    title: card.titleRu || recipe.titleRu || auditCard.title || recipe.title || auditCard.id,
    sourceTitle: recipe.sourceTitle || recipe.title || auditCard.title || '',
    sourceUrl: auditCard.sourceUrl || recipe.sourceUrl || '',
    source: recipe.source || (auditCard.id.startsWith('goodfood-') ? 'Good Food' : 'The Meal Prep Manual'),
    slot: recipe.slot || '',
    servings: recipe.servings ?? null,
    time: recipe.time || null,
    sourceMacros: recipe.macros || null,
    calculatedNutrition: auditCard.calculatedNutrition || null,
    ingredients: (recipe.ingredients || []).map((ingredient, index) => ingredientForReview(ingredient, engineSnapshot.mappings[recipe.id]?.[index])),
    procedureStatus: card.proceduralStatus || null,
    procedureBlockers: card.proceduralBlockers || [],
    verdict: auditCard.verdict,
    editorialVerdict: auditCard.editorialVerdict,
    nutritionVerdict: auditCard.nutritionVerdict,
    reasons,
    categories: categoriesFor(reasons),
  };
}).filter((record) => record.categories.length > 0);

const categoryCounts = Object.fromEntries(categoryDefinitions.map((definition) => [definition.key, records.filter((record) => record.categories.includes(definition.key)).length]));
const payload = { generatedAt: new Date().toISOString(), auditCounts: audit.counts, categoryDefinitions, categoryCounts, records };
const embeddedPayload = JSON.stringify(payload).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mise — ревью рецептов</title>
  <style>
    :root { --ink:#202725; --muted:#68716d; --paper:#f7f4ed; --card:#fffdfa; --line:#ded8cd; --accent:#e45e3b; --accent-dark:#b94328; --mint:#dff0e7; --warn:#fff0c9; --danger:#fee1d8; --focus:#1d6b5a; }
    * { box-sizing:border-box; }
    body { margin:0; min-width:320px; background:var(--paper); color:var(--ink); font:16px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    a { color:var(--accent-dark); } a:focus-visible, button:focus-visible, select:focus-visible, textarea:focus-visible, input:focus-visible { outline:3px solid var(--focus); outline-offset:2px; }
    .shell { width:min(1180px, calc(100% - 32px)); margin:0 auto; padding:30px 0 56px; }
    header { display:grid; grid-template-columns:1fr auto; gap:18px; align-items:end; margin-bottom:22px; }
    h1 { margin:0; font-size:clamp(1.9rem,4vw,3rem); letter-spacing:-.05em; } h2 { font-size:1rem; margin:0 0 10px; } p { margin:0; }
    .lede, .meta { color:var(--muted); max-width:760px; } .meta { font-size:.84rem; text-align:right; }
    .toolbar, .filters, .card, .summary { background:var(--card); border:1px solid var(--line); border-radius:18px; box-shadow:0 8px 24px rgba(50,42,30,.05); }
    .toolbar { padding:14px; display:grid; grid-template-columns:minmax(220px,1fr) auto auto auto; gap:10px; align-items:center; position:sticky; top:8px; z-index:3; }
    input[type="search"], select, textarea { width:100%; color:var(--ink); background:#fff; border:1px solid #cfc7ba; border-radius:10px; padding:10px 12px; font:inherit; }
    button { appearance:none; border:1px solid #cfc7ba; border-radius:10px; padding:10px 12px; background:#fffdfa; color:var(--ink); cursor:pointer; font:inherit; } button:hover { border-color:var(--accent); } button.primary { color:#fff; background:var(--accent); border-color:var(--accent); } button.primary:hover { background:var(--accent-dark); }
    .progress { font-weight:700; white-space:nowrap; }.progress small { display:block; color:var(--muted); font-weight:500; }
    .filters { margin:16px 0; padding:12px; display:flex; gap:8px; flex-wrap:wrap; }.filter { text-align:left; }.filter[aria-pressed="true"] { border-color:var(--accent); background:var(--danger); color:#812b19; }.count { display:inline-grid; place-items:center; min-width:1.45rem; margin-left:5px; padding:0 5px; border-radius:999px; background:#eee8dd; font-size:.82em; }
    .summary { padding:14px; margin-bottom:16px; display:flex; gap:10px; flex-wrap:wrap; color:var(--muted); font-size:.9rem; }.pill { padding:3px 8px; border-radius:999px; background:#eee8dd; color:var(--ink); }.pill.warn { background:var(--warn); }.pill.done { background:var(--mint); }
    #cards { display:grid; gap:14px; }.card { padding:18px; }.card-top { display:flex; gap:14px; justify-content:space-between; align-items:start; }.card h2 { font-size:1.22rem; margin-bottom:4px; }.sub { color:var(--muted); font-size:.9rem; }.status { flex:none; padding:4px 9px; border-radius:999px; background:var(--danger); color:#822d1a; font-size:.82rem; font-weight:700; }.status.done { background:var(--mint); color:#1b5a45; }
    .facts { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin:14px 0; }.fact { background:#f6f2ea; border-radius:10px; padding:8px 10px; font-size:.88rem; }.fact b { display:block; font-size:.76rem; color:var(--muted); font-weight:600; }
    details { border-top:1px solid var(--line); margin-top:12px; padding-top:10px; } summary { cursor:pointer; font-weight:700; }.reasons { margin:10px 0 0; padding:0; list-style:none; display:grid; gap:7px; }.reason { border-left:3px solid var(--accent); padding:7px 9px; background:#fff8ef; border-radius:0 8px 8px 0; font-size:.9rem; }.reason code { font:600 .82em ui-monospace, SFMono-Regular, Menlo, monospace; }.reason-detail { display:block; margin-top:3px; color:var(--muted); white-space:pre-wrap; overflow-wrap:anywhere; }
    .ingredient-list { margin:10px 0 0; padding-left:20px; color:var(--muted); font-size:.9rem; }.ingredient-list li { margin:7px 0; }.ingredient-list b { color:var(--ink); }.source-original { display:block; margin-top:2px; font-size:.84rem; color:var(--muted); overflow-wrap:anywhere; }.editor { display:grid; grid-template-columns:minmax(220px,360px) 1fr; gap:10px; margin-top:16px; }.editor label { display:grid; gap:6px; font-weight:700; font-size:.9rem; }.editor textarea { min-height:76px; resize:vertical; font-weight:400; }.empty { text-align:center; padding:42px 18px; color:var(--muted); }.sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    @media (max-width:760px) { .shell { width:min(100% - 20px,1180px); padding-top:18px; } header { grid-template-columns:1fr; }.meta { text-align:left; }.toolbar { grid-template-columns:1fr 1fr; position:static; }.toolbar input { grid-column:1/-1; }.progress { grid-column:1/-1; }.editor { grid-template-columns:1fr; }.card { padding:14px; } }
  </style>
</head>
<body>
  <main class="shell">
    <header><div><h1>Ревью карточек рецептов</h1><p class="lede">Локальный рабочий экран: решения сохраняются только в браузере, пока вы не экспортируете их в JSON.</p></div><p class="meta" id="generated"></p></header>
    <section class="toolbar" aria-label="Управление ревью">
      <label class="sr" for="search">Найти рецепт</label><input id="search" type="search" placeholder="Найти рецепт или ID (клавиша /)" autocomplete="off">
      <button id="copy" type="button">Копировать JSON</button><button id="export" class="primary" type="button">Экспорт JSON</button>
      <div id="progress" class="progress" aria-live="polite"></div>
    </section>
    <nav class="filters" id="filters" aria-label="Фильтры проблем"></nav>
    <section class="summary" id="summary" aria-live="polite"></section>
    <section id="cards" aria-label="Карточки для проверки"></section>
  </main>
  <script id="review-data" type="application/json">${embeddedPayload}</script>
  <script>
    (() => {
      const data = JSON.parse(document.getElementById('review-data').textContent);
      const STORAGE = 'mise-recipe-review-decisions-v1';
      const el = (id) => document.getElementById(id);
      const filters = el('filters'), cards = el('cards'), summary = el('summary'), progress = el('progress'), search = el('search');
      const definitions = new Map(data.categoryDefinitions.map((item) => [item.key, item]));
      let active = new Set(data.categoryDefinitions.map((item) => item.key));
      let decisions = {};
      try { decisions = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch { decisions = {}; }
      const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
      const formatValue = (value) => value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      const formatDetail = (detail) => detail === null ? '' : escapeHtml(JSON.stringify(detail, null, 2));
      const decisionOptions = (record) => record.categories.map((key) => {
        const definition = definitions.get(key);
        return '<optgroup label="' + escapeHtml(definition.label) + '">' + definition.options.map(([value, label]) => '<option value="' + escapeHtml(value) + '" data-category="' + key + '">' + escapeHtml(label) + '</option>').join('') + '</optgroup>';
      }).join('');
      function save() { localStorage.setItem(STORAGE, JSON.stringify(decisions)); updateProgress(); }
      function visibleRecords() {
        const query = search.value.trim().toLocaleLowerCase('ru');
        return data.records.filter((record) => record.categories.some((key) => active.has(key)) && (!query || [record.id, record.title, record.sourceTitle].join(' ').toLocaleLowerCase('ru').includes(query)));
      }
      function updateProgress() {
        const all = data.records.length;
        const done = Object.values(decisions).filter((item) => item && item.option).length;
        const shown = visibleRecords().length;
        progress.innerHTML = escapeHtml(done) + ' / ' + escapeHtml(all) + '<small>решений сохранено · видно ' + escapeHtml(shown) + '</small>';
      }
      function renderFilters() {
        filters.innerHTML = data.categoryDefinitions.map((definition) => '<button class="filter" type="button" data-filter="' + definition.key + '" aria-pressed="' + active.has(definition.key) + '">' + escapeHtml(definition.label) + '<span class="count">' + data.categoryCounts[definition.key] + '</span></button>').join('');
      }
      function recordHtml(record) {
        const saved = decisions[record.id] || {};
        const facts = [
          ['Источник', record.source], ['Категория', record.slot], ['Выход', record.servings], ['Время', record.time?.totalMinutes ? record.time.totalMinutes + ' мин' : null],
          ['Ккал источника', record.sourceMacros?.kcal], ['Ккал расчёта', record.calculatedNutrition?.kcal], ['Статус процедуры', record.procedureStatus],
        ].filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => '<div class="fact"><b>' + escapeHtml(label) + '</b>' + escapeHtml(formatValue(value)) + '</div>').join('');
        const reasonList = record.reasons.filter((reason) => reason.severity !== 'info').map((reason) => '<li class="reason"><code>' + escapeHtml(reason.gate + ':' + reason.code) + '</code><span class="reason-detail">' + formatDetail(reason.detail) + '</span></li>').join('') || '<li class="reason">Нет блокирующих причин в этой выборке.</li>';
        const ingredientList = record.ingredients.length ? '<ul class="ingredient-list">' + record.ingredients.slice(0, 18).map((ingredient) => '<li><b>' + escapeHtml(ingredient.name) + '</b>' + (ingredient.measure ? ' — ' + escapeHtml(ingredient.measure) : '') + (ingredient.original ? '<span class="source-original">Исходная запись: ' + escapeHtml(ingredient.original) + '</span>' : '') + '</li>').join('') + (record.ingredients.length > 18 ? '<li>… ещё ' + (record.ingredients.length - 18) + '</li>' : '') + '</ul>' : '<p class="sub">Состав не импортирован.</p>';
        return '<article class="card" data-id="' + escapeHtml(record.id) + '"><div class="card-top"><div><h2>' + escapeHtml(record.title) + '</h2><p class="sub"><code>' + escapeHtml(record.id) + '</code> · <a href="' + escapeHtml(record.sourceUrl) + '" target="_blank" rel="noreferrer">открыть источник</a></p></div><span class="status ' + (saved.option ? 'done' : '') + '">' + (saved.option ? 'решение есть' : escapeHtml(record.verdict)) + '</span></div><div class="facts">' + facts + '</div><div class="summary">' + record.categories.map((key) => '<span class="pill warn">' + escapeHtml(definitions.get(key).label) + '</span>').join('') + '</div><details open><summary>Причины и исходные значения</summary><ul class="reasons">' + reasonList + '</ul></details><details><summary>Ингредиенты из карточки</summary>' + ingredientList + '</details><div class="editor"><label>Решение<select class="decision" aria-label="Решение для ' + escapeHtml(record.title) + '"><option value="">Выберите действие…</option>' + decisionOptions(record) + '</select></label><label>Комментарий<textarea class="note" placeholder="Что подтверждено, что заменить или где искать факт…">' + escapeHtml(saved.note || '') + '</textarea></label></div></article>';
      }
      function renderCards() {
        const records = visibleRecords();
        cards.innerHTML = records.length ? records.map(recordHtml).join('') : '<div class="card empty">По этому фильтру ничего не найдено.</div>';
        for (const article of cards.querySelectorAll('[data-id]')) {
          const id = article.dataset.id, saved = decisions[id] || {};
          const select = article.querySelector('.decision');
          select.value = saved.option || '';
          select.addEventListener('change', () => {
            const selected = select.selectedOptions[0];
            decisions[id] = { option: select.value, category: selected?.dataset.category || null, note: article.querySelector('.note').value, updatedAt: new Date().toISOString() };
            save(); renderCards();
          });
          article.querySelector('.note').addEventListener('input', (event) => {
            decisions[id] = { ...(decisions[id] || {}), note: event.target.value, updatedAt: new Date().toISOString() };
            save();
          });
        }
        updateProgress();
      }
      function exportPayload() {
        return { schemaVersion: 1, exportedAt: new Date().toISOString(), sourceAuditGeneratedAt: data.generatedAt, decisions: Object.entries(decisions).filter(([, value]) => value && (value.option || value.note)).map(([id, value]) => ({ id, ...value })) };
      }
      filters.addEventListener('click', (event) => {
        const button = event.target.closest('[data-filter]'); if (!button) return;
        const key = button.dataset.filter; active.has(key) ? active.delete(key) : active.add(key);
        if (!active.size) active.add(key);
        renderFilters(); renderCards();
      });
      search.addEventListener('input', renderCards);
      document.addEventListener('keydown', (event) => { if (event.key === '/' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') { event.preventDefault(); search.focus(); } });
      el('export').addEventListener('click', () => { const json = JSON.stringify(exportPayload(), null, 2); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([json], { type:'application/json' })); link.download = 'mise-recipe-review-decisions.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); });
      el('copy').addEventListener('click', async () => { const button = el('copy'); try { await navigator.clipboard.writeText(JSON.stringify(exportPayload(), null, 2)); button.textContent = 'Скопировано'; } catch { button.textContent = 'Копирование недоступно'; } setTimeout(() => { button.textContent = 'Копировать JSON'; }, 1800); });
      el('generated').textContent = 'Снимок аудита: ' + new Date(data.generatedAt).toLocaleString('ru-RU') + ' · готово ' + (data.auditCounts.ready ?? 0) + ' из ' + (data.auditCounts.ready + data.auditCounts.review_required + data.auditCounts.blocked);
      summary.innerHTML = '<span class="pill">Локальные решения: localStorage</span><span class="pill">Данные: release audit + candidates + editorial</span><span class="pill">Карточек с вопросами: ' + data.records.length + '</span>';
      renderFilters(); renderCards();
    })();
  </script>
</body>
</html>`;

await writeFile(path.join(here, 'recipe-review.html'), html, 'utf8');
console.log(`Generated review-tool/recipe-review.html with ${records.length} review cards.`);
