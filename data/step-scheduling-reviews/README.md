# Reviewed cooking-step timings

These three files are **authored source annotations**, not generated timing guesses.
`data/recipe-step-scheduling.json` is their required generated runtime projection.

The current source snapshot is `d057d4f4b9ff2dca822d2a92b9fd7f1e75153c60`:
260 actual production recipes, 310 selectable methods and 1,594 displayed
non-measure instructions, including legacy cards and the 50 simple recipes.
Every method belongs to exactly one shard; all methods of a recipe stay together.

Each method binds to the SHA-256 of the current production title, method,
equipment, source time summaries and **full ordered displayed source chain**.
`sourceRevision` records the reviewed snapshot, not the eventual integration commit.
Editorial minutes are estimates, not kitchen-tested measurements. Original recipe
text, ingredients, nutrition, selected method and quantities are not rewritten.

## Timing meanings

- `measurementMinutes`: initial weighing only, separate from recipe cooking time.
- `activeMinutes`: attended interval before a reviewed wait. Without a reviewed
  wait this covers the entire step, including conservative attended heating.
  Values are individually authored against each stored instruction. Neither an
  action classifier nor division of a recipe total is an acceptable authoring method.
- `waitMinutes`: only an explicitly reviewed bounded unattended interval.
  `waitBasis` explains its source and boundary. It must stop before stirring,
  turning, additions, checking or another operation. Source action tags and
  legacy minute projections do not authorize waiting.
- `resumeMinutes`: attended return/check and any remaining work. Cooking ranges
  reserve the remaining upper-bound interval; this is not double-counted as setup.
  A permitted range of cold marination can use its stated minimum and a short check.
- `deferred: true`: this instruction and the entire dependent tail have no current
  timestamps. All durations are zero. Use for explicit next-day/serving/storage
  actions or a prerequisite such as overnight cooling/freezing without a numeric
  duration. Original text remains visible in order, including immediate setup
  inside a compound instruction. Never replace “overnight” with a short estimate.
- `timingNote`: an explanation tied to the actual method whenever a deferred tail
  or substantial departure from the source time summary needs clarification.

The scheduler retains the full source order, even when prose offers alternatives
or says to do something during an earlier step. It does not silently choose a
shorter unselected mode. Source conditions and readiness criteria remain binding;
calendar minutes are only a planning estimate. Resources remain reserved through
all timed parts of a dish; deferred continuation is outside that timed schedule.

## Updating

Read the actual changed method before editing its review. The catalogue extractor
uses the same production recipe set, recipe-family fallback and selected-method
instructions as the app. It never derives unattended periods from text patterns.

Run `node scripts/build-recipe-step-scheduling.mjs` to regenerate the artifact,
then the scheduling tests and normal project validation. `prebuild` regenerates
the recipe catalogue and server registry, then runs this generator with `--check`:
missing/duplicate/extra coverage, source drift or a stale artifact blocks release.

Tests exercise all 310 methods, mixed batches, unchanged quantities and assignment
identity, dependency order, equipment capacity, one cook, multi-day waits, deferred
tails and exact deterministic regeneration. The original optional/off behavior
and the ordinary cooking execution flow stay independent.
