/* Базовая линия Lighthouse для Mise.

   Без --url собирает прод-сборку (pnpm build) и поднимает `npm run start`
   на --port; с --url меряет уже поднятый сервер, например прод
   https://mise.ermizinm.ru. Каждая страница меряется --runs раз (по
   умолчанию 3), каждый раз в свежем профиле Chrome: mobile (эмуляция
   Lighthouse по умолчанию), категории performance, accessibility и
   best-practices. HTML- и JSON-отчёты и сводка с медианами ложатся
   в artifacts/lighthouse/<время>-<метка>/.

   Страницы:
   - home — главная глазами нового человека, то есть онбординг;
   - recipes — ?tab=recipes с пройденным онбордингом, то есть каталог.
     Флаг онбординга ставится на /robots.txt того же адреса, затем кэш
     браузера очищается, поэтому загрузка остаётся холодной.

   Запросы к /api/analytics и Яндекс Метрике блокируются и в подготовке,
   и в замере: замер прода не попадает в воронку пилота.

   `vinext start` отдаёт ответы без сжатия (JS страницы — около 6 МБ), а прод
   за Cloudflare сжимает их, поэтому локальную сборку Lighthouse меряет через
   маленький прокси с brotli: иначе simulated throttling считает LCP по
   несжатым байтам и цифры несравнимы с продом. --raw меряет vinext напрямую.
   Локальный сервер без D1 отвечает на /api/plans ошибкой 500, это попадает
   в best-practices (errors-in-console) у обеих локальных сборок одинаково.

   npm run lighthouse:baseline -- [--url https://mise.ermizinm.ru]
     [--port 3194] [--runs 3] [--label main] [--skip-build] [--raw]
     [--compare artifacts/lighthouse/<папка>/summary.json]

   --compare добавляет в сводку таблицу «было → стало» по медианам. */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { brotliCompressSync, constants as zlib } from "node:zlib";
import { chromePath, launchChrome, sleep } from "./headless-chrome.mjs";

const LIGHTHOUSE = "lighthouse@13.5.0";
const BLOCKED = ["*mc.yandex.ru*", "*mc.yandex.com*", "*/api/analytics*"];
const PAGES = [
  { name: "home", path: "/", onboarded: false, title: "Главная, первый визит (онбординг)" },
  { name: "recipes", path: "/?tab=recipes", onboarded: true, title: "Каталог ?tab=recipes, онбординг пройден" },
];

const { values: options } = parseArgs({
  options: {
    url: { type: "string" },
    port: { type: "string", default: "3194" },
    runs: { type: "string", default: "3" },
    label: { type: "string" },
    out: { type: "string" },
    "skip-build": { type: "boolean", default: false },
    raw: { type: "boolean", default: false },
    compare: { type: "string" },
  },
});
const runs = Number(options.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 9) throw new Error("--runs: от 1 до 9.");
const git = (...args) =>
  spawnSync("git", args, { encoding: "utf8" }).stdout?.trim() || null;
const commit = options.url ? null : git("rev-parse", "--short", "HEAD");
const branch = options.url ? null : git("rev-parse", "--abbrev-ref", "HEAD");
const label =
  options.label ?? (options.url ? new URL(options.url).hostname : `local-${commit}`);
const stamp = `${new Date().toISOString().replace(/:/g, "-").replace(/\..*$/, "")}Z`;
const outDir =
  options.out ??
  join("artifacts", "lighthouse", `${stamp}-${label.replace(/[^\w.-]+/g, "-")}`);
mkdirSync(outDir, { recursive: true });

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

/* ---------- Сервер ---------- */

