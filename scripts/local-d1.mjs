import { spawnSync } from "node:child_process";

const mode = process.argv[2];
if (mode !== "bootstrap" && mode !== "check") throw new Error("Use bootstrap or check.");

const base = ["exec", "wrangler", "d1"];
const persistTo = process.env.MISE_D1_PERSIST_TO ?? ".wrangler/mise-local-v2";
const localArgs = ["--local", "--persist-to", persistTo, "--config", "wrangler.local.json"];
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const environment = { ...process.env, CI: "1", WRANGLER_LOG_PATH: ".wrangler/wrangler.log" };

function run(args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) throw new Error(capture ? result.stderr || result.stdout : "Wrangler command failed.");
  return result.stdout;
}

const tableOutput = run([...base, "execute", "DB", ...localArgs, "--command", "SELECT name FROM sqlite_master WHERE type='table'", "--json"], true);
const tables = JSON.parse(tableOutput)[0]?.results?.map((row) => row.name) ?? [];
const hasPlans = tables.includes("meal_plans");
const hasLedger = tables.includes("d1_migrations");
let migrations = 0;
if (hasLedger) {
  const ledgerOutput = run([...base, "execute", "DB", ...localArgs, "--command", "SELECT COUNT(*) AS count FROM d1_migrations", "--json"], true);
  migrations = Number(JSON.parse(ledgerOutput)[0]?.results?.[0]?.count ?? 0);
}

if (hasPlans && migrations === 0) {
  throw new Error(`Local D1 at ${persistTo} contains pre-migration tables but no migration history. It was left unchanged. Choose a fresh MISE_D1_PERSIST_TO path, then rerun db:local:bootstrap.`);
}

if (mode === "bootstrap") run([...base, "migrations", "apply", "DB", ...localArgs]);
run([...base, "migrations", "list", "DB", ...localArgs]);
