# Mise project instructions

- Before product, UX, UI, roadmap, or feature work, read `PRODUCT.md` and treat it as the current product contract.
- Keep changes aligned with its target user, core flow, MVP scope, and explicit `Не делаем` list.
- If a requested change expands or conflicts with that contract, point out the conflict before implementing it instead of silently widening the MVP.
- When a product decision changes, update `PRODUCT.md` in the same change so the code and product contract do not drift.
- Before recipe catalog, Recipe Engine, or recipe photo work, read `RECIPE_HANDOFF.md`: it records the frozen decisions, the confirmed engine defects with file references, and which items require owner approval before implementation.
## Validation and publishing

- Treat each completed Mise change as an independently shippable increment: validate it immediately with the relevant tests and publish it to the current Sites release before starting or accumulating another finished change.
- Do not leave a completed product change only in the local checkout unless the user explicitly asks for local-only work.
- Before validating, committing, or publishing, inspect the shared working tree for parallel changes. Preserve and include compatible work, do not overwrite or revert another contributor's files, and stop for coordination if the exact release contents cannot be determined safely.
- Publish only the exact source state that was just validated. After deployment, verify that the current Sites release succeeded before reporting the change complete.