const compressible = /text\/|javascript|json|css|svg|xml|manifest/;
function startCompressingProxy(upstream) {
  const cache = new Map();
  const proxy = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = { ...request.headers };
      for (const name of ["host", "connection", "accept-encoding", "content-length"])
        delete headers[name];
      const target = new URL(request.url, upstream);
      const upstreamResponse = await fetch(target, {
        method: request.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        redirect: "manual",
      });
      let body = Buffer.from(await upstreamResponse.arrayBuffer());
      const outgoing = {};
      for (const [name, value] of upstreamResponse.headers)
        if (!["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"].includes(name))
          outgoing[name] = value;
      const cookies = upstreamResponse.headers.getSetCookie();
      if (cookies.length) outgoing["set-cookie"] = cookies;
      const type = upstreamResponse.headers.get("content-type") ?? "";
      if (
        compressible.test(type) &&
        body.length > 1024 &&
        /\bbr\b/.test(request.headers["accept-encoding"] ?? "")
      ) {
        const key = target.pathname.startsWith("/_next/static/") ? target.pathname : null;
        const packed =
          (key && cache.get(key)) ??
          brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } });
        if (key) cache.set(key, packed);
        body = packed;
        outgoing["content-encoding"] = "br";
        outgoing.vary = outgoing.vary ? `${outgoing.vary}, Accept-Encoding` : "Accept-Encoding";
      }
      outgoing["content-length"] = String(body.length);
      response.writeHead(upstreamResponse.status, outgoing);
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error));
    }
  });
  return new Promise((resolve) =>
    proxy.listen(0, "127.0.0.1", () => resolve(proxy)),
  );
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

let base;
if (options.url) {
  base = new URL(options.url);
  if (!(await reachable(base))) throw new Error(`${base} не отвечает.`);
} else {
  base = new URL(`http://localhost:${options.port}/`);
  if (await reachable(base))
    throw new Error(`Порт ${options.port} уже занят: укажите другой --port или меряйте его через --url.`);
  const logPath = join(outDir, "server.log");
  const log = openSync(logPath, "w");
  if (!options["skip-build"]) {
    console.log(`Собираю прод-сборку (${branch} @ ${commit}), лог: ${logPath}`);
    const build = spawnSync("pnpm", ["build"], { stdio: ["ignore", log, log] });
    if (build.status !== 0) throw new Error(`pnpm build завершился с ошибкой, см. ${logPath}`);
  }
  console.log(`Поднимаю npm run start на ${base}`);
  server = spawn("npm", ["run", "start", "--", "--port", options.port], {
    stdio: ["ignore", log, log],
    detached: true,
  });
  const started = Date.now();
  while (!(await reachable(base))) {
    if (server.exitCode !== null) throw new Error(`сервер завершился, см. ${logPath}`);
    if (Date.now() - started > 90_000) throw new Error("сервер не ответил за 90 с");
    await sleep(500);
  }
  if (!options.raw) {
    const proxy = await startCompressingProxy(base);
    proxy.unref();
    base = new URL(`http://127.0.0.1:${proxy.address().port}/`);
    console.log(`Сжимающий прокси (brotli) для замера: ${base}`);
  }
}

/* ---------- Замер ---------- */

function findNode(value) {
  if (!value || typeof value !== "object") return null;
  if (value.type === "node" && (value.selector || value.snippet)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findNode(child);
    if (found) return found;
  }
  return null;
}

