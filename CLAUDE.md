# Mise — инструкции для Claude Code

Перед изменениями полностью прочитай `AGENTS.md` и `PRODUCT.md`; для каталога, Recipe Engine и фото — ещё `RECIPE_HANDOFF.md`. `PRODUCT.md` имеет приоритет над макетами, аудитами и backlog.

Публикация требует явного запроса владельца в текущем сообщении. Используй `/deploy-prod`; единственный production-таргет — VPS на `https://mise.ermizinm.ru`, не Sites. Локальная сборка, Git push, архив или запущенный service сами по себе не доказывают релиз: нужны exact-HEAD validation, активный `/opt/mise/current`, health origin и публичный smoke-check.
