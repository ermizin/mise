/* Визуальная проверка редизайна Mise.

   Поднимает dev-сервер (или берёт уже запущенный на --port), открывает
   headless Chrome через CDP, проходит онбординг → мастер из семи шагов →
   сохранение плана и снимает фиксированный набор экранов: 390×844 для
   телефона, 1280×900 для недели и каталога на десктопе. Рядом с каждым
   снимком лежит JSON с метриками вёрстки:
   - горизонтальный скролл документа и экранных скроллеров (scrollWidth > clientWidth);
   - отрисованные элементы с backdrop-filter (бюджет стекла — не больше трёх);
   - минимальный вычисленный font-size видимого текста (пол — 12 px);
   - элементы, которые вылезают за вьюпорт по горизонтали.

   npm run visual:check -- [--port 3184] [--out <папка>] [--glass]

   --glass печатает таблицу «экран → элементы со стеклом» и завершает процесс
   с кодом 1, если хотя бы на одном экране больше трёх слоёв. Без флага код 1
   означает, что проход оборвался и часть экранов не снята.

   Chrome — /Applications/Google Chrome.app или путь из переменной CHROME.
   План сохраняется в локальную D1 dev-сервера, запросы к Яндекс Метрике
   блокируются, сервис-воркер обходится. Для автозапуска dev-сервера нужен
   pnpm в PATH (его зовёт predev). */
import { spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { call, launchChrome, sleep } from "./headless-chrome.mjs";

const GLASS_BUDGET = 3;
const FONT_FLOOR = 12;

const { values: options } = parseArgs({
  options: {
    port: { type: "string", default: "3184" },
    out: { type: "string" },
    glass: { type: "boolean", default: false },
  },
});
const port = Number(options.port);
if (!Number.isInteger(port) || port <= 0) throw new Error("--port должен быть числом.");
const base = `http://localhost:${port}/`;
const stamp = `${new Date().toISOString().replace(/:/g, "-").replace(/\..*$/, "")}Z`;
const outDir = options.out ?? join("artifacts", "visual", stamp);
mkdirSync(outDir, { recursive: true });

/* ---------- Функции, которые выполняются в странице ---------- */

function pageMetrics(fontFloor) {
  const root = document.documentElement;
  /* Ширина layout viewport. innerWidth в мобильной эмуляции растёт вместе
     с вылезающим контентом (страница уменьшается) и прячет поломку. */
  const width = root.clientWidth;
  const height = root.clientHeight;
  const describeOne = (node) => {
    let label = node.tagName.toLowerCase();
    if (node.id) label += `#${node.id}`;
    const classes = [...node.classList].slice(0, 3);
    if (classes.length) label += `.${classes.join(".")}`;
    const aria = node.getAttribute("aria-label");
    if (aria) label += `[aria-label="${aria.slice(0, 40)}"]`;
    return label;
  };
  const describe = (node) =>
    !node.id && !node.classList.length && node.parentElement
      ? `${describeOne(node.parentElement)} > ${describeOne(node)}`
      : describeOne(node);
  const inViewport = (rect) =>
    rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height;
  const boxes = new Map();
  for (const node of document.body.querySelectorAll("*")) {
    if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      continue;
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) boxes.set(node, rect);
  }

  const glass = [];
  for (const [node, rect] of boxes) {
    for (const pseudo of [null, "::before", "::after"]) {
      const style = getComputedStyle(node, pseudo);
      const filter = style.backdropFilter || style.webkitBackdropFilter;
      if (!filter || filter === "none") continue;
      if (
        pseudo &&
        (style.content === "none" ||
          style.content === "normal" ||
          style.display === "none")
      )
        continue;
      glass.push({
        selector: `${describe(node)}${pseudo ?? ""}`,
        filter,
        position: style.position,
        inViewport: inViewport(rect),
      });
    }
  }

  const fonts = [];
  const seenHosts = new Set();
  const range = document.createRange();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const host = text.parentElement;
    if (!host || seenHosts.has(host) || !text.nodeValue.trim()) continue;
    seenHosts.add(host);
    const box = boxes.get(host);
    /* Текст для скринридера (1×1 с clip) не виден и в пол кегля не входит. */
    if (!box || box.width <= 1 || box.height <= 1) continue;
    const style = getComputedStyle(host);
    if (style.position === "absolute" && style.clip !== "auto") continue;
    range.selectNodeContents(text);
    const rects = [...range.getClientRects()].filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    if (!rects.length) continue;
    fonts.push({
      px: parseFloat(style.fontSize),
      selector: describe(host),
      text: text.nodeValue.trim().slice(0, 40),
      inViewport: rects.some(inViewport),
    });
  }
  fonts.sort((left, right) => left.px - right.px);
  const belowFloor = fonts.filter((item) => item.px < fontFloor);

  /* Экранные скроллеры — вертикальные области во всю ширину. Ленты чипов и
     дней скроллятся вбок намеренно и сюда не попадают. */
  const scrollers = [];
  for (const [node, rect] of boxes) {
    if (rect.width < width * 0.9 || rect.height < height * 0.5) continue;
    const style = getComputedStyle(node);
    if (!/(auto|scroll)/.test(style.overflowY)) continue;
    if (node.scrollWidth > node.clientWidth + 1)
      scrollers.push({
        selector: describe(node),
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      });
  }

  const offenders = [];
  const offenderSet = new Set();
  for (const [node, rect] of boxes) {
    if (rect.left >= -1 && rect.right <= width + 1) continue;
    let clipped = false;
    for (
      let parent = node.parentElement;
      parent && parent !== document.body && parent !== root;
      parent = parent.parentElement
    ) {
      if (offenderSet.has(parent)) {
        clipped = true;
        break;
      }
      const parentBox = boxes.get(parent);
      if (
        parentBox &&
        getComputedStyle(parent).overflowX !== "visible" &&
        parentBox.left >= -1 &&
        parentBox.right <= width + 1
      ) {
        clipped = true;
        break;
      }
    }
    if (clipped) continue;
    offenderSet.add(node);
    offenders.push({
      selector: describe(node),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
    });
  }

  return {
    url: location.pathname + location.search,
    windowSize: { width, height },
    overflowX: {
      overflow: root.scrollWidth > root.clientWidth || scrollers.length > 0,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      scrollers,
    },
    backdropFilter: {
      inViewport: glass.filter((item) => item.inViewport).length,
      rendered: glass.length,
      elements: glass,
    },
    minFontSize: fonts[0] ?? null,
    belowFontFloor: { count: belowFloor.length, samples: belowFloor.slice(0, 10) },
    offViewport: { count: offenders.length, elements: offenders.slice(0, 20) },
  };
}

function clickControl(wanted) {
  const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
  const controls = [
    ...document.querySelectorAll("button, a, [role=button], [role=tab]"),
  ].filter(
    (node) =>
      !node.disabled &&
      node.getAttribute("aria-disabled") !== "true" &&
      node.checkVisibility(),
  );
  const match =
    controls.find((node) => normalize(node.textContent).startsWith(wanted)) ??
    controls.find((node) =>
      normalize(node.getAttribute("aria-label")).startsWith(wanted),
    );
  if (!match) return false;
  match.scrollIntoView({ block: "center" });
  match.click();
  return true;
}

function clickSelector(selector) {
  const node = document.querySelector(selector);
  if (!node || node.disabled) return false;
  node.scrollIntoView({ block: "center" });
  node.click();
  return true;
}

function wizardStepIs(number) {
  const pill = document.querySelector(".builder-step-pill");
  return pill?.textContent.replace(/\s+/g, " ").trim() === `Шаг ${number} из 7`;
}

function sendEnabled() {
  const send = document.querySelector(".builder-chat-send");
  return Boolean(send && !send.disabled);
}

/* Пустые числовые поля человека (возраст, рост, вес) заполняются через
   нативный setter и событие input, иначе React их не увидит. */
