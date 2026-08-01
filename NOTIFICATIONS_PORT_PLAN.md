# План портирования улучшений и исправлений нотификаций

Ветка: `port-notifications` (сейчас идентична `develop`, коммитов ещё нет).
Источник: форк `intabia-fusion/platform` (remote `intabia`), ветка `develop`.

## 1. Главная находка: cross-workspace индикатор

Функциональность "видно, есть ли непрочитанные нотификации в другом workspace" уже реализована в форке intabia в коммите `2bb6533556` — **"Add crocc-workspace notification marker"** (Kristina Fefelova, апрель 2026). Коммит смешивает две вещи:

1. **Индикатор непрочитанного** в переключателе воркспейсов (`SelectWorkspaceMenu.svelte`) — точка/бейдж на аватарке воркспейса, если там есть непрочитанные inbox-нотификации.
2. **Логотипы воркспейсов** — новая колонка `logo` в таблице `workspace`, RPC `updateWorkspaceLogo`, компонент `WorkspaceLogo.svelte` (аватарка + сам индикатор рисуется тут же оверлеем).

Вы подтвердили: тащим оба куска (индикатор + логотипы), десктопный tray/dock-бейдж — не в этот раз.

### Как это устроено у intabia

- Новый plugin `@intabiafusion/pulse`, класс `WorkspacesNotification extends Doc<PersonSpace>` — документ на аккаунт, поле-мапа `{ [workspaceUuid]: boolean }`.
- Отдельный **долгоживущий сервис** `services/notifications` (не путать с нашим `services/notification`): держит по каждому активному аккаунту одновременные клиентские соединения ко **всем** его воркспейсам, следит за появлением непрочитанных `InboxNotification`, и пушит обновлённый `WorkspacesNotification` в текущую активную сессию пользователя (`services/notifications/src/worker.ts`, `cache.ts`, `workspace.ts` — основная логика, ~400 строк).
- `server/account`: новая колонка `workspace.logo`, RPC `updateWorkspaceLogo`, миграции `v26`/`v27` (у intabia).
- Фронт: `workspacesNotificationStore` в `plugins/workbench-resources/src/workbench.ts`, подписка на pulse-документ, рендер бейджа в `SelectWorkspaceMenu.svelte` через новый `WorkspaceLogo.svelte` (`packages/ui`).
- Десктоп: правки `desktop/src/main/start.ts`, `ui/notifications.ts`, `ui/preload.ts`, `ui/types.ts` — это уже про tray/dock, в наш скоуп не берём.

### Несовместимости с нашим форком (важно, прямой cherry-pick не пройдёт)

| Проблема | Детали |
|---|---|
| Скоуп пакетов | В intabia всё под `@intabiafusion/*`, у нас `@hcengineering/*`. Нужен sed по импортам в каждом файле. |
| Нет `plugins/pulse` / `models/pulse` | Плагин `pulse` (presence/typing/pulse-уведомления) у нас в принципе отсутствует — есть только `foundations/hulypulse` и `packages/hulypulse-client`, это другая подсистема (realtime pub/sub транспорт). Нужно решить: заводить plugin `pulse` с нуля (минимально — только класс `WorkspacesNotification`), либо переиспользовать `hulypulse-client` как транспорт для доставки boolean-флага. Рекомендация — минимальный `pulse`-plugin по образцу intabia, без presence/typing (это отдельная нетронутая функциональность, не относится к задаче). |
| Нет сервиса-аналога `services/notifications` | У нас `services/notification` — это `pod-events-processor` (обработка scheduled-напоминаний в inbox-нотификации) + `pod-notification` (webpush). Ни один не держит live-соединения к нескольким воркспейсам одновременно. Логику из `worker.ts` intabia нужно **переносить как новый под-сервис** (например `services/notification/pod-workspace-notifier`), а не пытаться встроить в `pod-events-processor` — у него другое назначение и жизненный цикл. |
| Коллизия номеров миграций | У нас `getV26Migration`/`getV27Migration` **уже заняты** (`workspace.pending_configuration`, `office` social_id_type — не связаны с логотипами). Миграции intabia под логотип нужно перенести на `v28`/`v29`. Backend в проде — только Postgres, отдельная Mongo-миграция не нужна. |
| Хардкод в диффе | В `SelectWorkspaceMenu.svelte` есть строка `endpoint = 'http://huly.local:8080'` — это локальный дев-хак интабии, **не портировать**, оставить наш способ вычисления `endpoint` из `_endpoint.replace(...)`. |
| Безопасность | `WorkspacesNotification` должен отдавать только boolean-флаг на воркспейс, без контента. Нужно явно проверить права доступа к этому доку (он же лежит в `PersonSpace` — по идее виден только владельцу), и что сервис не может быть использован для энумерации чужих воркспейсов/утечки списка коллег через timing/ошибки. |

