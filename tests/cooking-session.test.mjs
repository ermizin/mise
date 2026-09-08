import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./typescript-module.mjs";

const session = await loadTypeScriptModule(
  new URL("../domain/cooking-session.ts", import.meta.url),
);

const steps = ["prep", "cook"];
const signature = session.makeCookingSignature({ recipeId: "soup", amounts: { rice: 100 } });
const validDraft = {
  schemaVersion: 1,
  signature,
  phase: "cooking",
  currentStepId: "cook",
  weights: { anna: { rice: 100 } },
  timer: { stepId: "cook", remainingSeconds: 90, endsAt: 1_800_000_000_000 },
};
const restored = (raw, expectedSignature = signature, stepIds = steps) =>
  JSON.parse(JSON.stringify(session.restoreCookingDraft(raw, expectedSignature, stepIds)));

test("signature is stable across recursively reordered JSON keys and changes with content", () => {
  assert.equal(
    session.makeCookingSignature({ b: [{ d: 2, c: 1 }], a: true }),
    session.makeCookingSignature({ a: true, b: [{ c: 1, d: 2 }] }),
  );
  assert.notEqual(
    session.makeCookingSignature({ recipeId: "soup", amounts: { rice: 100 } }),
    session.makeCookingSignature({ recipeId: "soup", amounts: { rice: 101 } }),
  );
});

test("restores a complete serializable draft without converting an absolute timer end", () => {
  assert.deepEqual(restored(JSON.stringify(validDraft)), {
    draft: validDraft,
    invalidated: false,
  });
});

test("invalidates a valid stale draft and never carries its weights forward", () => {
  assert.deepEqual(restored(validDraft, "changed-signature"), {
    draft: null,
    invalidated: true,
  });
});

test("safely rejects malformed JSON and every invalid persisted field", () => {
  const invalid = [
    "{not json",
    { ...validDraft, schemaVersion: 2 },
    { ...validDraft, phase: "paused" },
    { ...validDraft, currentStepId: "missing" },
    { ...validDraft, weights: { anna: { rice: -1 } } },
    { ...validDraft, weights: { anna: { rice: Number.NaN } } },
    { ...validDraft, timer: { ...validDraft.timer, stepId: "missing" } },
    { ...validDraft, timer: { ...validDraft.timer, remainingSeconds: -1 } },
    { ...validDraft, timer: { ...validDraft.timer, endsAt: Number.POSITIVE_INFINITY } },
  ];
  for (const raw of invalid) {
    assert.deepEqual(restored(raw), { draft: null, invalidated: false });
  }
});

test("reports cooking, portioning, and completed progress on the N plus one scale", () => {
  assert.equal(session.cookingProgress("cooking", 0, 3), 0);
  assert.equal(session.cookingProgress("cooking", 1, 3), 0.25);
  assert.equal(session.cookingProgress("portioning", 0, 3), 0.75);
  assert.equal(session.cookingProgress("completed", 0, 3), 1);
  assert.equal(session.cookingProgress("cooking", 100, 3), 0.75);
});
