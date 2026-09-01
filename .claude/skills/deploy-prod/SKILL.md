---
name: deploy-prod
description: Safely validate and publish Mise to its public VPS. Use only when the user explicitly asks to deploy, publish, release, or ship Mise to production.
argument-hint: "[dry-run]"
---

# Deploy Mise to production

`dry-run` means readiness inspection only: do not commit, push, upload, change the VPS, restart services or publish.

## Authority

- Explanation, setup, diagnosis and local QA do not authorize production changes.
- An unambiguous request to deploy the ready state to the existing public Mise is sufficient authority; otherwise ask immediately before the first production mutation.
- The only production target is the VPS serving `https://mise.ermizinm.ru`. Do not use Sites unless the user separately requests a Sites deployment.

## Read the contract

Read `AGENTS.md` and `PRODUCT.md` completely. For recipe catalog, Recipe Engine or recipe-photo changes, also read `RECIPE_HANDOFF.md`.

## Resolve the exact release

1. Inspect branch, full HEAD, upstream, `git status --short --branch`, worktrees, complete diff and recent history. Check conflict markers.
2. Treat pre-existing changes and untracked files as another contributor's work. Never hide, discard or silently include them.
3. Confirm the intended source contains every compatible approved change and is not behind its integration base. Stop for coordination if the release contents are ambiguous.
4. Confirm a known-good previous release and a verified database backup path before mutation.

## Validate

Use Node.js `>=22.13.0` and the repository's `pnpm` workflow.

1. Install only when needed with `pnpm install --frozen-lockfile`.
2. Run focused checks while developing.
3. Commit the exact source, then run `pnpm run lint` and `pnpm test`. `pnpm test` performs the production build and full Node suite.
4. Any failure blocks release. After any source edit, rerun complete validation.
5. Confirm generated recipe data is deterministic when it changed.

## Package

Create the artifact only with:

```bash
bash scripts/package-vps-release.sh /private/tmp/mise-vps-<full-sha>.tar.gz
```

The packager must report the same full HEAD and reject tracked changes, missing `dist`, AppleDouble files and `.DS_Store`. Record its SHA-256. Do not assemble a production archive with a raw macOS `tar` command.

## Install on the VPS

1. Recheck backup and rollback readiness. Do not print or persist credentials.
2. Upload the verified archive to a temporary path and verify its checksum on the VPS.
3. Extract it into a new `/opt/mise/releases/<full-sha>` directory. Never edit the active release in place.
4. Normalize extracted release ownership to `root:root`. Create both `.wrangler` and `dist/server/.wrangler/tmp` as writable `mise:mise` directories.
5. If the release changes schema, apply migrations through the generated `dist/server/wrangler.json`; ordinary `vinext start` is not a valid substitute for the Wrangler-compatible runtime.
6. Atomically switch `/opt/mise/current`, restart `mise.service` and retain the previous release directory and target for rollback.
7. If restart or verification fails, restore the previous symlink and service before further diagnosis.

## Verify production

Check separately:

- `/opt/mise/current` resolves to the intended full SHA;
- `mise.service` is active and its recent logs contain no startup failure;
- origin responds on `127.0.0.1:3100`;
- external HTTPS at `https://mise.ermizinm.ru` succeeds;
- the changed user flow works in a real browser with no console errors;
- relevant API calls succeed; `/api/plans` requires a valid UUID in `X-Mise-Client`.

A successful build, upload, restart, origin `200` or old Sites deployment is not enough on its own. Report the released SHA, artifact checksum, backup/rollback state, checks, active service/release and public smoke result. Keep unresolved DNS, Caddy, D1, push or backup issues explicit.