### Пошаговый план (индикатор + логотипы)

1. **Подготовка.** Завести plugin `pulse` (или `workspace-notification`) минимально: класс `WorkspacesNotification`, модель в `models/`. Прогнать через наш codegen/model-build, чтобы убедиться, что схема генерируется корректно.
2. **Account-service.** Перенести `workspace.logo` (колонка + типы + `updateWorkspaceLogo` в `AccountDB`/`AccountClient`/RPC-обработчик), миграции переномеровать в `v28`/`v29` (только Postgres — это единственный backend в проде), прогнать миграции локально на тестовой БД.
3. **Новый notifier-сервис + деплой.** Адаптировать `services/notifications/src/{worker,cache,utils,types,workspace}.ts` под наши конвенции (`MeasureContext`, `getClient`/`ClientBundle` как в `pod-events-processor/src/client.ts`, а не самописный клиент intabia). Вынести как отдельный под-сервис (например `services/notification/pod-workspace-notifier`) со своим `package.json`, `Dockerfile`, конфигом (env: URL account-сервиса, лимиты соединений). Деплой-манифест делаем сразу в рамках этого же шага, по образцу `pod-events-processor`/`pod-notification`: добавить в `rush.json`, собрать Docker-образ, завести k8s/docker-compose манифест (Deployment, Service, ресурсы CPU/RAM, переменные окружения, health-check) и подключить в CI/CD пайплайн наравне с остальными notification-подами.
4. **Фронт: стор + UI.** Портировать `workspacesNotificationStore` (`workbench.ts`), `WorkspaceLogo.svelte` (без хардкода эндпоинта), правки `SelectWorkspaceMenu.svelte` и `Logo.svelte`. Settings: кусок из `plugins/setting/src/index.ts` и `General.svelte` (там, похоже, UI загрузки логотипа воркспейса) — перенести целиком вместе с логотипом, раз решили брать оба куска.
5. **Замена импортов.** По всем перенесённым файлам — `@intabiafusion/*` → `@hcengineering/*`, проверить версии зависимостей в `package.json` (`workspace:^0.7.x` и т.п. под наши текущие версии).
6. **Ручное QA.** Два аккаунта/воркспейса, проверить: (а) индикатор загорается при новом непрочитанном в неактивном воркспейсе, (б) гаснет после прочтения, (в) не подтягивает контент чужого воркспейса на фронт, (г) логотип грузится/показывается корректно и fallback на инициалы работает если логотипа нет.
7. **Нагрузочная проверка нового сервиса.** У аккаунта с N воркспейсами сервис держит N живых клиентских соединений — оценить нагрузку на account-service/frontend workspace pods при массовом логине, добавить лимит/дебаунс (в диффе intabia уже есть `scheduleUserNotifyStatusUpdate` — дебаунс перед пушем, сохранить этот паттерн).

## 2. Второй трек: точечные фиксы нотификаций (не связаны с индикатором)

В истории `intabia/develop` нашлось ~30 отдельных коммитов с фиксами/улучшениями нотификаций, которых нет в нашем `develop`. Группирую по темам и риску переноса.

