# PR #15 — Шаги верификации

**PR:** Add guest meeting support and improve LiveKit integration
**Ветка:** `claude/port-office-video-calls-bxcud8` → `develop`
**Объём:** 161 файл, +12281 / −2339, 54 коммита

Ключевые функциональные блоки, которые нужно проверить:
1. Backend-сервис `love` (webhook, polling, recordings, guests)
2. Гостевые митинги (guest flow)
3. Рефакторинг системы приглашений (invites)
4. Состояния записи / транскрипции + presenters
5. Детекция «говорю в мьюте» (speaking-while-muted)
6. Screen sharing / UI улучшения
7. Login base app
8. Регрессии (удалён `joinRequests`, `MeetingMinutes` вместо `Room`)
9. Локализация, миграции

---

## 0. Предусловия / окружение

### 0.1 Поднять LiveKit dev-сервер
```bash
# Установить livekit-server: https://docs.livekit.io/home/self-hosting/local/
./dev/run_livekit.sh
```
Проверить в логах:
- Server port `7880`, RTC UDP `7882`, TCP `7881`
- Webhook URL (в конфиге `dev/livekit-dev-config.yaml`): `http://127.0.0.1:8096/webhook`
- API keys: `devkey/secret`, `whkey/whsecret`
- Запущен Redis на `127.0.0.1:6379`

### 0.2 Переменные окружения сервиса `love` (services/love/src/config.ts)
Обязательные (сервис падает с `Missing env variables`, если не заданы):
`ACCOUNTS_URL`, `PORT` (по умолчанию `8096`), `LIVEKIT_PROJECT`, `LIVEKIT_HOST`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `SECRET`, `SERVICE_ID`.

Новые / важные для этого PR:
- `LIVEKIT_WEBHOOK_API_KEY`, `LIVEKIT_WEBHOOK_API_SECRET` — совпадают с `whkey/whsecret`
- `WEBHOOK_URL`, `USE_EGRESS_WEBHOOK`
- `POLLING_INTERVAL_MS` (по умолчанию `30000`)
- `RECORDING_PRESET` (по умолчанию `720p`)
- `S3_STORAGE_CONFIG` / `STORAGE_CONFIG` — для проверки записи

**Проверка:** запустить сервис без одной из обязательных переменных → должно упасть
с понятным сообщением `Missing env variables: ...`. Затем запустить со всеми →
сервис слушает порт `8096`.

---

## 1. Статическая проверка / сборка

Согласно `AGENTS.md`, для каждого изменённого пакета:
```bash
# НЕ запускать format/lint автоматически и НЕ параллельно (может повредить файлы)
cd <package> && rushx build && rushx _phase:validate
```
Минимальный набор пакетов, обязательных к проверке:
```bash
cd plugins/love-resources   && rushx build && rushx _phase:validate
cd plugins/love             && rushx build && rushx _phase:validate
cd models/love              && rushx build && rushx _phase:validate
cd server-plugins/love-resources && rushx build && rushx _phase:validate
cd services/love            && rushx build && rushx _phase:validate
cd plugins/login-resources  && rushx build && rushx _phase:validate
cd foundations/server/packages/middleware && rushx build && rushx _phase:validate
cd foundations/core/packages/api-client   && rushx build && rushx _phase:validate
```
**Критерий:** все сборки зелёные, `diagnostics` без ошибок TS/Svelte.

Пересобрать Docker-образы для изменённых сервисов и перезапустить контейнеры:
```bash
rush docker:build --to @hcengineering/love
rush docker:build --to @hcengineering/pod-ai-bot   # менялся services/ai-bot/*
docker compose -f dev/docker-compose.yaml restart love aibot love-agent
```
UI через `rush dev` перезапускать не нужно.

---

## 2. Backend love-сервис

### 2.1 Webhook (`services/love/src/webhook.ts`)
- [ ] LiveKit отправляет событие `participant_joined` → в логах love виден приём,
      подпись верифицируется по `LIVEKIT_WEBHOOK_API_SECRET`.
- [ ] `participant_left` → `ParticipantInfo` корректно снимается.
- [ ] `egress_ended` / завершение записи → обрабатывается (см. п.4).
- [ ] `convertBigIntToString`: событие с BigInt-полями сериализуется без ошибок.
- [ ] Фильтрация по project key в metadata комнаты: событие чужого проекта игнорируется.
- [ ] Неверная подпись webhook → запрос отклоняется (401/403), не создаёт побочных эффектов.