async function fillBodyFields(values) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  ).set;
  const filled = [];
  for (const input of document.querySelectorAll("input[type=number]")) {
    if (input.value || !input.checkVisibility()) continue;
    const label = input.getAttribute("aria-label") ?? "";
    const key = Object.keys(values).find((name) => label.startsWith(name));
    if (!key) continue;
    setValue.call(input, String(values[key]));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    filled.push(`${key} ${values[key]}`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return filled;
}

async function settleImages(timeout) {
  const pending = [...document.images].filter((image) => {
    const rect = image.getBoundingClientRect();
    return (
      !image.complete && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight
    );
  });
  await Promise.race([
    Promise.all(
      pending.map(
        (image) =>
          new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          }),
      ),
    ),
    new Promise((resolve) => setTimeout(resolve, timeout)),
  ]);
  await document.fonts.ready;
  return pending.length;
}

/* ---------- Dev-сервер ---------- */

/* HTTP-статус главной или 0, если сервер не отвечает. Первый запрос
   к холодному dev-серверу компилирует страницу ~30–60 с. */
async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    return response.status;
  } catch {
    return 0;
  }
}

let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill();
  }
}
process.on("exit", stopServer);
process.on("SIGINT", () => process.exit(130));

const initialStatus = await probe(base);
if (initialStatus >= 500)
  throw new Error(`${base} отвечает ${initialStatus}: проверьте лог dev-сервера.`);
if (!initialStatus) {
  const logPath = join(outDir, "dev-server.log");
  console.log(`Поднимаю dev-сервер на ${base} (лог: ${logPath})`);
  const log = openSync(logPath, "w");
  server = spawn(
    "npm",
    ["run", "dev", "--", "--port", String(port), "--strictPort"],
    { stdio: ["ignore", log, log], detached: true },
  );
  const started = Date.now();
  let failures = 0;
  for (let status = 0; !status || status >= 500; status = await probe(base)) {
    if (server.exitCode !== null)
      throw new Error(`dev-сервер завершился, см. ${logPath}`);
    /* Сервер поднялся, но страница не собирается (например, ошибка CSS). */
    if (status >= 500 && ++failures >= 3)
      throw new Error(`dev-сервер отвечает ${status}, см. ${logPath}`);
    /* Холодный старт: predev поднимает локальную D1, Vite собирает зависимости. */
    if (Date.now() - started > 480_000)
      throw new Error("dev-сервер не ответил за 8 минут");
    await sleep(1000);
  }
} else console.log(`Использую запущенный сервер ${base}`);

/* ---------- Chrome ---------- */

const browser = await launchChrome();
const { send, evaluate, waitFor } = browser;
let consoleErrors = [];
browser.on("Runtime.exceptionThrown", ({ exceptionDetails }) =>
  consoleErrors.push(
    (exceptionDetails.exception?.description ?? exceptionDetails.text)
      .split("\n")[0]
      .slice(0, 300),
  ),
);
browser.on("Runtime.consoleAPICalled", ({ type, args }) => {
  if (type === "error")
    consoleErrors.push(
      args
        .map((item) => item.value ?? item.description ?? "")
        .join(" ")
        .slice(0, 300),
    );
});