### 2.1 Низкий риск — маленькие точечные фиксы (кандидаты на быстрый cherry-pick)
- `9db0667c3c` — Fix gray dot (индикатор непрочитанного, баг с серой точкой)
- `a37f37f358` — Do not store notification txes (лишняя запись транзакций — perf)
- `f475337671` — Hide notification groups
- `0096aaabed` — Remove avatar loading from push notifications
- `713cb80c9a` — Fix notifications locales
- `0d6169c9cc` — Fix browser name for Edge (в пуш-нотификациях)
- `42c2f2708d` — Fix doc url in notifications
- `da03810af4` — Fix common notification pushes
- `b90ecd98a1` — Push subscription errors for Edge
- `0f64f1cda9` — Fix creating webpush subscription after deleting
- `2b9ec98816` — Fix push notification links
- `844f057b8d` — Fix desktop push translation
- `8b7182d321` — Fix notification translate
- `545279381f` — WebPush menu click bug (undefined error)
- `1f502582ea` — Blocking Subscribe button for web pushes on desktop
- `b578f4d936` — Fix red dots
- `360f67af4a` — Fix inbox selection on delete
- `9d7e395cb6` — Fix todo notification context
- `7cf280694c` — Try to fix thread focus race

**По факту (проверено реальным `git cherry-pick`):** значительная часть этих коммитов ссылается на файлы и целые подсистемы, которых в нашем форке нет вовсе (`services/notifications/*` во множественном числе, `server-plugins/chunter/src/middleware.ts`, `models/notification/src/actions.ts`) — это более ранние наработки intabia, специфичные для их архитектуры, а не универсальные багфиксы. Прямой cherry-pick для таких коммитов даёт конфликты `modify/delete`, а не content-конфликты — переносить их "в лоб" нельзя, нужно каждый смотреть отдельно и переносить точечно только релевантный кусок diff'а (например конкретный CSS/computed-свойство для "красных точек"), а не весь коммит целиком.

### 2.2 Средний риск — фичи/поведение, требуют осознанного ревью
- `44b9828916` — Allow to disable chat badge (новая настройка)
- `115d2b3069` — Allow to mute chat (fusio-106) — **решено переносить**, но сначала product-review (см. ниже)
- `0f0c376d8e` — Allow to disable collaborator notifications
- `19f77c3bfb` — Add message read receipts (fusio-106) — **решено переносить**, но сначала product-review (см. ниже); крупная фича, задевает модель данных
- `5de437b900` — Fix card notifications
- `2a736c0343` — Fix collaborator notifications
- `e64d83f497` — Fix gmail notifications
- `c6aeba2b56` — Fix duplicated directs
- `9d7e395cb6` (уже выше) пересекается с UX инбокса

**Read receipts (`19f77c3bfb`) и mute чата (`115d2b3069`) идут в план, но не как прямой cherry-pick.** Это продуктовые изменения поведения (не просто багфиксы), поэтому перед переносом кода — короткий product-review: подтвердить UX (где именно показывается "прочитано", видно ли отправителю кто прочитал; поведение mute — глушит только badge/бейдж или все виды уведомлений, есть ли per-канал настройка), сверить с нашей текущей моделью нотификаций/чата на предмет конфликтов, и только потом переносить код по той же схеме, что и остальные фичи (перевод импортов, ревью диффа, тесты). Остальные пункты 2.2 — обычные багфиксы, product-review не требуется.

