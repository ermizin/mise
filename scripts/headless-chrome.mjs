/* Headless Chrome через CDP без зависимостей: свой временный профиль,
   свободный порт отладки, одна вкладка и минимальный клиент протокола.
   Общий код scripts/visual-check.mjs и scripts/lighthouse-baseline.mjs.
   Путь к Chrome переопределяется переменной CHROME. */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const chromePath =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Если скрипт упал между запуском и close(), Chrome не должен остаться висеть. */
const running = new Set();
process.on("exit", () => {
  for (const child of running) child.kill();
});

/* Выражение для Runtime.evaluate: вызов функции, написанной в этом файле,
   с JSON-аргументами. Функция не должна замыкаться на переменные Node. */
export const call = (fn, ...args) =>
  `(${fn})(${args.map((value) => JSON.stringify(value)).join(", ")})`;

export async function launchChrome({ width = 390, height = 844 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "mise-chrome-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  running.add(child);
  let alive = true;
  const exited = new Promise((resolve) =>
    child.once("exit", () => {
      alive = false;
      running.delete(child);
      resolve();
    }),
  );
  /* Под нагрузкой (холодный dev-сервер, Lighthouse) Chrome стартует до ~30 с. */
  let port = 0;
  for (let attempt = 0; attempt < 600 && !port && alive; attempt++) {
    try {
      port = Number(
        readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0],
      );
    } catch {
      await sleep(100);
    }
  }
  if (!port) {
    child.kill();
    rmSync(profile, { recursive: true, force: true });
    throw new Error(`Chrome не открыл порт отладки (${chromePath})`);
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((item) => item.type === "page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let messageId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (!request) return;
      if (message.error)
        request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
      return;
    }
    for (const handler of listeners.get(message.method) ?? []) handler(message.params);
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  function on(method, handler) {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(handler);
    return () => listeners.get(method).delete(handler);
  }
  function once(method) {
    return new Promise((resolve) => {
      const off = on(method, (params) => {
        off();
        resolve(params);
      });
    });
  }
  async function evaluate(expression) {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails)
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text,
      );
    return result.value;
  }
  async function waitFor(expression, what, timeout = 30_000) {
    const started = Date.now();
    for (;;) {
      try {
        if (await evaluate(`Boolean(${expression})`)) return;
      } catch {
        /* страница перезагружается — пробуем ещё раз */
      }
      if (Date.now() - started > timeout) throw new Error(`не дождались: ${what}`);
      await sleep(250);
    }
  }
  async function navigate(url, timeout = 60_000) {
    const loaded = once("Page.loadEventFired");
    await send("Page.navigate", { url });
    await Promise.race([loaded, sleep(timeout)]);
  }
  async function close() {
    socket.close();
    child.kill();
    await Promise.race([exited, sleep(5000)]);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      /* Дочерние процессы Chrome ещё дописывают профиль: временная папка останется. */
    }
  }

  await send("Page.enable");
  return { port, send, on, once, evaluate, waitFor, navigate, close };
}