await send("Runtime.enable");
await send("Network.enable");
await send("Network.setBlockedURLs", {
  urls: ["*://mc.yandex.ru/*", "*://mc.yandex.com/*"],
});
await send("Network.setBypassServiceWorker", { bypass: true });
await send("Emulation.setEmulatedMedia", {
  features: [
    { name: "prefers-reduced-motion", value: "reduce" },
    { name: "prefers-color-scheme", value: "light" },
  ],
});
const { userAgent } = await send("Browser.getVersion");
const desktopAgent = userAgent.replace("HeadlessChrome", "Chrome");
const chromeVersion = desktopAgent.match(/Chrome\/[\d.]+/)?.[0] ?? "Chrome/141.0.0.0";
const phone = {
  label: "390x844",
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
  userAgent: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ${chromeVersion} Mobile Safari/537.36`,
};
const desktop = {
  label: "1280x900",
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
  userAgent: desktopAgent,
};
async function applyViewport(viewport) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });
  await send("Emulation.setUserAgentOverride", { userAgent: viewport.userAgent });
  await send("Emulation.setTouchEmulationEnabled", {
    enabled: viewport.mobile,
    maxTouchPoints: viewport.mobile ? 5 : 1,
  });
}

async function goto(url) {
  await browser.navigate(url);
  /* Первый заход после старта Vite бывает без стилей: перезагружаем. */
  try {
    await waitFor(
      `getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()`,
      "стили приложения",
    );
  } catch {
    await send("Page.reload", { ignoreCache: true });
    await waitFor(
      `getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()`,
      "стили приложения после перезагрузки",
      60_000,
    );
  }
}
/* Несколько вариантов текста — для кнопок, переименованных между ветками. */
async function click(...texts) {
  for (const text of texts)
    if (await evaluate(call(clickControl, text))) return;
  throw new Error(`нет активной кнопки «${texts.join("» / «")}»`);
}
async function clickOn(selector) {
  if (!(await evaluate(call(clickSelector, selector))))
    throw new Error(`нет активного элемента ${selector}`);
}
/* С 2026-10-19 у нового взрослого пустые возраст, рост и вес, и «Дальше»
   на шаге людей заблокирован, пока их нет. Обходчик вводит прежние значения
   по умолчанию (30 лет, 178 см, 78 кг) и отмечает это в JSON экрана. */
const bodyDefaults = { Возраст: 30, Рост: 178, Вес: 78 };
async function wizardAt(number) {
  await waitFor(call(wizardStepIs, number), `шаг ${number} мастера`, 90_000);
  try {
    await waitFor(call(sendEnabled), `кнопка шага ${number}`, 3000);
    return [];
  } catch {
    const filled = await evaluate(call(fillBodyFields, bodyDefaults));
    await waitFor(call(sendEnabled), `кнопка шага ${number}`, 90_000);
    return filled.length ? [`заполнено: ${filled.join(", ")}`] : [];
  }
}
async function openWeek() {
  await goto(base);
  await waitFor(
    `document.querySelector("#tab-panel-week") && document.body.innerText.includes("Готовить партию")`,
    "неделя с планом",
    60_000,
  );
}

/* ---------- Набор экранов ---------- */

const wizardNames = ["period", "meals", "style", "people", "cooking", "menu", "review"];
const screens = [
  {
    name: "01-onboarding-welcome",
    viewport: phone,
    async open() {
      await goto(base);
      /* Прогрев: первый проход Vite может перезагрузить страницу. */
      await sleep(3000);
      await goto(base);
      await waitFor(`document.querySelector(".onboarding-shell")`, "онбординг");
    },
  },
  {
    name: "02-onboarding-batches",
    viewport: phone,
    async open() {
      await click("Начать — это 5 минут");
      await waitFor(
        `document.querySelector('[aria-label^="Шаг 2 из"]')`,
        "второй экран онбординга",
      );
    },
  },
  {
    name: "03-onboarding-reminders",
    viewport: phone,
    async open() {
      await click("Дальше");
      await waitFor(
        `document.querySelector('[aria-label^="Шаг 3 из"]')`,
        "третий экран онбординга",
      );
    },
  },
  ...wizardNames.map((label, index) => ({
    name: `${String(index + 4).padStart(2, "0")}-wizard-${index + 1}-${label}`,
    viewport: phone,
    keepScroll: true,
    async open() {
      if (index === 0) await click("Собрать первый план");
      else await clickOn(".builder-chat-send");
      return wizardAt(index + 1);
    },
  })),
  {
    name: "11-plan-ready",
    viewport: phone,
    keepScroll: true,
    async open() {
      await click("Сохранить план");
      await waitFor(`document.querySelector("#success-title")`, "«План готов!»", 60_000);
    },
  },
  {
    name: "12-week",
    viewport: phone,
    async open() {
      await click("Открыть неделю", "Открыть план");
      await waitFor(
        `document.querySelector("#tab-panel-week") && !document.querySelector("#success-title") && document.body.innerText.includes("Готовить партию")`,
        "неделя после «Открыть неделю»",
      );
    },
  },
  {
    name: "13-next-plan-sheet",
    viewport: phone,
    keepScroll: true,
    async open() {
      await clickOn('button[aria-label="Следующий план"]');
      await waitFor(`document.querySelector("#next-plan-title")`, "лист «Следующий план»");
    },
  },
  {
    name: "14-cooking-step",
    viewport: phone,
    async open() {
      await openWeek();
      await click("Готовить партию");
      await waitFor(`document.querySelector(".cooking-batch-shell")`, "экран готовки");
    },
  },
  {
    name: "15-recipe",
    viewport: phone,
    async open() {
      await openWeek();
      await clickOn(".week-meal-open");
      await waitFor(`document.querySelector("main.recipe-detail")`, "карточка рецепта");
    },
  },
  {
    name: "16-catalog",
    viewport: phone,
    async open() {
      await openWeek();
      await clickOn("#tab-recipes");
      await waitFor(`document.querySelector("#tab-panel-recipes .recipe-card")`, "каталог");
    },
  },
  {
    name: "17-shopping",
    viewport: phone,
    async open() {
      await clickOn("#tab-shopping");
      await waitFor(`document.querySelector("#tab-panel-shopping")`, "покупки");
    },
  },
  {
    name: "18-profile",
    viewport: phone,
    async open() {
      await clickOn("#tab-profile");
      await waitFor(`document.querySelector("#tab-panel-profile")`, "профиль");
    },
  },
  {
    name: "19-desktop-week",
    viewport: desktop,
    async open() {
      await openWeek();
    },
  },
  {
    name: "20-desktop-catalog",
    viewport: desktop,
    async open() {
      await clickOn("#tab-recipes");
      await waitFor(`document.querySelector("#tab-panel-recipes .recipe-card")`, "каталог");
    },
  },
];

/* ---------- Проход ---------- */

const results = [];
let activeViewport = null;
for (const screen of screens) {
  if (activeViewport !== screen.viewport) {
    await applyViewport(screen.viewport);
    activeViewport = screen.viewport;
  }
  consoleErrors = [];
  const result = { name: screen.name, viewport: screen.viewport.label };
  const started = Date.now();
  try {
    const notes = await screen.open();
    if (notes?.length) result.notes = notes;
    await sleep(600);
    if (!screen.keepScroll) await evaluate("window.scrollTo(0, 0); 1");
    await evaluate(call(settleImages, 5000));
    await sleep(300);
  } catch (error) {
    result.error = error.message;
  }
  try {
    Object.assign(result, await evaluate(call(pageMetrics, FONT_FLOOR)));
    const shot = await send("Page.captureScreenshot", { format: "png" });
    result.screenshot = `${screen.name}${result.error ? "-FAILED" : ""}.png`;
    writeFileSync(join(outDir, result.screenshot), Buffer.from(shot.data, "base64"));
  } catch (error) {
    result.error = [result.error, `снимок: ${error.message}`].filter(Boolean).join("; ");
  }
  result.consoleErrors = consoleErrors.slice(0, 20);
  result.seconds = Math.round((Date.now() - started) / 100) / 10;
  writeFileSync(join(outDir, `${screen.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
  results.push(result);
  const status = result.error ? `ОШИБКА: ${result.error}` : "ok";
  console.log(`${screen.name.padEnd(28)} ${String(result.seconds).padStart(5)} с  ${status}`);
}
await browser.close();
stopServer();

/* ---------- Сводки ---------- */

const cell = (value) => String(value ?? "—").replace(/\|/g, "\\|");
const summaryRows = results.map((item) => [
  item.name,
  item.viewport,
  item.overflowX ? (item.overflowX.overflow ? `да (${item.overflowX.scrollWidth}/${item.overflowX.clientWidth}${item.overflowX.scrollers.length ? ` +${item.overflowX.scrollers.length} скроллер` : ""})` : "нет") : "—",
  item.backdropFilter ? `${item.backdropFilter.inViewport} / ${item.backdropFilter.rendered}` : "—",
  item.minFontSize ? `${item.minFontSize.px}px${item.belowFontFloor.count ? ` (${item.belowFontFloor.count} < ${FONT_FLOOR})` : ""}` : "—",
  item.offViewport ? item.offViewport.count : "—",
  item.consoleErrors.length,
  item.error ?? "",
]);
const summaryMarkdown = [
  `# Визуальная проверка · ${stamp}`,
  "",
  `Сервер: ${base}. Стекло — «в кадре / всего отрисовано»; бюджет ≤ ${GLASS_BUDGET}. Пол кегля ${FONT_FLOOR}px.`,
  "",
  "| Экран | Вьюпорт | Гориз. скролл | Стекло | Мин. кегль | За вьюпортом | Ошибки консоли | Проход |",
  "|---|---|---|---|---|---|---|---|",
  ...summaryRows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  "",
].join("\n");

const glassRows = results.map((item) => ({
  name: item.name,
  inViewport: item.backdropFilter?.inViewport ?? null,
  rendered: item.backdropFilter?.rendered ?? null,
  selectors: (item.backdropFilter?.elements ?? []).map(
    (element) => `${element.selector}${element.inViewport ? "" : " (за кадром)"}`,
  ),
}));
const overBudget = glassRows.filter((row) => (row.rendered ?? 0) > GLASS_BUDGET);
const glassMarkdown = [
  `# Аудит стекла · ${stamp}`,
  "",
  `Бюджет: не больше ${GLASS_BUDGET} слоёв backdrop-filter на экран. Считаются все отрисованные элементы документа (включая ::before/::after), «за кадром» — ниже или правее видимой области.`,
  "",
  "| Экран | В кадре | Всего | Элементы |",
  "|---|---|---|---|",
  ...glassRows.map(
    (row) =>
      `| ${cell(row.name)} | ${cell(row.inViewport)} | ${cell(row.rendered)}${(row.rendered ?? 0) > GLASS_BUDGET ? " ⚠" : ""} | ${row.selectors.map(cell).join("<br>") || "—"} |`,
  ),
  "",
  overBudget.length
    ? `Сверх бюджета: ${overBudget.map((row) => `${row.name} (${row.rendered})`).join(", ")}.`
    : "Все экраны в бюджете.",
  "",
].join("\n");

writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(results, null, 2)}\n`);
writeFileSync(join(outDir, "summary.md"), summaryMarkdown);
writeFileSync(join(outDir, "glass.md"), glassMarkdown);

const failed = results.filter((item) => item.error);
if (options.glass) {
  console.log("");
  console.log(`Аудит стекла (бюджет ≤ ${GLASS_BUDGET}; в кадре / всего):`);
  for (const row of glassRows) {
    const mark = (row.rendered ?? 0) > GLASS_BUDGET ? "  ⚠ сверх бюджета" : "";
    console.log(`${row.name.padEnd(28)} ${String(row.inViewport ?? "—").padStart(2)} / ${String(row.rendered ?? "—").padEnd(2)}${mark}`);
    for (const selector of row.selectors) console.log(`    ${selector}`);
  }
  console.log(
    overBudget.length
      ? `\nСверх бюджета: ${overBudget.map((row) => row.name).join(", ")}`
      : "\nВсе экраны в бюджете.",
  );
} else {
  console.log("");
  console.log(summaryMarkdown);
}
console.log(`Снимки и метрики: ${outDir}`);
if (failed.length) console.log(`Не сняты без ошибок: ${failed.map((item) => item.name).join(", ")}`);
process.exitCode = failed.length || (options.glass && overBudget.length) ? 1 : 0;