### 2.3 Крупные/рискованные — тащить последними и по одному
- `ca7b00ddc5` — FUSIO-204: Aggregate activity on server (3037+/1224- строк, 64 файла) — переезд агрегации активности на сервер, крупный архитектурный кусок.
- `9cf910bbd5` — "Huly fixes" (238 файлов, 4800+ строк) — это, судя по объёму и названию, слитый апстрим-синк, а не единый фикс. **Не портировать как есть** — вместо этого убедиться, что мы и так синхронизируемся с `upstream/develop` регулярно (см. ветки `sync-upstream-*`), и что нужные куски оттуда уже приходят через обычный upstream-sync.
- `6146ec337c` — Fix space security (696+/36-, 8 файлов) — раз "security" в названии, разобрать отдельно и внимательно, не по шаблону cherry-pick.
- `6055fb0ac3` — FUSIO-786, фикс сборки под Windows (52 файла) — вероятно неактуально/специфично для их CI, проверить нужно ли нам вообще.
- `cc4a885b5e` — FUSIO-220: Attempt to fix sound (595+/99-, 29 файлов) — "Attempt to fix" в названии настораживает, смотреть — доведён ли фикс до стабильного состояния в более поздних коммитах intabia.
- `a506250fcd` — Try to fix windows badge — то же самое, "Try to fix", возможно есть более поздний коммит, который её окончательно чинит — искать по follow-up коммитам перед портированием.
- `071239249e` — Fusio-157: Fix message links (216+/53-, 18 файлов)

## 3. Технический процесс переноса

1. Не сквошить всё в один коммит. Портировать группами 2.1 → 2.2 → 1 (индикатор) → 2.3, каждая группа — отдельный набор коммитов/PR в `port-notifications`, чтобы ревью и откат были посильными.
2. Для каждого коммита: `git show <hash>` → перенести вручную (а не blind cherry-pick) из-за разъехавшихся путей/скоупа пакетов (`@intabiafusion` → `@hcengineering`) и переименованных директорий (`services/notifications` → `services/notification/...`).
3. После каждой группы — `rush build`/`svelte-check`/`lint` для затронутых пакетов, юнит-тесты `server-plugins/notification`, `services/notification/*`.
4. Отдельно прогнать миграции account-service на копии БД перед мёржем (v28/v29).
5. Финальный ручной прогон: два тестовых аккаунта в 2+ воркспейсах, проверка индикатора и что ни один из fix'ов 2.1/2.2 не сломал существующий inbox/push-флоу.

## 4. Принятые решения

- **Backend account-service — только Postgres.** Отдельная Mongo-миграция под `workspace.logo` не нужна, миграции v28/v29 пишем только для Postgres.
- **Read receipts (`19f77c3bfb`) и mute чата (`115d2b3069`) переносим**, но не напрямую: сначала product-review UX/поведения (см. п. 2.2), затем перенос кода по стандартной схеме группы 2.2.
- **Деплой-манифест для нового notifier-сервиса делаем сразу**, в рамках шага 3 основного плана (п. 1), а не откладываем на потом — сервис заводится сразу с Dockerfile, k8s/docker-compose манифестом и подключением в CI/CD.

## 5. Статус реализации (обновляется по ходу работы)

- Ветка `port-notifications` создана, синхронизирована с `develop`.
- Обнаружено техническое ограничение среды: подключённая через FUSE папка изначально блокировала unlink/rename файлов, из-за чего `git commit`/`cherry-pick` падали с `Unable to create index.lock`. Устранено через включение разрешения на удаление файлов для папки — после этого `git` работает в штатном режиме.

### Группа 2.1 — реальные результаты (перепроверено `git cherry-pick` по всем 19 коммитам)

Механический cherry-pick применился чисто только к **1 из 19** коммитов. Остальные 18 дают конфликты — и не потому что фиксы плохие, а потому что за ~6 месяцев форки разошлись сильнее, чем казалось по одному только размеру диффа. Два разных типа конфликтов:

1. **`modify/delete` на несуществующих у нас путях** — `services/notifications/*` (множественное число), `server-plugins/chunter/src/middleware.ts`, `models/notification/src/actions.ts`. Это код архитектуры intabia (их отдельный notifier-сервис, их доработки chunter), которого в нашем форке никогда не было. Задевает: `9db0667c3c`, `42c2f2708d`, `a37f37f358`, `360f67af4a`, `da03810af4`, `9d7e395cb6`, `8b7182d321`.
2. **Реальные текстовые конфликты** из-за независимой эволюции одних и тех же файлов (locale JSON, `utils.ts`, `docker-compose.yaml`) — причём часть этих коммитов (`545279381f`, `1f502582ea`, `0096aaabed`, `0f64f1cda9`, `2b9ec98816`, `b90ecd98a1`, `844f057b8d`, `0d6169c9cc`) целиком завязаны на `WebpushesPreferencesPresenter.svelte` — отдельный экран настроек web-push подписок, которого в нашем форке **нет вообще** (у нас другой набор компонентов: `ProviderPreferences.svelte`, `NotificationGroupSetting.svelte`, `GeneralPreferencesGroup.svelte`). Это не "мелкий фикс", а фикс фичи, которой у нас не существует — переносить бессмысленно, пока не будет самого экрана.

**Что реально запорчено в `port-notifications` на сейчас:**
- `f08d7c0fe5` — `7cf280694c` (thread focus race) — применился чисто через cherry-pick, взят как есть.
- `a46472bf04` — `f475337671` (Hide notification groups) — перенесён вручную (не cherry-pick): взята суть фикса (скрывать группу нотификаций, если она отключена через `isDisabled()`) и применена к нашей текущей версии `NotificationSettings.svelte`, которая успела разойтись со состоянием intabia на момент их коммита.

**Вывод по группе 2.1:** список в п. 2.1 плана надо пересмотреть — реально портируемых "как есть" там мало. Уточнённая классификация:
- Не портируемы без переноса всего webpush-экрана настроек (фактически отдельная фича, а не фикс): `545279381f`, `1f502582ea`, `0096aaabed`, `0f64f1cda9`, `2b9ec98816`, `b90ecd98a1`, `844f057b8d`, `0d6169c9cc`.
- Не портируемы без переноса notifier-сервиса `services/notifications` (см. главную фичу, п.1): `9db0667c3c`, `42c2f2708d`, `a37f37f358`, `360f67af4a`, `da03810af4`, `9d7e395cb6`, `8b7182d321`.
- Перенесены: `7cf280694c`, `f475337671`.
- Осталась непроверенной: `713cb80c9a` (Fix notifications locales) — при разборе оказалось, что коммит вместе с опечаткой тащит строки локализации для ещё не перенесённых фич (mute чата, collaborators) — переносить стоит только вместе с этими фичами, отдельно смысла нет.

Практический вывод: **для группы 2.1 подход "взять список коммитов и прогнать cherry-pick" не работает** — каждый оставшийся фикс нужно разбирать вручную (смотреть реальный диф, проверять применим ли он к нашей текущей структуре, переносить только применимую суть). Это медленнее, чем казалось на этапе планирования, и правильнее делать по одному фиксу за подход, а не пакетом.

### Экран настроек Web Push подписок — портирован (e0015b2219)

По запросу разобрали блокер из п.1 выше: добавили `WebpushesPreferencesPresenter.svelte` — список подписок пользователя (браузер/устройство через `parseUserAgent`, переключатель enable/disable на подписку, кнопка "Отписаться" с подтверждением, отметка текущего устройства) и кнопку "Subscribe" с уже существующим `subscribePush()`. Кодовая опора почти вся уже была в нашем форке (`PushSubscription`, `PushPublicKey`, `subscribePush`, `desktopPlatform`, паттерн `NotificationProvider.presenter` + `ProviderPreferences.svelte`) — не хватало только самого экрана, класса `PushSubscriptionSetting` (per-device toggle) и `parseUserAgent`. Всё добавлено и подключено (`plugins/notification`, `models/notification`, `notification-resources/utils.ts`, `notification-resources/index.ts`, en/ru локали).

Отличие от версии intabia: наш `subscribePush()` возвращает `boolean`, а не детализированный union ошибок (permission_denied/network/not_supported/...), поэтому при неудачной подписке показываем одно общее сообщение `PushSubscribeError` вместо разных текстов на разные причины. Это можно доуточнить позже, расширив `subscribePush()`.

