# Mise — instructions for Claude Code

Before changing Mise, read `AGENTS.md` and `PRODUCT.md` completely. Treat
`PRODUCT.md` as the product contract. Before recipe catalog, Recipe Engine, or
recipe-photo work, also read `RECIPE_HANDOFF.md`.

When the user explicitly asks to publish or deploy to production, use the
project skill `/deploy-prod`. Do not interpret requests to explain, configure,
or teach deployment as authorization to publish.

Never claim a production release from a successful local build or Git push.
A release is complete only after Sites reports a successful production
deployment and `https://mise.ermizinm.ru` passes the production smoke checks.
