<!--
// Copyright © 2022, 2025 Hardcore Engineering Inc.
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
  import { Attachment, AttachmentMetadata } from '@hcengineering/attachment'
  import {
    Blob as PlatformBlob,
    BlobMetadata,
    Class,
    Doc,
    IdMap,
    Markup,
    PersonId,
    RateLimiter,
    Ref,
    Space,
    generateId,
    toIdMap
  } from '@hcengineering/core'
  import { Asset, IntlString, getResource, setPlatformStatus, unknownError } from '@hcengineering/platform'
  import {
    DraftController,
    canDisplayLinkPreview,
    createQuery,
    deleteFile,
    draftsStore,
    fetchLinkPreviewDetails,
    getClient,
    getImageWidth,
    isLinkPreviewEnabled,
    uploadFile,
    LinkPreviewAttachmentMetadata,
    generateFileId
  } from '@hcengineering/presentation'
  import { EmptyMarkup, isEmptyMarkup, jsonToMarkup, MarkupNodeType } from '@hcengineering/text'
  import textEditor, { type RefAction } from '@hcengineering/text-editor'
  import { AttachIcon, ReferenceInput } from '@hcengineering/text-editor-resources'
  import { Loading, type AnySvelteComponent } from '@hcengineering/ui'
  import {
    type FileUploadCallbackParams,
    type UploadHandlerDefinition,
    getUploadHandlers
  } from '@hcengineering/uploader'
  import { createEventDispatcher, onDestroy, tick } from 'svelte'
  import attachment from '../plugin'
  import { getInlineImageFiles, getVisibleAttachments, reconcileInlineAttachments } from '../attachment-files'
  import AttachmentPresenter from './AttachmentPresenter.svelte'

  export let objectId: Ref<Doc>
  export let space: Ref<Space>
  export let _class: Ref<Class<Doc>>
  export let docId: Ref<Doc> | undefined = undefined
  export let docClass: Ref<Class<Doc>> | undefined = undefined
  export let content: Markup = EmptyMarkup
  export let iconSend: Asset | AnySvelteComponent | undefined = undefined
  export let labelSend: IntlString | undefined = undefined
  export let showSend = true
  export let showActions = true
  export let shouldSaveDraft: boolean = false
  export let attachments: IdMap<Attachment> = new Map()
  export let loading = false
  export let inlineImages = false
  export let focusIndex: number = -1
  export let autofocus = false
  export function submit(): void {
    refInput.submit()
  }
  export let placeholder: IntlString | undefined = undefined
  export let extraActions: RefAction[] = []
  export let boundary: HTMLElement | undefined = undefined
  export let skipAttachmentsPreload = false
  export let onKeyDown: ((event: KeyboardEvent) => boolean) | undefined = undefined

  let refInput: ReferenceInput

  let inputFile: HTMLInputElement
  let saved = false
  const dispatch = createEventDispatcher<{
    update: { message: Markup, attachments: number }
    message: { message: Markup, attachments: number }
    focus: void
  }>()

  const client = getClient()
  const query = createQuery()

  $: draftKey = `${objectId}_attachments`
  $: draftController = new DraftController<Record<Ref<Attachment>, Attachment>>(draftKey)

  let draftAttachments: Record<Ref<Attachment>, Attachment> | undefined = undefined
  let originalAttachments: Set<Ref<Attachment>> = new Set<Ref<Attachment>>()
  const newAttachments: Set<Ref<Attachment>> = new Set<Ref<Attachment>>()
  const removedAttachments: Set<Attachment> = new Set<Attachment>()
  const maxLinkPreviewCount = 3
  const urlSet = new Set<string>()

  let fileUploads = 0
  const knownInlineFiles = new Set<Ref<PlatformBlob>>()

  $: inlineFiles = inlineImages ? getInlineImageFiles(content) : new Set<Ref<PlatformBlob>>()
  $: inlineFiles.forEach((file) => knownInlineFiles.add(file))
  $: visibleAttachments = getVisibleAttachments(attachments.values(), inlineFiles, inlineImages)

  let loadingLinks = false

  let refContainer: HTMLElement

  const existingAttachmentsQuery = createQuery()
  let existingAttachments: Ref<Attachment>[] = []

  $: if (Array.from(attachments.keys()).length > 0) {
    existingAttachmentsQuery.query(
      attachment.class.Attachment,
      {
        space,
        attachedTo: objectId,
        attachedToClass: _class,
        _id: { $in: Array.from(attachments.keys()) }
      },
      (res) => {
        existingAttachments = res.map((p) => {
          if (p.type === 'application/link-preview') {
            urlSet.add(getUrlKey(p.name))
          }
          return p._id
        })
      }
    )
  } else {
    existingAttachments = []
    existingAttachmentsQuery.unsubscribe()
  }

  function isValidUrl(s: string): boolean {
    let url: URL
    try {
      url = new URL(s)
    } catch {
      return false
    }
    return url.protocol.startsWith('http')
  }

  function getUrlKey(s: string): string {
    return s
  }

  $: objectId && updateAttachments(objectId)

  async function updateAttachments(objectId: Ref<Doc>): Promise<void> {
    draftAttachments = $draftsStore[draftKey]
    if (draftAttachments && shouldSaveDraft) {
      attachments = new Map()
      newAttachments.clear()
      Object.entries(draftAttachments).map((file) => {
        return attachments.set(file[0] as Ref<Attachment>, file[1])
      })
      Object.entries(draftAttachments).map((file) => {
        return newAttachments.add(file[0] as Ref<Attachment>)
      })
      originalAttachments.clear()
      removedAttachments.clear()
      urlSet.clear()
      query.unsubscribe()
    } else if (!skipAttachmentsPreload) {
      query.query(
        attachment.class.Attachment,
        {
          attachedTo: objectId
        },
        (res) => {
          originalAttachments = new Set(res.map((p) => p._id))
          attachments = toIdMap(res)
        }
      )
    } else {
      attachments = new Map()
      newAttachments.clear()
      originalAttachments.clear()
      removedAttachments.clear()
      urlSet.clear()
      query.unsubscribe()
    }
  }

  function saveDraft(): void {
    if (shouldSaveDraft) {
      draftAttachments = Object.fromEntries(attachments)
      draftController.save(draftAttachments)
    }
  }

  async function createAttachment(file: File, meta?: AttachmentMetadata): Promise<void> {
    try {
      const { uuid, metadata } = await uploadFile(file)
      await _createAttachment(uuid, file.name, file, meta ?? metadata)
    } catch (err: any) {
      void setPlatformStatus(unknownError(err))
    }
  }

  async function uploadInlineImage(file: File): Promise<Markup | undefined> {
    try {
      const { uuid, metadata } = await uploadFile(file)
      // Register ownership before sizing/insertion; failed or removed nodes are cleaned up on send/destroy.
      await _createAttachment(uuid, file.name, file, { ...metadata, inlineImage: true })
      const width = await getImageWidth(file)
      return jsonToMarkup({
        type: MarkupNodeType.image,
        attrs: {
          'file-id': uuid,
          'data-file-type': file.type,
          alt: file.name,
          title: file.name,
          width
        }
      })
    } catch (err) {
      void setPlatformStatus(unknownError(err))
    }
  }

  async function _createAttachment(
    file: Ref<PlatformBlob>,
    name: string,
    blob: File | Blob,
    metadata?: BlobMetadata
  ): Promise<void> {
    try {
      const _id: Ref<Attachment> = generateId()

      attachments.set(_id, {
        _id,
        _class: attachment.class.Attachment,
        collection: 'attachments',
        modifiedOn: 0,
        modifiedBy: '' as PersonId,
        space,
        attachedTo: objectId,
        attachedToClass: _class,
        name,
        file,
        type: blob.type,
        size: blob.size,
        lastModified: blob instanceof File ? blob.lastModified : Date.now(),
        metadata
      })
      newAttachments.add(_id)
      attachments = attachments
      saved = false
      saveDraft()
      dispatch('update', { message: content, attachments: attachments.size })
    } catch (err: any) {
      void setPlatformStatus(unknownError(err))
    }
  }

  async function saveAttachment(doc: Attachment): Promise<void> {
    if (!existingAttachments.includes(doc._id)) {
      await client.addCollection(attachment.class.Attachment, space, objectId, _class, 'attachments', doc, doc._id)
      newAttachments.delete(doc._id)
    }
  }

  async function fileSelected(): Promise<void> {
    await loadFiles(Array.from(inputFile.files ?? []))
    inputFile.value = ''
  }

  async function fileDrop(e: DragEvent): Promise<void> {
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    await loadFiles(files)
  }

  async function removeAttachment(attachment: Attachment): Promise<void> {
    if (inlineFiles.has(attachment.file)) return
    removedAttachments.add(attachment)
    attachments.delete(attachment._id)
    attachments = attachments
    saveDraft()
    dispatch('update', { message: content, attachments: attachments.size })
  }

  async function deleteAttachment(attachment: Attachment): Promise<void> {
    if (attachment.type === 'application/link-preview') {
      urlSet.delete(getUrlKey(attachment.name))
    }
    if (originalAttachments.has(attachment._id)) {
      await client.removeCollection(
        attachment._class,
        attachment.space,
        attachment._id,
        attachment.attachedTo,
        attachment.attachedToClass,
        'attachments'
      )
    } else {
      await deleteFile(attachment.file)
    }
  }

  onDestroy(() => {
    if (!saved && !shouldSaveDraft) {
      newAttachments.forEach((p) => {
        const attachment = attachments.get(p)
        if (attachment !== undefined) {
          void deleteAttachment(attachment)
        }
      })
    }
  })

  export function removeDraft(removeFiles: boolean): void {
    draftController.remove()
    if (removeFiles) {
      newAttachments.forEach((p) => {
        const attachment = attachments.get(p)
        if (attachment !== undefined) {
          void deleteFile(attachment.file)
        }
      })
    }
  }

  export function isEmptyDraft(): boolean {
    return visibleAttachments.length === 0 && isEmptyMarkup(content)
  }

  export async function createAttachments(message: Markup = content): Promise<void> {
    if (saved) {
      return
    }
    if (inlineImages) {
      reconcileInlineAttachments(message, attachments, removedAttachments, newAttachments, knownInlineFiles)
      attachments = attachments
    }
    saved = true
    const limiter = new RateLimiter(10)
    newAttachments.forEach((p) => {
      const attachment = attachments.get(p)
      if (attachment !== undefined) {
        void limiter.add(() => saveAttachment(attachment))
      }
    })
    removedAttachments.forEach((p) => {
      void limiter.add(() => deleteAttachment(p))
    })
    await limiter.waitProcessing()
    newAttachments.clear()
    urlSet.clear()
    removedAttachments.clear()
    saveDraft()
  }

  async function onMessage(event: CustomEvent): Promise<void> {
    loading = true
    await createAttachments(event.detail)
    loading = false
    // Counters track stored records, including inline images, after orphan cleanup.
    dispatch('message', { message: event.detail, attachments: attachments.size })
  }

  function updateLinkPreview(): void {
    const hrefs = refContainer.getElementsByTagName('a')
    const newUrls: string[] = []
    for (let i = 0; i < hrefs.length; i++) {
      if (hrefs[i].target !== '_blank' || !isValidUrl(hrefs[i].href) || hrefs[i].rel === '') {
        continue
      }
      const key = getUrlKey(hrefs[i].href)
      if (urlSet.has(key)) {
        continue
      }
      urlSet.add(key)
      newUrls.push(hrefs[i].href)
    }
    if (newUrls.length > 0) {
      void loadLinks(newUrls)
    }
  }

  function onUpdate(event: CustomEvent): void {
    if (isLinkPreviewEnabled() && !loading && urlSet.size < maxLinkPreviewCount) {
      updateLinkPreview()
    }
    dispatch('update', { message: event.detail, attachments: attachments.size })
  }

  async function loadLinks(urls: string[]): Promise<void> {
    loadingLinks = true
    for (const url of urls) {
      try {
        const meta = await fetchLinkPreviewDetails(url)
        if (canDisplayLinkPreview(meta)) {
          const uuid = generateFileId()
          const blob = new Blob([JSON.stringify(meta)])
          const file = new File([blob], uuid, { type: 'application/link-preview' })
          const metadata: LinkPreviewAttachmentMetadata = {
            title: meta.title,
            image: meta.image,
            description: meta.description,
            imageWidth: meta.imageWidth,
            imageHeight: meta.imageHeight
          }
          await createAttachment(file, metadata)
        }
      } catch (err: any) {
        void setPlatformStatus(unknownError(err))
      }
    }
    loadingLinks = false
  }

  async function loadFiles(files: File[]): Promise<void> {
    fileUploads++
    try {
      const limiter = new RateLimiter(10)
      let insertion = Promise.resolve()
      await Promise.all(
        files.map((file) => {
          if (!inlineImages || !file.type.startsWith('image/')) {
            return limiter.exec(() => createAttachment(file))
          }
          const uploaded = limiter.exec(() => uploadInlineImage(file))
          // Upload concurrently, but keep insertion order independent of upload completion.
          insertion = insertion.then(async () => {
            const markup = await uploaded
            if (markup === undefined) return
            try {
              refInput.insertMarkup(markup)
              await tick()
            } catch (err) {
              void setPlatformStatus(unknownError(err))
            }
          })
          return insertion
        })
      )
    } finally {
      fileUploads--
    }
  }

  function pasteAction(_: any, evt: ClipboardEvent): boolean {
    let target: HTMLElement | null = evt.target as HTMLElement
    let allowed = false

    while (target != null) {
      target = target.parentElement
      if (target === refContainer) {
        allowed = true
      }
    }
    if (!allowed) {
      return false
    }
    const files = Array.from(evt.clipboardData?.files ?? [])

    if (files.length > 0) {
      void loadFiles(files)
      return true
    }

    return false
  }

  async function onFileUploaded({ uuid, name, file, metadata }: FileUploadCallbackParams): Promise<void> {
    try {
      await updateAttachments(objectId)
      await _createAttachment(uuid, name, file, metadata)
    } catch (err: any) {
      void setPlatformStatus(unknownError(err))
    }
  }

  async function uploadWith(uploader: UploadHandlerDefinition): Promise<void> {
    const upload = await getResource(uploader.handler)
    const target = { objectId: docId ?? objectId, objectClass: docClass ?? _class }
    await upload({ onFileUploaded, target })
  }

  let uploadActionIndex = 1000
  const uploadHandlers = getUploadHandlers(client, { category: 'media' })
  const uploadActions: RefAction[] = uploadHandlers.map((handler) => ({
    order: handler.order ?? uploadActionIndex++,
    label: handler.label,
    icon: handler.icon,
    action: () => {
      void uploadWith(handler)
    }
  }))