Проверено: `tsc --noEmit` чисто для `plugins/notification`, `models/notification`, `notification-resources/src` (остаются только несвязанные, ранее существовавшие ошибки в пакете `presentation`). Полный `svelte-check` по компоненту в этой сессии прогнать не удалось — на этом монорепо он не укладывается в доступный лимit времени команды; рекомендуется прогнать перед мёржем.

Это разблокировало (частично — экран теперь есть, но сами точечные диффы всё ещё нужно разобрать по одному) 8 фиксов: `545279381f`, `1f502582ea`, `0096aaabed`, `0f64f1cda9`, `2b9ec98816`, `b90ecd98a1`, `844f057b8d`, `0d6169c9cc`.

### services/notifications — решили НЕ мигрировать целиком

При ближайшем рассмотрении `services/notifications` у intabia оказался не вспомогательным сервисом, а **полной заменой генерации нотификаций**: ~3200 строк, дублирующих логику нашего `server-plugins/notification-resources` (2834 строки), но вынесенных из транзактора в отдельный процесс со своим pipeline, кэшем модели и REST-клиентами к воркспейсам. Перенос "как есть" — это миграция архитектуры генерации нотификаций для всей платформы, с риском рассинхронизации/дублирования нотификаций, если старые in-process триггеры не выключить одновременно. Решение: **не поднимать новый сервис**, а точечно переносить логику 7 фиксов, которые на него ссылались, прямо в существующие in-process триггеры — тем же способом, что и остальные фиксы группы 2.1.

Разобрано:
- `a37f37f358` (Do not store notification txes) — **N/A**. Фикс специфичен для их REST-based tx-apply клиента (`TxFactory(..., true)` + `core.space.DerivedTx`), которого у нас нет — наши in-process триггеры и так не имеют этой проблемы.
- `9db0667c3c` (Fix gray dot) — **N/A в текущем виде**. Реальный фикс — в `inboxNotificationsClient.ts`/`chunter-resources/utils.ts` (не в services/notifications, тот конфликт в коммите был от постороннего изменения), но опирается на поле `context.lastUpdate`, которого нет в нашей модели `DocNotifyContext` (у нас `lastViewedTimestamp`/`lastUpdateTimestamp` в другой структуре). Нужен отдельный разбор при желании перенести именно этот баг.
- `360f67af4a` (Fix inbox selection on delete) — **перенесено адаптированно** (см. коммит `769ca1a531`): взята идея (стабильный индекс подсветки вместо мгновенно "теряющегося" `findIndex`), применена поверх нашей логики архивирования (`archiveContext`), а не заменой на "clear"-семантику intabia.
- `42c2f2708d` (Fix doc url in notifications) — **N/A**. У нас другая, более развитая реализация ссылок в нотификациях (`getNotificationLink` в `server-plugins/notification-resources/src/utils.ts`) — она уже строит ссылку с учётом сообщения/треда через encode-провайдеры. Проблема, которую чинил intabia (URL без привязки к конкретному сообщению), у нас не воспроизводится.
- `da03810af4` (Fix common notification pushes) — **частично применимо, реальный баг найден и исправлен** (коммит `5a7483b041`). Большая часть коммита — переименование `props`→`intlParams` в export/github/calendar-mailer, которое для нас не нужно: наш `commonInboxNotificationToText()` уже мержит `.props` наравне с `.intlParams`, так что пуши там и так работали. Но по пути нашёлся реальный баг в `server-plugins/love-resources`: уведомление о приглашении на созвон собиралось с `props: { name: '' }` — пустая строка затирала имя пригласившего в шаблоне `"{name} is asking you to join"`. Поправлено на реальное имя через `formatName(senderInfo.person.name, ...)`.
- `9d7e395cb6` (Fix todo notification context) — **N/A, нужна отдельная фича**. Добавляет новое поле `attachToParent` на `NotificationType`, но потребитель этого поля живёт в `services/notifications/src/workspace.ts` (которую не переносим). У нас нет ни поля, ни потребляющей логики — просто добавить поле без логики ничего не даст. Если баг (todo-уведомления не группируются с родительским документом) воспроизводится у нас, для него нужен отдельный разбор нашей триггерной логики в `server-plugins/notification-resources`.
- `8b7182d321` (Fix notification translate) — **применимо, перенесено с тестами** (коммит `c42ffa1c5c`). Реальный баг оказался не в notification-специфичном коде, а в базовой функции `translate`/`translateCB` (`foundations/core/packages/platform/src/i18n.ts`, используется всей платформой): ошибка форматирования уже скомпилированного сообщения (например нехватка параметра в конкретном вызове) кэшировалась как перманентный отказ для всего сообщения, ломая все последующие вызовы с этим же сообщением, даже с корректными параметрами. Разделили обработку ошибок компиляции (кэшируем как раньше) и ошибок форматирования (не кэшируем, просто возвращаем raw message на этот вызов). Перенесены оба регрессионных теста из коммита intabia, полный набор тестов пакета (31 тест) проходит.