function extract(lhr) {
  const numeric = (id) => lhr.audits[id]?.numericValue ?? null;
  const score = (id) =>
    lhr.categories[id]?.score == null ? null : Math.round(lhr.categories[id].score * 100);
  const requests = lhr.audits["network-requests"]?.details?.items ?? [];
  const ofType = (type) => requests.filter((item) => item.resourceType === type);
  const bytes = (items) => items.reduce((sum, item) => sum + (item.transferSize ?? 0), 0);
  const failing = (category) =>
    (lhr.categories[category]?.auditRefs ?? [])
      .filter((ref) => {
        const audit = lhr.audits[ref.id];
        return ref.weight > 0 && audit && audit.score !== null && audit.score < 1;
      })
      .map((ref) => ref.id);
  const lcpNode = findNode([
    lhr.audits["largest-contentful-paint-element"]?.details,
    lhr.audits["lcp-breakdown-insight"]?.details,
    lhr.audits["lcp-discovery-insight"]?.details,
  ]);
  return {
    performance: score("performance"),
    accessibility: score("accessibility"),
    bestPractices: score("best-practices"),
    fcpMs: numeric("first-contentful-paint"),
    lcpMs: numeric("largest-contentful-paint"),
    cls: numeric("cumulative-layout-shift"),
    tbtMs: numeric("total-blocking-time"),
    speedIndexMs: numeric("speed-index"),
    totalBytes: numeric("total-byte-weight") ?? bytes(requests),
    requests: requests.length,
    fontRequests: ofType("Font").length,
    fontBytes: bytes(ofType("Font")),
    imageRequests: ofType("Image").length,
    imageBytes: bytes(ofType("Image")),
    scriptBytes: bytes(ofType("Script")),
    lcpElement: lcpNode ? (lcpNode.selector ?? lcpNode.snippet).slice(0, 120) : null,
    failedAccessibility: failing("accessibility"),
    failedBestPractices: failing("best-practices"),
    lighthouseVersion: lhr.lighthouseVersion,
    finalUrl: lhr.finalDisplayedUrl ?? lhr.finalUrl,
    runWarnings: lhr.runWarnings ?? [],
  };
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function measure(page, run) {
  const chrome = await launchChrome({ width: 412, height: 823 });
  try {
    await chrome.send("Network.enable");
    await chrome.send("Network.setBlockedURLs", { urls: BLOCKED });
    if (page.onboarded) {
      await chrome.navigate(new URL("/robots.txt", base).href);
      await chrome.evaluate(`localStorage.setItem("mise-onboarding-v3", "complete"); 1`);
      await chrome.send("Network.clearBrowserCache");
      await chrome.navigate("about:blank");
    }
    const outputPath = join(outDir, `${page.name}-${run}`);
    /* Асинхронно: прокси живёт в этом же процессе и должен отвечать. */
    const result = await runCommand(
      "npx",
      [
        "-y",
        LIGHTHOUSE,
        new URL(page.path, base).href,
        `--port=${chrome.port}`,
        "--disable-storage-reset",
        "--only-categories=performance,accessibility,best-practices",
        "--output=json",
        "--output=html",
        `--output-path=${outputPath}`,
        "--quiet",
        ...BLOCKED.map((pattern) => `--blocked-url-patterns=${pattern}`),
      ],
      { ...process.env, CHROME_PATH: chromePath },
    );
    if (result.status !== 0)
      throw new Error(`lighthouse: ${(result.stderr || result.stdout).trim().slice(-800)}`);
    return extract(JSON.parse(readFileSync(`${outputPath}.report.json`, "utf8")));
  } finally {
    await chrome.close();
  }
}

const median = (values) => {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const numericKeys = [
  "performance", "accessibility", "bestPractices", "fcpMs", "lcpMs", "cls", "tbtMs",
  "speedIndexMs", "totalBytes", "requests", "fontRequests", "fontBytes",
  "imageRequests", "imageBytes", "scriptBytes",
];

const summary = {
  label,
  stamp,
  base: base.href,
  compressedByProxy: !options.url && !options.raw,
  commit,
  branch,
  lighthouse: LIGHTHOUSE,
  formFactor: "mobile",
  runs,
  pages: {},
};
for (const page of PAGES) {
  const measured = [];
  for (let run = 1; run <= runs; run++) {
    const started = Date.now();
    const metrics = await measure(page, run);
    measured.push(metrics);
    console.log(
      `${page.name} #${run}: perf ${metrics.performance}, LCP ${Math.round(metrics.lcpMs)} мс, CLS ${metrics.cls?.toFixed(3)}, TBT ${Math.round(metrics.tbtMs)} мс (${Math.round((Date.now() - started) / 1000)} с)`,
    );
  }
  const medians = Object.fromEntries(
    numericKeys.map((key) => [key, median(measured.map((item) => item[key]))]),
  );
  const union = (key) => [...new Set(measured.flatMap((item) => item[key]))];
  summary.pages[page.name] = {
    title: page.title,
    url: new URL(page.path, base).href,
    median: {
      ...medians,
      lcpElement: measured.map((item) => item.lcpElement).find(Boolean) ?? null,
      failedAccessibility: union("failedAccessibility"),
      failedBestPractices: union("failedBestPractices"),
    },
    runs: measured,
  };
}
stopServer();

/* ---------- Сводка ---------- */

const kb = (value) => (value === null ? "—" : Math.round(value / 1024).toLocaleString("ru-RU"));
const ms = (value) => (value === null ? "—" : Math.round(value).toLocaleString("ru-RU"));
const sec = (value) => (value === null ? "—" : (value / 1000).toFixed(2));
const row = (name, m) =>
  `| ${name} | ${m.performance} | ${m.accessibility} | ${m.bestPractices} | ${sec(m.fcpMs)} | ${sec(m.lcpMs)} | ${m.cls?.toFixed(3) ?? "—"} | ${ms(m.tbtMs)} | ${kb(m.totalBytes)} | ${m.requests} | ${m.fontRequests} / ${kb(m.fontBytes)} | ${m.imageRequests} / ${kb(m.imageBytes)} | ${kb(m.scriptBytes)} |`;
const header = [
  "| Страница | Perf | A11y | BP | FCP, с | LCP, с | CLS | TBT, мс | Вес, КБ | Запросы | Шрифты, шт / КБ | Картинки, шт / КБ | JS, КБ |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
];
const lines = [
  `# Lighthouse · ${label} · ${stamp}`,
  "",
  `Адрес: ${base.href}${commit ? ` · сборка ${branch} @ ${commit} (\`npm run start\`${options.raw ? ", без сжатия" : " за brotli-прокси"})` : ""}. ${LIGHTHOUSE}, mobile (эмуляция и simulated throttling по умолчанию), ${runs} ${runs === 1 ? "прогон" : runs < 5 ? "прогона" : "прогонов"} на страницу, в таблице медианы. Аналитика и Метрика заблокированы.`,
  "",
  ...header,
  ...PAGES.map((page) => row(page.name, summary.pages[page.name].median)),
  "",
];
for (const page of PAGES) {
  const { median: m, runs: measured } = summary.pages[page.name];
  lines.push(`## ${page.name} — ${page.title}`, "");
  lines.push(`- LCP-элемент: ${m.lcpElement ? `\`${m.lcpElement}\`` : "—"}`);
  lines.push(`- Провалы доступности: ${m.failedAccessibility.join(", ") || "нет"}`);
  lines.push(`- Провалы best practices: ${m.failedBestPractices.join(", ") || "нет"}`);
  lines.push(
    `- Прогоны (perf / LCP, с / TBT, мс): ${measured.map((item) => `${item.performance} / ${sec(item.lcpMs)} / ${ms(item.tbtMs)}`).join(" · ")}`,
  );
  const warnings = [...new Set(measured.flatMap((item) => item.runWarnings))];
  if (warnings.length) lines.push(`- Предупреждения Lighthouse: ${warnings.join(" | ")}`);
  lines.push("");
}
if (options.compare) {
  const before = JSON.parse(readFileSync(options.compare, "utf8"));
  const delta = (now, was, format) => {
    if (now === null || was === null || now === undefined || was === undefined) return "—";
    const diff = now - was;
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
    return `${format(was)} → ${format(now)} (${sign}${format(Math.abs(diff))})`;
  };
  const integer = (value) => String(Math.round(value));
  lines.push(
    `## Сравнение с «${before.label}» (${before.base}${before.commit ? `, ${before.commit}` : ""})`,
    "",
    "| Страница | Perf | A11y | BP | LCP, с | CLS | TBT, мс | Вес, КБ | Шрифты, КБ | Картинки, КБ |",
    "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const page of PAGES) {
    const now = summary.pages[page.name]?.median;
    const was = before.pages?.[page.name]?.median;
    if (!now || !was) continue;
    lines.push(
      `| ${page.name} | ${delta(now.performance, was.performance, integer)} | ${delta(now.accessibility, was.accessibility, integer)} | ${delta(now.bestPractices, was.bestPractices, integer)} | ${delta(now.lcpMs, was.lcpMs, sec)} | ${delta(now.cls, was.cls, (value) => value.toFixed(3))} | ${delta(now.tbtMs, was.tbtMs, ms)} | ${delta(now.totalBytes, was.totalBytes, kb)} | ${delta(now.fontBytes, was.fontBytes, kb)} | ${delta(now.imageBytes, was.imageBytes, kb)} |`,
    );
  }
  lines.push("");
}
writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outDir, "summary.md"), lines.join("\n"));
console.log("");
console.log(lines.join("\n"));
console.log(`Отчёты: ${outDir}`);