### 2.2 Polling (`services/love/src/polling.ts`)
- [ ] С интервалом `POLLING_INTERVAL_MS` сервис опрашивает состояние комнат LiveKit.
- [ ] Рассинхрон (участник ушёл, но webhook потерян) устраняется поллингом —
      «зависший» участник исчезает из списка в течение одного интервала.
- [ ] Остановка сервиса корректно завершает polling-таймеры (нет утечек/повторных запусков).

### 2.3 Recordings (`services/love/src/recordings.ts`)
- [ ] Старт записи в митинге → egress запускается с пресетом `RECORDING_PRESET`.
- [ ] Проверить хотя бы два формата вывода (например MP4 и WebM).
- [ ] По завершении файл загружается в S3 (`S3_STORAGE_CONFIG`), ссылка/статус
      записывается в `MeetingMinutes`.
- [ ] `PendingRecordingPresenter` показывает запись «в процессе», затем — готовую.

### 2.4 Guests (`services/love/src/guests.ts`, `utils.ts`)
- [ ] Эндпоинт `/guestJoin` (`/guestInfo`) обменивает `guestToken` на доступ.
- [ ] `getWorkspaceId` возвращает `undefined` для токенов с `guest=true` или
      `readonly=true` (проверка в `server-plugins/love-resources/src/index.ts`).
- [ ] Гостевой токен создаётся без системного аккаунта (identity в LiveKit metadata).

---

## 3. Гостевые митинги (frontend guest flow)

### 3.1 Генерация ссылки
- [ ] Создать Event с привязанной комнатой → в `event.location` появляется гостевая
      ссылка (`inviteId` + `navigateUrl` с `meetId`), сгенерированная через
      `login.function.GetInviteLink`.

### 3.2 Вход гостя (`GuestMeetingApp.svelte`)
- [ ] Открыть гостевую ссылку в **приватном окне** (без авторизации).
- [ ] Query-параметры `meetingId` и `guestToken` разбираются, гость верифицируется
      через `/guestInfo`, при успехе — навигация в митинг.
- [ ] Экран стилизован под LoginApp.
- [ ] Если авто-присоединение не удалось → показывается `GuestJoinPopup.svelte`
      с запросом имени.

### 3.3 Внутри митинга как гость
- [ ] `GuestControlBar` — упрощённая панель (mic/camera/leave, без лишних действий).
- [ ] `GuestParticipantView` / `GuestParticipantsListView` показывают участников
      только из данных LiveKit (без обращения к системным аккаунтам).
- [ ] Гость видит и слышит других; авторизованные видят гостя с его именем.
- [ ] Несколько подключений одного человека отображаются корректно.

---

## 4. Система приглашений (invites refactor)

Единый класс `UserMeetingInvite` с полем `kind` (`invite-request` / `invite-response`).

- [ ] **Отправка:** пользователь A вызывает приглашение (`InviteButton` /
      `InviteEmployeeButton`) → создаётся `invite-request` в space A, серверный
      триггер `OnUserMeetingInvite` создаёт `invite-response` в space B.
- [ ] **Получение:** у B всплывает `IncomingInvitePopup.svelte`; у A —
      `OutgoingInvitePopup.svelte` со статусом.
- [ ] **Accept (нет активного митинга):** создаётся митинг в офисе получателя,
      `invite-response.meetingId` заполнен, `status = 'accepted'`, статус
      синхронизируется в `invite-request`.
- [ ] **Accept (приглашение в текущий митинг):** B добавляется в `collaborators`
      существующего митинга, нового митинга не создаётся.
- [ ] **Decline:** `status = 'declined'`, у отправителя видно отклонение.
- [ ] Нотификация о приглашении приходит через `CommonInboxNotification`
      (проверить inbox).
- [ ] `InvitesExt.svelte` корректно рендерит список приглашений.

### Регрессия удалённого кода
- [ ] `joinRequests.ts`, `JoinRequestPopup`, `JoinResponsePopup`,
      `InviteRequestPopup`, `InviteResponsePopup` удалены — убедиться, что нигде
      нет битых импортов/ссылок и старые попапы не всплывают.

---

## 5. Состояния записи и транскрипции

- [ ] Enum `RecordingState` / `TranscriptionState` отражаются в UI.
- [ ] `MeetingMinutesRecordingStatePresenter` и
      `MeetingMinutesTranscriptionStatePresenter` показывают актуальное состояние.