### 8 webpush-фиксов поверх нового экрана — разобрано

Поскольку экран `WebpushesPreferencesPresenter.svelte` был написан сразу с финального состояния intabia (а не по цепочке патчей), большинство точечных фиксов оказались уже включены в него:

- `545279381f`, `1f502582ea` — **уже покрыты** исходной версией экрана (disabledReason/buttonDisabled, проверка `desktopPlatform`, guard на `sub.name === undefined`).
- `0f64f1cda9` — UI-часть (guard на удаление, `subscribing`-лоадер) уже была в экране. Но там же нашёлся отдельный, более общий баг в `packages/ui/src/tooltips.ts`: реактивное обновление опций тултипа не работало, если тултип стартовал без контента (ровно наш случай — `disabledReason` часто `undefined`). **Перенесено** (коммит `d5fd09b6c0`) — общий фикс, не завязанный на webpush.
- `b90ecd98a1` (Push subscription errors for Edge) — **перенесено** (коммит `d5fd09b6c0`, туда же случайно попал из-за моей ошибки со скриптом при коммите, но по содержанию это отдельная тема): `Notification.requestPermission()` явным вызовом перед `subscribe()` (Edge не спрашивает разрешение неявно), плюс `subscribePush()` расширен с `boolean` до `'success' | 'permission_denied' | 'network_error' | 'not_supported'` — экран настроек теперь показывает причину отказа, а не одно общее сообщение (снимает ограничение, отмеченное как TODO в исходном коммите экрана).
- `2b9ec98816` (Fix push notifications links) — **частично перенесено** (коммит `fa88230814`): серверная часть (`server-plugins/notification-resources/src/push.ts`) — пуш-уведомления на ответы в тредах раньше вели на нерабочую страницу (ссылка строилась из `objectId`/`objectClass` самого треда, а не документа, к которому тред прикреплён). Десктопная часть (Electron IPC, `desktop/src/ui/notifications.ts`) с тем же багом — не перенесена, оставлена на отдельный заход.
- `0096aaabed` (Remove avatar loading from push notifications) — **пропущено осознанно**. Это не багфикс, а полное удаление фичи (аватар отправителя как иконка пуша) без обоснования в коммите. У нас эта фича работает и используется — убирать её без понимания, зачем это сделали (перф? нестабильность на каком-то браузере?), не стал.
- `844f057b8d` (Fix desktop push translation) — **N/A**. Баг был в том, что общая функция генерации контента обрезала title/body под лимиты пуша и это задевало и десктop-нотификации. У нас обрезка `title` уже локальная, только в `push.ts` на моменте отправки пуша, остальные места это не задевает — bug не воспроизводится.
- `0d6169c9cc` (Fixing browser name for Edge) — **N/A**. Правит функцию `parseUserAgent`, которой у нас не было до этой сессии; я написал `parseUserAgent` сразу в уже-исправленном (финальном) виде при переносе экрана, так что правка не нужна отдельно.
