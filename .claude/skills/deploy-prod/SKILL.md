---
name: deploy-prod
description: Safely validate and publish Mise to the current public Sites production release. Use when the user clearly asks to deploy, publish, release, or ship Mise to production. Do not invoke for explanations or setup-only requests.
argument-hint: "[dry-run]"
---

# Deploy Mise to production

If `$ARGUMENTS` contains `dry-run`, inspect and report readiness only. Do not
commit, push, save a Sites version, or deploy.

## Authority gate

- A request to explain, configure, or teach deployment is not permission to
  deploy. Production actions require an explicit deploy/publish request in the
  current user turn.
- The current production site is public. Before the final deployment call,
  state that the release will update the public site and obtain explicit
  confirmation unless the current user message already unambiguously asks to
  deploy the ready state to the existing public production site.

## Read the project contract

Read `AGENTS.md` and `PRODUCT.md` completely. For recipe catalog, Recipe Engine,
or recipe-photo changes, also read `RECIPE_HANDOFF.md`.

## Resolve the exact release contents

1. Read `.openai/hosting.json`; reuse its existing `project_id`.
2. Inspect the branch, HEAD, `git status --short --branch`, complete diff, and
   recent history. Check for merge-conflict markers.
3. Treat existing uncommitted or untracked files as another contributor's work
   until their ownership and compatibility are clear. Never discard, overwrite,
   or silently include unrelated changes.
4. Stop for coordination if the exact release contents cannot be identified.
   Never deploy a partial worktree, conflicted branch, stale build, or a source
   state different from the one validated below.

## Validate the exact source

Use the repository's pnpm workflow and Node.js `>=22.13.0`.

1. Install only when needed with `pnpm install --frozen-lockfile`.
2. Run relevant focused tests while developing.
3. Immediately before release, run `pnpm run lint` and `pnpm test`. The latter
   performs the production build and the full Node test suite.
4. Any failure blocks release. Fix it, then rerun the complete checks.
5. After validation, do not edit product source before packaging. If source
   changes, restart validation.

## Publish through Sites

Do not ask for or store a permanent Sites username, password, access token, or
credential in Git, `.mcp.json`, Claude settings, environment files, or remotes.
The Sites source repository uses a short-lived write credential issued for each
release.

Required Sites capabilities are: get the site and its access policy, create a
source-repository write credential, save a version, deploy a version, and read
deployment status.

If those Sites capabilities are unavailable in the current Claude session:

1. Do not run an interactive `git push` and do not ask the user for a password.
2. Finish the validation and report the exact ready commit SHA.
3. Say that Claude lacks the Sites connector needed to obtain the short-lived
   credential and complete the publish. Do not claim production is updated.

If the Sites capabilities are available:

1. Read the current Site and access policy. Reuse the configured project; never
   create a second Site.
2. Commit only the exact validated source state.
3. Obtain a fresh source-repository write credential. Push the configured source
   branch using the credential only for that command; never embed it in the
   remote URL or save it in Git configuration.
4. Confirm that the pushed branch-head SHA exactly matches the validated HEAD.
5. Package the successful `dist/` build, `.openai/hosting.json`, and generated
   migrations. Never package the source tree as the deployment archive.
6. Save one Sites version using the matching commit SHA and archive.
7. Deploy that saved version to the existing public production release.
8. Poll deployment status until it is `succeeded` or `failed`. A saved version,
   push, or non-terminal deployment is not a release.

## Verify production

After Sites reports `succeeded`:

1. Open `https://mise.ermizinm.ru` and require a successful response.
2. Smoke-check the changed user flow. For API checks, remember that `/api/plans`
   requires a valid UUID in `X-Mise-Client`.
3. If production verification fails, report the failed observation and do not
   call the release complete.

Report the production URL, successful deployment status, released commit SHA,
checks run, and smoke-check result. Never print credentials or secret values.
