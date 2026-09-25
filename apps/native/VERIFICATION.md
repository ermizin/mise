# Native iOS — проверка кандидата

Дата: 2026-09-25. Интеграционная ветка: `codex/native-app-current-20260925`; база: актуальный web-release `9933dd933a9ee149d4aa85f471b19fe983a7bce8`.

## Границы подтверждения

- Это локальный кандидат, интегрированный на актуальную базу, но ещё не отправленный в GitHub, TestFlight или App Store.
- Simulator functional/visual QA не выполняется по выбору владельца. Владелец проверит интерфейс и полный цикл на настоящем iPhone.
- На момент проверки подключённый iPhone и действительные signing identities отсутствовали. Подпись, установка на устройство, TestFlight и App Store не подтверждены.
- Отсутствие сети проверено для детерминированной генерации из встроенных данных автоматическими тестами. Авиарежим, холодный старт приложения, iOS SQLite/Keychain и доставка уведомлений требуют device QA.
- До внешней тестовой раздачи нужна опубликованная политика конфиденциальности. План синхронизации содержит имена, цели КБЖУ, параметры расчёта, нелюбимые продукты и жёсткие исключения; UUID клиента в Keychain используется как идентификатор доступа к его плану.

## Воспроизводимость

Финальные статические проверки кандидата: root TypeScript и native TypeScript — PASS; ESLint — PASS; production web build — PASS; 431 root-тест и 13 native-тестов — PASS; `git diff --check` — PASS. Native-тесты проверяют генерацию из встроенного каталога, кухонную утварь, жёсткие исключения, неполное обновление каталога, запоздалые GET/POST и одновременные локальные изменения. Они не заменяют запуск SQLite и UI на iPhone.

- `pnpm install --frozen-lockfile --offline` проходит с локальным кешем; это не обещание чистой установки зависимостей без предварительного кеша.
- Встроенный каталог и карта локальных фото регенерируются `pnpm mobile:catalog:refresh`; в кандидате 250 рецептов, каталог schema 3, mobile payload schema 2, все 250 локальных фото совпадают по SHA-256. Из них 25 изображений обозначены как созданные для Mise.
- Все новые планы сохраняют выбранную утварь и используют только исполнимый исходный способ рецепта. Отдельного выбора «обычный / мультиварка / аэрогриль» в новом flow нет.
- Иконка генерируется из `scripts/generate-app-icons.swift --native`; тест проверяет побайтовое совпадение и непрозрачный PNG 1024×1024.
- Патчи Expo Constants, Expo Modules JSI и React Native зафиксированы через `pnpm patchedDependencies`, а не только в установленном `node_modules`.
- Config plugin исправляет кавычки финального bundle-скрипта при генерации Xcode-проекта; prebuild и CocoaPods после его подключения прошли.
- `ios/`, Pods, DerivedData, временные экспорты и логи не входят в Git. Xcode-проект восстанавливается через Expo prebuild.

## Команда сборки для iPhone без подписи

Результат: **BUILD SUCCEEDED**, exit 0, Xcode 26.3 (17C529), macOS 15.8. Получен Mach-O arm64 `Mise.app`, bundle ID `ru.ermizin.mise`, около 148 МБ, по пути `/private/tmp/mise-native-current-device-derived/Build/Products/Release-iphoneos/Mise.app`. Встроенный `main.jsbundle` присутствует; SHA-256: `401177e1cdbc43249ac329a0d59c0fec78d761d648a262b53fb490fb97ed775d`. Все 250 ожидаемых фотографий найдены внутри `.app` и совпадают с каталогом по SHA-256.

Из `apps/native/ios`:

```sh
xcodebuild -workspace Mise.xcworkspace -scheme Mise -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath /private/tmp/mise-native-current-device-derived \
  CODE_SIGNING_ALLOWED=NO -jobs 3 build
```

Успех этой команды не означает наличие устанавливаемого подписанного IPA. Для устройства нужна выбранная Team и provisioning в Xcode; для TestFlight также нужен App Store Connect record.
