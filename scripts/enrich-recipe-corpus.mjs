import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import {
  instructionFacts,
  schemaInstructionTexts,
  wprmInstructionTexts,
} from "./recipe-instruction-facts.mjs";

export const CORPUS_FILES = [
  "data/mealprepmanual-candidates.json",
  "data/goodfood-candidates.json",
];

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const REQUEST_HEADERS = { "user-agent": "Mise recipe instruction research/1.0" };

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

function jsonLdRecipe(html) {
  for (const match of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        if (types.includes("Recipe")) return item;
        if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
      }
    } catch {
      // Embedded analytics JSON may be malformed; it is unrelated to recipe instructions.
    }
  }
  return undefined;
}

export function extractSourceInstructionFacts(html, sourceUrl = "") {
  const isMealPrepManual = /(?:^|\.)mealprepmanual\.com$/i.test(new URL(sourceUrl || "https://invalid.local").hostname);
  const wprm = wprmInstructionTexts(html);
  const recipe = jsonLdRecipe(html);
  const schema = recipe ? schemaInstructionTexts(recipe.recipeInstructions) : [];
  // Prefer the site-specific recipe widget where it is present. The fallback makes
  // the saved corpus resilient to small source-platform markup changes.
  return instructionFacts(isMealPrepManual || wprm.length ? wprm : schema);
}

async function fetchPage(url, { fetchImpl, retries, timeoutMs }) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { headers: REQUEST_HEADERS, signal: controller.signal });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText || ""}`.trim());
        return await response.text();
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(100 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Could not fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function mapConcurrent(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

function replaceInstructionFields(candidate, facts) {
  return {
    ...candidate,
    sourceInstructionCount: facts.sourceInstructionCount,
    sourceInstructionHash: facts.sourceInstructionHash ?? null,
    instructionFacts: facts.instructionFacts,
  };
}

/**
 * Enriches an already-fixed corpus in memory. It never discovers URLs or changes
 * identity/editorial fields: each fetch is for one saved candidate.sourceUrl.
 */
export async function enrichDatasets(datasets, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const retries = Math.max(1, Math.floor(options.retries ?? DEFAULT_RETRIES));
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const all = datasets.flatMap(({ file, document }) => document.candidates.map((candidate, index) => ({ file, document, candidate, index })));
  const seenIds = new Set();
  for (const item of all) {
    if (!item.candidate?.id || !item.candidate?.sourceUrl) throw new Error(`${item.file} contains a candidate without id or sourceUrl`);
    if (seenIds.has(item.candidate.id)) throw new Error(`Duplicate candidate id: ${item.candidate.id}`);
    seenIds.add(item.candidate.id);
  }

  const enriched = await mapConcurrent(all, concurrency, async (item) => {
    try {
      const html = await fetchPage(item.candidate.sourceUrl, { fetchImpl, retries, timeoutMs });
      return { ...item, facts: extractSourceInstructionFacts(html, item.candidate.sourceUrl) };
    } catch (error) {
      return { ...item, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const failures = enriched.filter((item) => item.error).map((item) => ({
    id: item.candidate.id,
    sourceUrl: item.candidate.sourceUrl,
    error: item.error,
  }));
  if (failures.length && !options.allowPartial) {
    throw new Error(`${failures[0].error}${failures.length > 1 ? ` (and ${failures.length - 1} more saved URL failures)` : ""}`);
  }
  const byFile = new Map(datasets.map(({ file, document }) => [file, { ...document, candidates: [...document.candidates] }]));
  for (const item of enriched) {
    if (!item.facts) continue;
    const document = byFile.get(item.file);
    document.candidates[item.index] = replaceInstructionFields(item.candidate, item.facts);
  }
  const result = datasets.map(({ file }) => ({ file, document: byFile.get(file) }));
  Object.defineProperty(result, "failures", { value: failures, enumerable: false });
  return result;
}

async function readCorpusFiles(files = CORPUS_FILES, cwd = process.cwd()) {
  return Promise.all(files.map(async (file) => ({
    file,
    document: JSON.parse(await readFile(resolve(cwd, file), "utf8")),
  })));
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function enrichRecipeCorpus(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const datasets = options.datasets ?? await readCorpusFiles(CORPUS_FILES, cwd);
  const result = await enrichDatasets(datasets, options);
  const dryRun = options.dryRun ?? true;
  if (!dryRun) {
    const outputDirectory = options.outputDirectory ? resolve(cwd, options.outputDirectory) : cwd;
    for (const { file, document } of result) {
      const output = options.outputDirectory ? resolve(outputDirectory, basename(file)) : resolve(cwd, file);
      await atomicWrite(output, document);
    }
  }
  return result;
}

function cliOptions(argv) {
  const args = new Map(argv.slice(2).map((value, index, values) => value.startsWith("--") ? [value, values[index + 1]] : ["", ""]));
  return {
    dryRun: !args.has("--write"),
    outputDirectory: args.get("--output-dir"),
    concurrency: args.has("--concurrency") ? Number(args.get("--concurrency")) : undefined,
    retries: args.has("--retries") ? Number(args.get("--retries")) : undefined,
    timeoutMs: args.has("--timeout-ms") ? Number(args.get("--timeout-ms")) : undefined,
    allowPartial: args.has("--allow-partial"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--help")) {
    console.log("Usage: node scripts/enrich-recipe-corpus.mjs [--write] [--allow-partial] [--output-dir DIR] [--concurrency N] [--retries N] [--timeout-ms N]");
    process.exit(0);
  }
  const options = cliOptions(process.argv);
  const result = await enrichRecipeCorpus(options);
  const count = result.reduce((sum, item) => sum + item.document.candidates.length, 0);
  console.log(`${options.dryRun ? "Dry-run checked" : "Enriched"} ${count} fixed candidates${options.outputDirectory ? ` in ${options.outputDirectory}` : ""}.`);
  if (result.failures.length) {
    console.error(`Instruction facts unavailable for ${result.failures.length}: ${result.failures.map((item) => item.id).join(", ")}`);
  }
}
