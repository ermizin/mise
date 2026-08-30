import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deleting plans requires the owner client id and scopes the deletion to it", async () => {
  const route = await readFile(
    new URL("../app/api/plans/route.ts", import.meta.url),
    "utf8",
  );

  const start = route.indexOf("export async function DELETE");
  assert.ok(start >= 0, "the plans route exposes DELETE");
  const handler = route.slice(start);

  assert.match(
    handler,
    /const clientId = clientIdFor\(request\);[\s\S]*?if \(!clientId\).*?status: 400/,
    "DELETE rejects requests without a valid client id",
  );
  assert.match(
    handler,
    /delete\(mealPlans\)\.where\(eq\(mealPlans\.clientId, clientId\)\)/,
    "DELETE removes only plans belonging to the validated requesting client",
  );
  assert.match(
    handler,
    /select\(\{ id: pushSubscriptions\.id \}\)[\s\S]*?where\(eq\(pushSubscriptions\.clientId, clientId\)\)/,
    "DELETE resolves subscriptions through the same client before cleaning push state",
  );
  assert.match(
    handler,
    /delete\(pushJobs\)\.where\(and\(eq\(pushJobs\.subscriptionId, subscriptionId\), eq\(pushJobs\.planId, planId\)\)\)/,
    "DELETE removes scheduled push jobs only for that client's deleted plan",
  );
  assert.match(
    handler,
    /delete\(pushPreferences\)\.where\(and\(eq\(pushPreferences\.subscriptionId, subscriptionId\), eq\(pushPreferences\.planId, planId\)\)\)/,
    "DELETE removes matching push preferences as well",
  );
  assert.ok(
    handler.indexOf("delete(pushJobs)") < handler.indexOf("delete(mealPlans)"),
    "reminder cleanup happens before the plan disappears, so a failed request remains safely retryable",
  );
  assert.match(handler, /Response\.json\(\{ deleted: true \}\)/);
});
