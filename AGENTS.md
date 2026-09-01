# Mise project instructions

- Before product, UX, UI, roadmap, or feature work, read `PRODUCT.md` and treat it as the current product contract.
- Keep changes aligned with its target user, core flow, MVP scope, and explicit `Не делаем` list.
- If a requested change expands or conflicts with that contract, point out the conflict before implementing it instead of silently widening the MVP.
- When a product decision changes, update `PRODUCT.md` in the same change so the code and product contract do not drift.
- Before recipe catalog, Recipe Engine, or recipe photo work, read `RECIPE_HANDOFF.md`: it records the frozen decisions, the confirmed engine defects with file references, and which items require owner approval before implementation.
## Validation and publishing

- The only production publication target for Mise is the VPS serving `https://mise.ermizinm.ru`. Do not publish or deploy a Mise release through Sites unless the user explicitly asks for a separate Sites deployment; a saved or deployed Sites version is not the public Mise release.
- Install the exact validated production artifact into a new `/opt/mise/releases/<full-sha>` directory on the VPS, normalize extracted release ownership to `root:root`, then create both writable `.wrangler` and `dist/server/.wrangler/tmp` directories with `mise:mise` ownership. Retain the previous release for rollback, atomically switch `/opt/mise/current`, restart `mise.service`, and verify the real public domain before declaring release success.
- Build VPS archives only with `bash scripts/package-vps-release.sh <output.tar.gz>`. The packager must omit macOS AppleDouble (`._*`) and `.DS_Store` files and fail before upload if either appears in the archive; do not assemble production archives with a raw macOS `tar` command.
- Treat each completed Mise change as an independently shippable increment: validate it immediately with the relevant tests and publish it to the current VPS release before starting or accumulating another finished change.
- Do not leave a completed product change only in the local checkout unless the user explicitly asks for local-only work.
- Before validating, committing, or publishing, inspect the shared working tree for parallel changes. Preserve and include compatible work, do not overwrite or revert another contributor's files, and stop for coordination if the exact release contents cannot be determined safely.
- Publish only the exact source state that was just validated. After deployment, verify the active VPS release, service health, origin, and real public domain before reporting the change complete.

## Git hygiene for all contributors

- The primary agent in the designated Git-coordination thread is the sole Git integration owner for the project. Every contributor and subagent must contact that coordinator when their task ends, including when the task is blocked, cancelled, or completed without code changes; do not treat a user-facing final reply as a substitute for this handoff.
- The designated coordinator is the pinned Codex task `Git менеджер`, thread `01a05869-c331-7950-9ceb-be18337f9e7a`. At task completion, send the handoff directly to that task with the Codex thread messaging tool before giving the contributor's final reply. If thread messaging is temporarily unavailable, state that the handoff is still pending and retry; do not silently finish without delivery.
- The mandatory completion handoff must state: task outcome; branch and worktree path; exact `HEAD`; `git status --short --branch`; files changed; commits created; checks run and their results; remaining uncommitted or untracked files; known dependencies/conflicts; and the recommended integration or release action. Explicitly say when any item is `none` or was not run.
- Contributors may create scoped commits on their own task branches, but must not merge, rebase, cherry-pick into an integration/release branch, push an integration/release branch, publish, deploy, remove worktrees, or delete branches unless the Git coordinator explicitly delegates that exact action. At completion, stop after the handoff and wait for the coordinator's integration decision.
- The Git coordinator inventories all active work and handoffs, decides integration order, verifies the exact combined source state, performs or explicitly delegates Git integration and cleanup, and is the only agent that may declare work integrated or released.
- Treat the main checkout as shared. Before writing, committing, integrating, or publishing, inspect `git status --short --branch` and `git worktree list`; assume every pre-existing change belongs to another contributor until proven otherwise.
- Use one branch and preferably one dedicated worktree per task. Do not start new work in a dirty checkout containing unrelated changes. If the intended base or ownership is unclear, stop and coordinate instead of mixing batches.
- Never discard or hide another contributor's work with `git reset`, `git restore`, `git checkout --`, `git clean`, or `git stash`. Never force-push. Do not pull, merge, or rebase a dirty shared checkout.
- Never stage with `git add .`, `git add -A`, or an equivalent broad command. Stage explicit paths, inspect `git diff --cached --stat` and `git diff --cached`, and commit one coherent product increment at a time.
- Classify every new path before staging: source, required generated artifact, durable documentation, or local evidence. Keep logs, traces, screenshots, browser/MCP output, build caches, local credentials/config, and recovery snapshots out of Git using the existing ignored locations.
- Generated runtime data must be committed together with its source/generator and the test that proves regeneration is deterministic. Large binary assets require their manifest, checksum/provenance validation, and an explicit release-rights decision.
- A branch that is behind its intended upstream is not a safe release base. Integrate in a clean worktree, resolve conflicts there, rerun all required checks on the exact resulting HEAD, and publish only that validated state with current explicit user authorization.
- After a task is integrated, remove its temporary worktree and prune only stale worktree metadata. Keep still-useful branches until their work is confirmed merged or intentionally archived.
