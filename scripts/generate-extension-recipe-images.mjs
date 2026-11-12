/*
 * Изображения карточек пакета расширения (решение владельца от 2026-11-12:
 * «недостающие фото сгенерь через опенраутер»).
 *
 * Карточки data/extension-recipes.json написаны для Mise и до этого решения
 * показывали нейтральную заглушку. Скрипт просит у модели изображений через
 * OpenRouter одно квадратное фото готового блюда на карточку и записывает:
 *   public/recipe-images/<id>.webp        1024 px, WebP;
 *   data/extension-recipe-images.json     модель, запрос, дата, SHA-256, байты.
 *
 * Запрос собирается из самой карточки: название, приём пищи, продукты одной
 * порции и шаги — чтобы на фото были продукты блюда, а не «похожее блюдо».
 * Генерация не воспроизводима: файл закрепляется SHA-256 в манифесте, а
 * сборщик пакета (scripts/build-extension-recipe-catalog.mjs) берёт фото только
 * из манифеста. Каждое изображение человек или агент сверяет с карточкой и
 * записывает результат в `visualReview`; до этого там стоит «pending».
 *
 * Ключ читается из переменной окружения OPENROUTER_API_KEY и никуда не
 * записывается. В запросе нет данных пользователей — только текст карточки.
 * Для перевода в WebP нужен `cwebp` (brew install webp).
 *
 * Запуск:
 *   OPENROUTER_API_KEY=… node scripts/generate-extension-recipe-images.mjs
 *       карточки без записи в манифесте
 *   … --ids mise-a,mise-b      только эти карточки, заново
 *   … --note mise-a="текст"    добавить к запросу карточки уточнение
 *   … --model <id>             другая модель OpenRouter
 *   … --concurrency 4          запросов одновременно
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const cardsPath = resolve(projectRoot, "data/extension-recipes.json");
export const manifestPath = resolve(projectRoot, "data/extension-recipe-images.json");
export const imageDirectory = resolve(projectRoot, "public/recipe-images");
export const defaultModel = "google/gemini-nano-banana-2.1";
export const imageWidth = 1024;
export const webpQuality = 82;
export const rightsStatus = "generated_for_Mise_owner_authorized_2026-11-12";

const mealLabel = { breakfast: "breakfast", lunch: "lunch or dinner", dinner: "lunch or dinner", snack1: "snack", snack2: "snack" };

/** Запрос для одной карточки; `note` — уточнение после сверки неудачного фото. */
export function promptForCard(card, note = "") {
  const products = card.ingredients.map((item) => `${item.name} ${item.grams} г`).join("; ");
  const steps = card.steps.map((step, index) => `${index + 1}) ${step}`).join(" ");
  return [
    "Use case: photorealistic-natural",
    "Asset type: square recipe photo for the Mise meal-prep app",
    "Scene/backdrop: neutral light kitchen table; plain ceramic plate or bowl (a glass jar or a simple container only if the dish is made or carried in one)",
    "Style/medium: photorealistic natural home cooking, realistic textures, not an advertisement",
    "Composition/framing: one modest adult portion of the finished dish, 3/4 overhead view, the dish fills most of the frame, square aspect ratio",
    "Lighting/mood: soft natural daylight",
    "Constraints: no text, no labels, no logos, no hands, no people; show only the finished dish made from the listed products; no garnish, herbs, sauces, bread or side dishes that are not listed",
    `Dish (Russian name): «${card.title}»`,
    `Meal: ${mealLabel[card.slot] ?? "main meal"}`,
    `Products in one portion: ${products}`,
    `How it is cooked (context only: show the finished dish, not the process): ${steps}`,
    ...(note ? [`Correction: ${note}`] : []),
  ].join("\n");
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function readManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      generator: "scripts/generate-extension-recipe-images.mjs",
      ownerDecision: {
        id: "extension-generated-photos-owner-2026-11-12",
        decision: "owner_requests_generated_images",
        decisionMaker: "project_owner",
        recordedAt: "2026-11-12",
        note: "Владелец поручил сгенерировать недостающие фото через OpenRouter. Изображения созданы для Mise и показывают блюдо условно: это не фотография приготовленной порции.",
      },
      images: [],
    };
  }
}

