# LiveKit Meeting Minutes Integration

## ✅ Completed

### 1. Meeting Minutes (replaces Room for meeting identification)
- Заменена модель: Room → MeetingMinutes для идентификации митингов
- ParticipantInfo создается из love сервиса после получения событий от LiveKit
- Митинги работают, люди подключаются, агент подключается
- Поддержка нескольких подключений от одного человека

### 2. Invites System (refactored)
Используется **один класс** `UserMeetingInvite` с полем `kind`:
- `kind: 'invite-request'` - создается в space отправителя, отслеживает исходящие приглашения
- `kind: 'invite-response'` - создается серверным триггером в space получателя

#### Поток данных:
1. **Отправка приглашения:**
   - Отправитель вызывает `sendInvites([person])`
   - Создается `UserMeetingInvite` с `kind: 'invite-request'`
   - Система нотификаций создает `CommonInboxNotification`
   - Серверный триггер `OnUserMeetingInvite` создает `invite-response` в space получателя
   - Получатель видит плашку через query на `invite-response`

2. **Принятие/Отклонение:**
   - Accept: создает митинг, обновляет `invite-response.meetingId` + `status = 'accepted'`
   - Decline: обновляет `status = 'declined'`
   - Серверный триггер синхронизирует статус с `invite-request`

3. **Два сценария:**
   - Личный разговор (нет активного митинга): создает митинг в офисе получателя
   - Приглашение в текущий митинг: добавляет в collaborators

#### Рефакторинг выполнен:
- Удален `joinRequests.ts` (дублирующий функционал)
- Удалены `JoinRequestPopup.svelte`, `JoinResponsePopup.svelte`
- Очищены `console.log` из `invites.ts`
- Упрощена архитектура (единая система invites)

### 3. Guest Meeting App
- **GuestMeetingApp.svelte** - полноэкранное приложение для гостей
  - Обрабатывает query params: `meetingId`, `guestToken`
  - Верифицирует гостя через `/guestInfo`
  - При успехе - навигирует в meeting

- **GuestJoinPopup.svelte** - UI для гостя который не смог автоматически присоединиться
  - Запрашивает имя если нужно

- **GuestControlBar.svelte** - упрощенная панель управления для гостей

- **GuestParticipantView.svelte** - просмотр участников для гостя

- **GuestParticipantsListView.svelte** - список участников для гостя

- **GuestMeetingApp** стилизована под LoginApp

### 4. Генерация гостевых ссылок
- При создании Event с room → генерируется гостевая ссылка через `login.function.GetInviteLink`
- Ссылка записывается в `event.location`
- Содержит `inviteId` + `navigateUrl` с `meetId`

### 5. Webhook Processing
- Множественные Webhook receivers (основной + дополнительный для проектов)
- `convertBigIntToString` для сериализации BigInt значений
- Project key filtering в room metadata

### 6. Server Love Service
- `polling.ts` - LiveKitPollingService для мониторинга
- `webhook.ts` - WebhookProcessor класс
- `workspaceClient.ts` расширен

### 7. Transcription & Recording States
- Добавлены enum: `TranscriptionState`, `RecordingState`
- Новые presenters: `MeetingMinutesRecordingStatePresenter`, `MeetingMinutesTranscriptionStatePresenter`
- `PendingRecordingPresenter` для ожидающих записей

---

## 📋 TODO


### Гостевые ссылки - поиск митингов по времени

#### Проблема:
Сейчас ссылка требует `meetingId`. Но если митинг еще не начался - meetingId может быть не активен. 

#### вариант решения

1. Добавить в MeetingMinutes статус `scheduled` - и дату, в ссылку на митинг тоже добавить дату, давать зайти когда митинг активен, или за 5 минут до начала митинга. Показывать их в панельке наверху, с кнопкой начать, и если честь уже гости которые ждут начала, отображать тоже. Гость переодически отправляет запрос на статус, и 5 секунд мы показываем что гость ждет начала митинга, Как только митинг начинается, гость сразу может в него попасть.
2. Заменить ссылку 
3. Из платформы, по мимо Start Meeting, за 5 минут до начала митинга показывать кнопку, Start Scheduled meeting. И в верху в панельке показывать ближайший Scheduled meeting, если остался до него заданный интервал, 30мин/15мин/5мин.


### 4. Поломано запрещение подключения к митингу, нужно проверить и использовать новый стук, сделать проверку закрытости комнаты на уровне love сервиса, а не UI.

- пока что выключил изменение параметров комнат.