- [ ] `RecordingButton` / `TranscriptionButton` переключают состояние и оно
      сохраняется в `MeetingMinutes`.
- [ ] `MeetingMinutesStatusPresenter` отражает статус митинга.

---

## 6. Speaking-while-muted

- [ ] Включить митинг, замьютить микрофон, начать говорить →
      `SpeakingWhileMutedIndicator.svelte` показывает подсказку.
- [ ] Логика в `speakingWhileMuted.ts` использует анализ audio context — проверить,
      что нет ложных срабатываний в тишине и корректная очистка при размьюте/выходе
      (нет утечек AudioContext).

---

## 7. Screen sharing / прочий UI

- [ ] `ScreenSharingView.svelte`: демонстрация экрана, вход/выход из fullscreen
      (иконка `Maximize`).
- [ ] `ToggleParticipantsButton` показывает/скрывает панель участников.
- [ ] `ControlBar` / `ControlExt`: все кнопки (mic/camera/leave/record/transcribe)
      работают.
- [ ] `RoomPreview` / `ParticipantsPreview` / `FloorPreview` рендерятся без ошибок.
- [ ] Звуки (`packages/presentation/src/sound.ts`) проигрываются на нужных событиях.

---

## 8. Login base app

- [ ] `LoginAppBase.svelte` рендерится, форма `AuthLikeForm.svelte` работает.
- [ ] `Label.svelte` и `theme.ts` (login) отображаются корректно в light/dark темах.
- [ ] Обычный логин/подтверждение (`Form`, `ConfirmationSend`) не сломаны регрессией.

---

## 9. Core / инфраструктура

- [ ] **Transient middleware** (`foundations/server/packages/middleware/src/transient.ts`):
      временный документ с TTL создаётся и автоматически удаляется по истечении срока.
- [ ] **Queue** (`plugins/love/src/queue.ts`, `foundations/server/packages/core/src/queue/types.ts`):
      webhook-события love публикуются в Kafka-очередь и обрабатываются асинхронно.
- [ ] **REST client** (`foundations/core/packages/api-client/src/rest/*`): запросы
      с новыми типами проходят; используется в `workspaceClient.ts`.
- [ ] **Social ID types** (`models/core`, `foundations/core/packages/core/src/classes.ts`):
      новые типы socialId не ломают существующие сущности.

---

## 10. Миграции

- [ ] `models/love/src/migration.ts`: применить миграции на существующей БД →
      `MeetingMinutes` / домены (`DOMAIN_LOVE`, `DOMAIN_MEETING_MINUTES`) создаются,
      дефолтные комнаты/floor не дублируются при повторном апгрейде.
- [ ] `server/account/src/collections/postgres/migrations.ts`: миграция аккаунтов
      выполняется идемпотентно.
- [ ] Проверить существующие (до-PR) митинги: идентификация переехала с `Room` на
      `MeetingMinutes` — старые данные остаются доступны.

---

## 11. Локализация

- [ ] Action «Show video» добавлен во все локали (`plugins/love-assets/lang/*.json`:
      en, ru, de, fr, es, it, ja, pt, pt-br, cs, tr, zh).
- [ ] Переключить UI на 2–3 языка → новые строки не показываются как ключи-заглушки.

---

## 12. Известные ограничения (из docs/livekit_meeting_minutes.md — НЕ баги этого PR)

Учитывать при приёмке, отдельно от verification:
- Гостевые ссылки требуют активный `meetingId`; для запланированных (ещё не начатых)
  митингов вход по времени/`scheduled` — **в TODO**, не реализовано.
- Запрет подключения к закрытой комнате должен проверяться на уровне love-сервиса,
  сейчас частично отключено изменение параметров комнат — **в TODO**.

---

## Быстрый smoke-чеклист (минимум перед merge)
- [ ] Все пакеты из п.1 собираются, `diagnostics` чист.
- [ ] Love-сервис стартует со всеми env, принимает webhook от LiveKit.
- [ ] Двое авторизованных пользователей проводят митинг (audio/video/screen-share).
- [ ] Приглашение: отправка → принятие → митинг создаётся.
- [ ] Гость входит по ссылке в приватном окне и участвует в митинге.
- [ ] Запись стартует, завершается, файл в S3, presenter показывает статус.
- [ ] Нет битых импортов после удаления `joinRequests.*` и старых попапов.