async function requestImage(model, prompt, key) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      modalities: ["image", "text"],
      image_config: { aspect_ratio: "1:1" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  const url = body.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? "";
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/su.exec(url);
  if (!match) throw new Error("OpenRouter returned no image");
  return { extension: match[1] === "jpeg" ? "jpg" : match[1], bytes: Buffer.from(match[2], "base64"), cost: body.usage?.cost ?? 0 };
}

async function toWebp(image, workDirectory, id) {
  const source = join(workDirectory, `${id}.${image.extension}`);
  const target = join(workDirectory, `${id}.webp`);
  await writeFile(source, image.bytes);
  await execFileAsync("cwebp", ["-quiet", "-q", String(webpQuality), "-m", "6", "-metadata", "none", "-resize", String(imageWidth), "0", source, "-o", target]);
  return readFile(target);
}

async function withRetry(task, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((done) => setTimeout(done, 2_000 * attempt));
    }
  }
}

export async function generateExtensionRecipeImages({ ids, notes = {}, model = defaultModel, concurrency = 4, key = process.env.OPENROUTER_API_KEY, log = console.log } = {}) {
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  await execFileAsync("cwebp", ["-version"]).catch(() => {
    throw new Error("cwebp is required to store WebP images: brew install webp");
  });
  const cards = JSON.parse(await readFile(cardsPath, "utf8")).recipes;
  const manifest = await readManifest();
  const byId = new Map(manifest.images.map((image) => [image.id, image]));
  const unknown = (ids ?? []).filter((id) => !cards.some((card) => card.id === id));
  if (unknown.length) throw new Error(`Unknown card: ${unknown.join(", ")}`);
  const queue = cards.filter((card) => (ids ? ids.includes(card.id) : !byId.has(card.id)));
  const workDirectory = await mkdtemp(join(tmpdir(), "mise-extension-images-"));
  const failures = [];
  let next = 0;
  let cost = 0;
  const save = async () => {
    manifest.images = cards.flatMap((card) => (byId.has(card.id) ? [byId.get(card.id)] : []));
    await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(`${manifestPath}.tmp`, manifestPath);
  };
  async function lane() {
    while (next < queue.length) {
      const card = queue[next++];
      try {
        const prompt = promptForCard(card, notes[card.id]);
        const image = await withRetry(() => requestImage(model, prompt, key));
        const webp = await toWebp(image, workDirectory, card.id);
        const target = join(imageDirectory, `${card.id}.webp`);
        await writeFile(`${target}.tmp`, webp);
        await rename(`${target}.tmp`, target);
        cost += image.cost;
        byId.set(card.id, {
          id: card.id,
          localPath: `/recipe-images/${card.id}.webp`,
          origin: "generated",
          generator: `OpenRouter ${model}`,
          subject: card.title,
          prompt,
          createdAt: new Date().toISOString().slice(0, 10),
          sha256: sha256(webp),
          bytes: webp.length,
          visualReview: "pending",
          rightsStatus,
        });
        await save();
        log(`${card.id}: ${webp.length} bytes`);
      } catch (error) {
        failures.push(card.id);
        log(`${card.id}: FAILED ${error.message}`);
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, lane));
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
  await save();
  log(`${queue.length - failures.length} generated, ${failures.length} failed, about $${cost.toFixed(2)}`);
  return { generated: queue.length - failures.length, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const notes = Object.fromEntries(
    args.flatMap((arg, index) => (arg === "--note" ? [args[index + 1].split(/=(.*)/su).slice(0, 2)] : [])),
  );
  const ids = value("--ids")?.split(",").filter(Boolean) ?? (Object.keys(notes).length ? Object.keys(notes) : undefined);
  const result = await generateExtensionRecipeImages({
    ids,
    notes,
    model: value("--model") ?? defaultModel,
    concurrency: Number(value("--concurrency") ?? 4),
  });
  if (result.failures.length) process.exit(1);
}
