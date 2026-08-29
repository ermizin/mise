import assert from "node:assert/strict";
import test from "node:test";
import { enrichDatasets, extractSourceInstructionFacts } from "../scripts/enrich-recipe-corpus.mjs";

const mealPrepHtml = `
  <span class="wprm-recipe-instruction-text">Preheat oven to 400 F.</span>
  <span class="wprm-recipe-instruction-text">Bake for 20 minutes until golden.</span>`;
const goodFoodHtml = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Recipe",
  recipeInstructions: [{ "@type": "HowToStep", text: "Heat a pan and cook for 8 minutes." }],
})}</script>`;

test("extractor retains structured facts but never source prose", () => {
  const facts = extractSourceInstructionFacts(mealPrepHtml, "https://mealprepmanual.com/example");
  assert.equal(facts.sourceInstructionCount, 2);
  assert.match(facts.sourceInstructionHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(facts.instructionFacts.map((item) => item.actions), [["preheat"], ["bake"]]);
  const serialized = JSON.stringify(facts);
  assert.ok(!serialized.includes("Preheat oven to 400 F"));
  assert.ok(!serialized.includes("Bake for 20 minutes until golden"));
});

test("enrichment visits only fixed saved urls and preserves all other fields and ordering", async () => {
  const first = { id: "tmpm-1", sourceUrl: "https://mealprepmanual.com/a", editorialStatus: "pending", title: "A", localization: { fit: "familiar" } };
  const second = { id: "goodfood-b", sourceUrl: "https://www.bbcgoodfood.com/recipes/b", editorialStatus: "hold", title: "B", keep: { nested: true } };
  const datasets = [
    { file: "data/mealprepmanual-candidates.json", document: { source: "TMPM", candidates: [first] } },
    { file: "data/goodfood-candidates.json", document: { source: "Good Food", candidates: [second] } },
  ];
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    return new Response(url.includes("mealprepmanual") ? mealPrepHtml : goodFoodHtml, { status: 200 });
  };
  const result = await enrichDatasets(datasets, { fetchImpl, concurrency: 2, retries: 1, timeoutMs: 100 });
  assert.deepEqual(requested, [first.sourceUrl, second.sourceUrl]);
  assert.deepEqual(datasets[0].document.candidates[0], first, "input is not mutated");
  const cards = result.flatMap((item) => item.document.candidates);
  assert.deepEqual(cards.map((item) => item.id), ["tmpm-1", "goodfood-b"]);
  assert.equal(cards[0].editorialStatus, "pending");
  assert.deepEqual(cards[1].keep, { nested: true });
  for (const card of cards) {
    assert.equal(typeof card.sourceInstructionCount, "number");
    assert.ok("sourceInstructionHash" in card);
    assert.ok(Array.isArray(card.instructionFacts));
    assert.ok(!JSON.stringify(card.instructionFacts).includes("Preheat"));
  }
  assert.equal(cards[1].sourceInstructionCount, 1);
  assert.deepEqual(cards[1].instructionFacts[0].actions, ["heat", "cook"]);
});

test("failed pages retry and report the saved source url", async () => {
  let attempts = 0;
  await assert.rejects(
    enrichDatasets([{ file: "data/mealprepmanual-candidates.json", document: { candidates: [{ id: "tmpm-1", sourceUrl: "https://mealprepmanual.com/fail" }] } }], {
      fetchImpl: async () => {
        attempts += 1;
        return new Response("nope", { status: 503, statusText: "Unavailable" });
      },
      retries: 2,
      timeoutMs: 100,
    }),
    /Could not fetch https:\/\/mealprepmanual\.com\/fail: 503 Unavailable/,
  );
  assert.equal(attempts, 2);
});