</script>

<div class="flex-col no-print" bind:this={refContainer}>
  <input
    bind:this={inputFile}
    disabled={inputFile == null}
    multiple
    type="file"
    name="file"
    id="file"
    style="display: none"
    on:change={fileSelected}
  />
  <!-- Route file drops from the editor and the attachment header through the same upload flow. -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="flex-col"
    on:dragover|preventDefault={() => {}}
    on:dragleave={() => {}}
    on:drop|capture={(event) => {
      if (inlineImages) void fileDrop(event)
    }}
    on:drop|preventDefault|stopPropagation={(event) => {
      if (!inlineImages) void fileDrop(event)
    }}
  >
    <ReferenceInput
      {focusIndex}
      bind:this={refInput}
      bind:content
      {iconSend}
      {labelSend}
      {showSend}
      {showActions}
      autofocus={autofocus ? 'end' : false}
      loading={loading || fileUploads > 0 || loadingLinks}
      {boundary}
      {docClass}
      extraActions={[
        ...extraActions,
        {
          label: textEditor.string.Attach,
          icon: AttachIcon,
          action: () => {
            dispatch('focus')
            inputFile.click()
          },
          order: 1001
        },
        ...uploadActions
      ]}
      showHeader={visibleAttachments.length > 0 || fileUploads > 0}
      haveAttachment={visibleAttachments.length > 0}
      on:focus
      on:blur
      on:message={onMessage}
      on:update={onUpdate}
      onPaste={pasteAction}
      onKeyDown={(_, ev) => onKeyDown?.(ev) ?? false}
      {placeholder}
      kitOptions={{
        file: false,
        image: inlineImages,
        gif: true
      }}
    >
      <div slot="header">
        {#if visibleAttachments.length > 0 || fileUploads > 0}
          <div class="flex-row-center list scroll-divider-color">
            {#if fileUploads > 0}
              <div class="flex p-3">
                <Loading />
              </div>
            {/if}
            {#each visibleAttachments as attachment (attachment._id)}
              <div class="item flex">
                <AttachmentPresenter
                  value={attachment}
                  showPreview
                  removable
                  on:remove={(result) => {
                    if (result !== undefined) void removeAttachment(attachment)
                  }}
                />
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </ReferenceInput>
  </div>
</div>

<style lang="scss">
  .list {
    padding: 0.5rem;
    overflow-x: auto;
    overflow-y: hidden;

    .item + .item {
      padding-left: 1rem;
      border-left: 1px solid var(--theme-divider-color);
    }
  }
</style>
