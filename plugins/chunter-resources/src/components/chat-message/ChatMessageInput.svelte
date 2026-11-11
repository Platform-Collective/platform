<!--
// Copyright © 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import activity, { ActivityMessage } from '@hcengineering/activity'
  import { Analytics } from '@hcengineering/analytics'
  import attachment, { type Attachment } from '@hcengineering/attachment'
  import { AttachmentRefInput } from '@hcengineering/attachment-resources'
  import chunter, { ChatMessage, ChunterEvents, ThreadMessage } from '@hcengineering/chunter'
  import { Class, Doc, generateId, getCurrentAccount, Ref, type CommitResult } from '@hcengineering/core'
  import { createQuery, DraftController, draftsStore, getClient } from '@hcengineering/presentation'
  import { EmptyMarkup, isEmptyMarkup } from '@hcengineering/text'
  import { createEventDispatcher } from 'svelte'
  import { getObjectId } from '@hcengineering/view-resources'
  import { type DraftContent, keepsUnsentDraft, renewSharedDraft } from './draftSync'
  import { ThrottledCaller } from '@hcengineering/ui'
  import { getSpace, editingMessageStore } from '@hcengineering/activity-resources'

  import { getChannelSpace } from '../../utils'
  import { getChatMessageEditData, type ChatMessageInputData } from '../../chat-message-utils'
  import ChannelTypingInfo from '../ChannelTypingInfo.svelte'

  export let object: Doc
  export let chatMessage: ChatMessage | undefined = undefined
  export let shouldSaveDraft: boolean = true
  export let focusIndex: number = -1
  export let boundary: HTMLElement | undefined = undefined
  export let loading = false
  export let collection: string = 'comments'
  export let autofocus = false
  export let withTypingInfo = false
  export let onKeyDown: ((e: KeyboardEvent) => void) | undefined = undefined

  import { setTyping, clearTyping } from '@hcengineering/presence-resources'

  type MessageDraft = Pick<ChatMessage, '_id' | 'message' | 'attachments'>

  const dispatch = createEventDispatcher()

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const _class: Ref<Class<ChatMessage>> = hierarchy.isDerived(object._class, activity.class.ActivityMessage)
    ? chunter.class.ThreadMessage
    : chunter.class.ChatMessage
  const createdMessageQuery = createQuery()

  const draftKey = `${object._id}_${_class}`
  const draftController = new DraftController<MessageDraft>(draftKey)
  const currentDraft = shouldSaveDraft ? $draftsStore[draftKey] : undefined

  const emptyMessage: Pick<MessageDraft, 'message' | 'attachments'> = {
    message: EmptyMarkup,
    attachments: 0
  }

  let inputRef: AttachmentRefInput
  let inputAttachments = new Map<Ref<Attachment>, Attachment>()
  let keepingMessageId: Ref<ChatMessage> | undefined
  // Copy the stored draft: the object in draftsStore is shared with any other input showing the same draft, and
  // onUpdate() below mutates currentMessage in place.
  // Both inputs still save to the same draft key, so the stored draft is the one of the input edited last. When
  // both inputs were edited, the other input's text is not stored and is gone after a reload.
  let currentMessage: MessageDraft = chatMessage ?? (currentDraft != null ? { ...currentDraft } : getDefault())
  let _id = currentMessage._id
  let inputContent = currentMessage.message
  // What this input showed when it loaded the draft; content still equal to it was not edited here.
  // AttachmentRefInput loads its files from the same draft store entry.
  let loadedMessage: DraftContent = {
    ...currentMessage,
    attachmentIds: Object.keys(($draftsStore[`${_id}_attachments`] as Record<string, Attachment> | undefined) ?? {})
  }

  // The same draft (and message _id) can be open in several inputs at once, e.g. in the channel view and in the
  // sidebar. Watch for the message being created to clear this input when it was sent from another one.
  $: hasContent = !isEmptyMarkup(currentMessage.message) || (currentMessage.attachments ?? 0) > 0
  $: if (currentDraft != null || (shouldSaveDraft && hasContent)) {
    createdMessageQuery.query(_class, { _id, space: getSpace(object) }, onMessageCreated)
  } else {
    createdMessageQuery.unsubscribe()
  }

  function onMessageCreated(result: ChatMessage[]): void {
    if (result.length === 0 || _id === chatMessage?._id) return
    // Ouch we have got comment with same id created already.
    if (keepsUnsentDraft(shownMessage(), loadedMessage, result[0])) {
      // Content typed here and not sent is kept as a new draft, together with the files added here.
      void keepDraftAfterSend(result[0])
    } else {
      // Stale copy of the draft that was sent
      clear()
    }
  }

  function shownMessage(): DraftContent {
    return { ...currentMessage, attachmentIds: Array.from(inputAttachments.keys()) }
  }

  async function keepDraftAfterSend(sent: ChatMessage): Promise<void> {
    if (keepingMessageId === sent._id) return
    keepingMessageId = sent._id
    try {
      const sentAttachments =
        (sent.attachments ?? 0) > 0 ? await client.findAll(attachment.class.Attachment, { attachedTo: sent._id }) : []
      // The input may have sent or cleared its draft while the attachment query was pending.
      if (_id !== sent._id) return
      if (!keepsUnsentDraft(shownMessage(), loadedMessage, sent)) {
        clear()
        return
      }
      // Files sent with the message belong to it. Files that came with the loaded copy were sent, or removed and
      // deleted, by the other input.
      const excluded = new Set<Ref<Attachment>>([
        ...sentAttachments.map((it) => it._id),
        ...((loadedMessage.attachmentIds ?? []) as Array<Ref<Attachment>>)
      ])
      const renewed = renewSharedDraft(currentMessage, inputAttachments, generateId<ChatMessage>(), excluded)
      // Store the files under the new ID before AttachmentRefInput switches to it and loads them from there.
      if (renewed.attachments.size > 0) {
        DraftController.save(`${renewed.draft._id}_attachments`, Object.fromEntries(renewed.attachments))
      }
      DraftController.remove(`${_id}_attachments`)
      currentMessage = renewed.draft
      loadedMessage = renewed.loaded
      inputAttachments = renewed.attachments
      _id = currentMessage._id
    } catch (err: unknown) {
      // Leave the current draft and its files as they are if the sent files cannot be read.
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      keepingMessageId = undefined
    }
  }

  function clear(): void {
    currentMessage = getDefault()
    loadedMessage = { ...currentMessage, attachmentIds: [] }
    _id = currentMessage._id
    inputContent = currentMessage.message
    inputRef.removeDraft(false)
  }

  function objectChange(draft: MessageDraft, empty: Partial<MessageDraft>): void {
    if (shouldSaveDraft) {
      draftController.save(draft, empty)
    }
  }

  $: objectChange(currentMessage, emptyMessage)

  function getDefault(): MessageDraft {
    return {
      _id: generateId(),
      ...emptyMessage
    }
  }

  const acc = getCurrentAccount()
  const throttle = new ThrottledCaller(500)

  async function deleteTypingInfo(): Promise<void> {
    if (!withTypingInfo) return
    void clearTyping(acc.primarySocialId, object._id)
  }

  async function updateTypingInfo(): Promise<void> {
    if (!withTypingInfo) return

    throttle.call(() => {
      void setTyping(acc.primarySocialId, object._id, object.space)
    })
  }

  function onUpdate(event: CustomEvent): void {
    if (!isEmptyMarkup(event.detail.message)) {
      void updateTypingInfo()
    }
    if (!shouldSaveDraft) {
      return
    }
    const { message, attachments } = event.detail
    currentMessage.message = message
    currentMessage.attachments = attachments
  }

  async function handleCreate(event: CustomEvent, _id: Ref<ChatMessage>): Promise<void> {
    try {
      const res = await createMessage(event, _id, `chunter.create.${_class} ${object._class}`)

      console.log(`create.${_class} measure`, res.serverTime, res.time)
      const objectId = await getObjectId(object, client.getHierarchy())
      Analytics.handleEvent(ChunterEvents.MessageCreated, { ok: res.result, objectId, objectClass: object._class })
    } catch (err: any) {
      const objectId = await getObjectId(object, client.getHierarchy())
      Analytics.handleEvent(ChunterEvents.MessageCreated, { ok: false, objectId, objectClass: object._class })
      Analytics.handleError(err)
    }
  }

  async function handleEdit(event: CustomEvent): Promise<void> {
    try {
      await editMessage(event)
      const objectId = await getObjectId(object, client.getHierarchy())
      Analytics.handleEvent(ChunterEvents.MessageEdited, { ok: true, objectId, objectClass: object._class })
    } catch (err: any) {
      const objectId = await getObjectId(object, client.getHierarchy())
      Analytics.handleEvent(ChunterEvents.MessageEdited, { ok: false, objectId, objectClass: object._class })
      Analytics.handleError(err)
    }
  }

  async function onMessage(event: CustomEvent): Promise<void> {
    draftController.remove()
    inputRef.removeDraft(false)

    if (chatMessage !== undefined) {
      loading = true
      await handleEdit(event)
    } else {
      void handleCreate(event, _id)
      void deleteTypingInfo()
    }

    // Remove draft from Local Storage
    clear()
    dispatch('submit', false)
    loading = false
  }

  async function createMessage(event: CustomEvent, _id: Ref<ChatMessage>, msg: string): Promise<CommitResult> {
    const { message, attachments } = event.detail
    const operations = client.apply(undefined, msg)

    if (_class === chunter.class.ThreadMessage) {
      const parentMessage = object as ActivityMessage

      await operations.addCollection<ActivityMessage, ThreadMessage>(
        chunter.class.ThreadMessage,
        parentMessage.space,
        parentMessage._id,
        parentMessage._class,
        'replies',
        {
          message,
          attachments,
          objectClass: parentMessage.attachedToClass,
          objectId: parentMessage.attachedTo
        },
        _id as Ref<ThreadMessage>
      )
    } else {
      await operations.addCollection<Doc, ChatMessage>(
        _class,
        getSpace(object),
        object._id,
        object._class,
        collection,
        { message, attachments },
        _id
      )
    }
    return await operations.commit()
  }

  async function editMessage(event: CustomEvent<ChatMessageInputData>): Promise<void> {
    if (chatMessage === undefined) {
      return
    }
    await client.update(chatMessage, getChatMessageEditData(event.detail, Date.now()))
  }
  export function submit(): void {
    inputRef.submit()
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (inputRef.isEmptyDraft() && chatMessage == null) {
        onKeyDown?.(event)
      }
    }

    if (event.key === 'Escape') {
      if ($editingMessageStore === undefined) return false
      event.stopPropagation()
      event.preventDefault()
      editingMessageStore.set(undefined)
    }
    return false
  }
</script>

<AttachmentRefInput
  {focusIndex}
  bind:this={inputRef}
  bind:attachments={inputAttachments}
  bind:content={inputContent}
  docId={object._id}
  docClass={object._class}
  {_class}
  space={getChannelSpace(object._class, object._id, object.space)}
  skipAttachmentsPreload={(currentMessage.attachments ?? 0) === 0}
  bind:objectId={_id}
  {shouldSaveDraft}
  {boundary}
  {autofocus}
  on:message={onMessage}
  on:update={onUpdate}
  on:focus
  on:blur
  bind:loading
  onKeyDown={handleKeyDown}
/>

{#if withTypingInfo}
  <ChannelTypingInfo {object} />
{/if}
