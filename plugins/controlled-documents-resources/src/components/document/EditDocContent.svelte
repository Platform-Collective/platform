<!--
// Copyright © 2023-2024 Hardcore Engineering Inc.
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
  import attachment, { Attachment } from '@hcengineering/attachment'
  import documents, { DocumentState, type DocumentAttachmentState } from '@hcengineering/controlled-documents'
  import { type Blob, type Ref, generateId } from '@hcengineering/core'
  import { getResource, setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient, getContentType } from '@hcengineering/presentation'
  import textEditorPlugin, { Editor, Heading, type TextEditorHandler } from '@hcengineering/text-editor'
  import {
    AttachIcon,
    CollaboratorEditor,
    NodeHighlightType,
    TableIcon,
    TableOfContents,
    TableOfContentsContent,
    addTableHandler,
    defaultRefActions,
    getNodeElement,
    highlightUpdateCommand,
    selectNode
  } from '@hcengineering/text-editor-resources'
  import { AttachmentsGrid, AttachmentPresenter } from '@hcengineering/attachment-resources'
  import {
    Button,
    Component,
    EditBox,
    IconUndo,
    Label,
    Scroller,
    getEventPositionElement,
    getPopupPositionElement
  } from '@hcengineering/ui'
  import { getCollaborationUser } from '@hcengineering/view-resources'
  import { merge } from 'effector'
  import { createEventDispatcher, onDestroy, tick } from 'svelte'
  import activity from '@hcengineering/activity'
  import plugin from '../../plugin'

  import {
    $areDocumentCommentPopupsOpened as arePopupsOpened,
    $canAddDocumentComments as canAddDocumentComments,
    $canViewDocumentComments as canViewDocumentComments,
    $controlledDocument as controlledDocument,
    $documentCommentHighlightedLocation as documentCommentHighlightedLocation,
    $documentComments as documentComments,
    $documentState as documentState,
    documentCommentsDisplayRequested,
    documentCommentsLocationNavigateRequested,
    documentCommentsAddCanceled,
    $isEditable as isEditable
  } from '../../stores/editors/document'
  import { isActivityDocumentState } from '../../utils'
  import DocumentPrintTitlePage from '../print/DocumentPrintTitlePage.svelte'
  import DocumentTitle from './DocumentTitle.svelte'

  export let boundary: HTMLElement | undefined = undefined

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const user = getCollaborationUser()
  const dispatch = createEventDispatcher()

  let headings: Heading[] = []
  let textEditor: CollaboratorEditor
  let selectedNodeId: string | null | undefined = undefined
  let editor: Editor
  let title = $controlledDocument?.title ?? ''

  $: isTemplate =
    $controlledDocument != null && hierarchy.hasMixin($controlledDocument, documents.mixin.DocumentTemplate)

  $: commentUuids = $documentComments.map((p) => p.nodeId).filter((id) => id != null)

  function handleRefreshHighlight (): void {
    textEditor?.commands()?.command(highlightUpdateCommand())
  }

  const unsubscribeHighlightRefresh = merge([documentCommentHighlightedLocation, documentComments.updates]).subscribe({
    next: () => {
      handleRefreshHighlight()
    }
  })

  const unsubscribeNavigateToLocation = documentCommentsLocationNavigateRequested.subscribe({
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    next: async ({ nodeId }) => {
      if (nodeId == null) {
        handleRefreshHighlight()
        return
      }

      selectedNodeId = nodeId

      if (editor !== undefined) {
        await tick()

        const element = getNodeElement(editor, nodeId)
        element?.scrollIntoView({ behavior: 'smooth' })
      }
    }
  })

  const unsubscribeCommentsAddCanceled = documentCommentsAddCanceled.subscribe({
    next: ({ nodeId }) => {
      if (editor !== undefined && nodeId != null) {
        if (selectNode(editor, nodeId)) {
          editor.commands.unsetQMSInlineCommentMark()
        }
      }
    }
  })

  onDestroy(() => {
    unsubscribeHighlightRefresh()
    unsubscribeNavigateToLocation()
    unsubscribeCommentsAddCanceled()
  })

  const handleUpdateTitle = async () => {
    if (!$controlledDocument || !title) {
      return
    }
    const titleTrimmed = title.trim()

    if (titleTrimmed.length > 0 && titleTrimmed !== $controlledDocument.title) {
      await client.update($controlledDocument, { title: titleTrimmed })
    }
  }

  async function handleShowHeading (heading: Heading): Promise<void> {
    const element = window.document.getElementById(heading.id)
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleNodeHighlight (id: string) {
    if ($documentCommentHighlightedLocation) {
      const { nodeId } = $documentCommentHighlightedLocation
      if (nodeId === id) {
        return { type: NodeHighlightType.WARNING, isActive: true }
      }
    }

    if ($documentComments.some((c) => c.nodeId === id)) {
      return { type: NodeHighlightType.WARNING }
    }

    return null
  }

  function handleShowDocumentComments (nodeId: string): void {
    const element = getNodeElement(editor, nodeId)
    documentCommentsDisplayRequested({ element, nodeId })
  }

  async function createEmbedding (file: File): Promise<{ file: Ref<Blob>, type: string } | undefined> {
    if ($controlledDocument === undefined || $controlledDocument === null) {
      return undefined
    }

    try {
      const uploadFile = await getResource(attachment.helper.UploadFile)
      const { uuid, metadata } = await uploadFile(file)
      const attachmentId: Ref<Attachment> = generateId()
      const type = getContentType(file.name, file.type)

      await client.addCollection(
        attachment.class.Attachment,
        $controlledDocument.space,
        $controlledDocument._id,
        $controlledDocument._class,
        'attachments',
        {
          file: uuid,
          name: file.name,
          type,
          size: file.size,
          lastModified: file.lastModified,
          metadata
        },
        attachmentId
      )

      await client.updateMixin(
        attachmentId,
        attachment.class.Attachment,
        $controlledDocument.space,
        documents.mixin.DocumentAttachment,
        { state: 'new' }
      )

      return { file: uuid, type }
    } catch (err: any) {
      await setPlatformStatus(unknownError(err))
    } finally {
      dispatch('change')
    }
  }

  $: attribute = {
    key: 'content',
    attr: client.getHierarchy().getAttribute(documents.class.ControlledDocument, 'content')
  }

  let allAttachments: Attachment[] = []

  const query = createQuery()
  $: query.query(
    attachment.class.Attachment,
    {
      attachedTo: $controlledDocument?._id
    },
    (res) => {
      allAttachments = res
    }
  )

  function isDeleted (att: Attachment): boolean {
    if (!hierarchy.hasMixin(att, documents.mixin.DocumentAttachment)) return false
    return hierarchy.as(att, documents.mixin.DocumentAttachment).deletedIn != null
  }

  // Active attachments shown in the main grid
  $: attachments = allAttachments.filter((att) => !isDeleted(att))

  // Attachments soft-deleted in the current draft - can be restored until sent for approval
  $: deletedAttachments = allAttachments.filter(isDeleted)
  let progress = false

  let inputFile: HTMLInputElement

  export function handleAttach (): void {
    inputFile.click()
  }

  async function fileSelected (): Promise<void> {
    if (!$isEditable) return

    const list = inputFile.files
    if (list === null || list.length === 0) return

    progress = true

    for (let i = 0; i < list.length; i++) {
      await createEmbedding(list.item(i) as File)
    }

    inputFile.value = ''
    progress = false
  }

  function handleTable (element: HTMLElement, editorHandler: TextEditorHandler, event?: MouseEvent): void {
    const position = event !== undefined ? getEventPositionElement(event) : getPopupPositionElement(element)
    addTableHandler(editorHandler.insertTable, position)
  }

  $: refActions = !$isEditable
    ? []
    : defaultRefActions
      .concat([
        { label: textEditorPlugin.string.Attach, icon: AttachIcon, action: handleAttach, order: 1001 },
        { label: textEditorPlugin.string.Table, icon: TableIcon, action: handleTable, order: 1500 }
      ])
      .sort((a, b) => a.order - b.order)

  function getState (att: Attachment): DocumentAttachmentState | undefined {
    if (!hierarchy.hasMixin(att, documents.mixin.DocumentAttachment)) return undefined
    return hierarchy.as(att, documents.mixin.DocumentAttachment).state
  }

  async function removeAttachment (att: Attachment): Promise<void> {
    if ($controlledDocument == null) return

    // 'new' attachments (added in this version) are removed physically, no soft-delete trace
    if (getState(att) !== 'referenced') {
      await client.removeCollection(att._class, att.space, att._id, att.attachedTo, att.attachedToClass, 'attachments')
      textEditor?.removeAttachment(att.file)
      return
    }

    // Soft delete referenced attachments: mark the version in which they were removed
    await client.updateMixin(att._id, att._class, att.space, documents.mixin.DocumentAttachment, {
      deletedIn: { major: $controlledDocument.major, minor: $controlledDocument.minor }
    })
    textEditor?.removeAttachment(att.file)
  }

  async function restoreAttachment (att: Attachment): Promise<void> {
    await client.updateMixin(att._id, att._class, att.space, documents.mixin.DocumentAttachment, {
      deletedIn: null
    })
  }
</script>

<input
  bind:this={inputFile}
  disabled={inputFile == null}
  multiple
  type="file"
  name="file"
  id="fileInput"
  style="display: none"
  on:change={fileSelected}
/>

{#if $controlledDocument && attribute}
  <DocumentPrintTitlePage />

  {#if headings.length > 0}
    <div class="tocContent only-print">
      <TableOfContentsContent items={headings} enumerated={true} />
    </div>
    <div class="pagebreak" />
  {/if}

  <div class="root relative">
    <div class="toc">
      <TableOfContents items={headings} enumerated={true} on:select={(ev) => handleShowHeading(ev.detail)} />
    </div>
    <Scroller>
      <div class="content relative">
        <DocumentTitle>
          {#if $isEditable}
            <EditBox
              value={title}
              on:value={(event) => {
                title = event.detail
              }}
              on:blur={handleUpdateTitle}
            />
          {:else}
            {$controlledDocument.title}
          {/if}
        </DocumentTitle>
        {#if $controlledDocument.state === DocumentState.Obsolete}
          <div class="watermark-container">
            {#each { length: 24 } as _, i}
              <div class="watermark"><Label label={plugin.string.Obsolete} /></div>
            {/each}
          </div>
        {/if}
        <CollaboratorEditor
          bind:this={textEditor}
          object={$controlledDocument}
          {attribute}
          {user}
          {boundary}
          {refActions}
          readonly={!$isEditable}
          editorAttributes={{ style: 'padding: 0 2em; margin: 0 -2em;' }}
          overflow="none"
          kitOptions={{
            inlineNote: {
              readonly: !isTemplate
            },
            qms: {
              qmsInlineComment: {
                isHighlightModeOn: () => $canViewDocumentComments || $canAddDocumentComments,
                getNodeHighlight: handleNodeHighlight,
                onNodeClicked: (uuids) => {
                  // filter out those uuids that are not in comments
                  uuids = Array.isArray(uuids) ? uuids : [uuids]
                  uuids = uuids.filter((id) => commentUuids.includes(id)).sort()

                  // scroll through the comments as user clicks on the same node
                  const currIndex = selectedNodeId != null ? uuids.indexOf(selectedNodeId) : -1
                  const nextIndex = currIndex === -1 ? 0 : (currIndex + 1) % uuids.length
                  selectedNodeId = uuids[nextIndex]

                  if (!$arePopupsOpened && $canViewDocumentComments && selectedNodeId != null) {
                    handleShowDocumentComments(selectedNodeId)
                  }
                }
              }
            },
            shortcuts: {
              tableMetadataPaste: true
            },
            toc: {
              onChange: (h) => {
                headings = h
                dispatch('headings', h)
              }
            },
            collaboration: {
              inlineComments: false
            }
          }}
          on:editor={(e) => (editor = e.detail)}
          attachFile={async (file) => {
            return await createEmbedding(file)
          }}
        />
        {#if attachments.length > 0}
          <AttachmentsGrid
            {attachments}
            readonly={!$isEditable}
            {progress}
            useAttachmentPreview={false}
            on:remove={async (evt) => {
              if (evt.detail !== undefined) {
                await removeAttachment(evt.detail)
              }
            }}
          />
        {/if}
        {#if $isEditable && deletedAttachments.length > 0}
          <div class="deleted-attachments">
            <div class="deleted-header"><Label label={plugin.string.RemovedAttachments} /></div>
            {#each deletedAttachments as att (att._id)}
              <div class="deleted-row">
                <AttachmentPresenter value={att} />
                <div class="restore-btn">
                  <Button
                    icon={IconUndo}
                    kind="ghost"
                    size="small"
                    showTooltip={{ label: plugin.string.Restore }}
                    on:click={() => restoreAttachment(att)}
                  />
                </div>
              </div>
            {/each}
          </div>
        {/if}
        {#if isActivityDocumentState($documentState)}
          <div class="activity-container no-print">
            <Component
              is={activity.component.Activity}
              props={{
                object: $controlledDocument,
                showCommenInput: true,
                boundary: boundary ?? undefined,
                focusIndex: 1000,
                shouldScroll: false
              }}
            />
          </div>
        {/if}
        <div class="bottomSpacing no-print" />
      </div>
    </Scroller>
  </div>
{/if}

<style lang="scss">
  .root {
    overflow: hidden;

    @media print {
      margin-left: -1rem;
      overflow: visible;
    }

    // Workaround to quickly enumerate headings for controlled docs
    :global(h1) {
      counter-increment: h1;
      counter-reset: h2;

      &::before {
        content: counter(h1) '. ';
      }
    }

    :global(h2) {
      counter-increment: h2;
      counter-reset: h3;

      &::before {
        content: counter(h1) '.' counter(h2) '. ';
      }
    }

    :global(h3) {
      counter-increment: h3;

      &::before {
        content: counter(h1) '.' counter(h2) '.' counter(h3) '. ';
      }
    }
  }

  .toc {
    position: absolute;
    width: 1rem;
    pointer-events: all;
    left: 1px;
    top: 1rem;
    z-index: 1;
  }

  .tocContent {
    padding-left: 2.25rem;
  }

  .content {
    padding: 0 3.25rem;
  }

  .bottomSpacing {
    padding-bottom: 55vh;
  }

  .deleted-attachments {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--theme-divider-color);
  }

  .deleted-header {
    font-weight: 500;
    color: var(--theme-content-color);
    margin-bottom: 0.5rem;
  }

  .deleted-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0;
    width: fit-content;

    :global(.name) {
      text-decoration: line-through;
      opacity: 0.7;
    }

    .restore-btn {
      flex-shrink: 0;
    }
  }

  .activity-container {
    padding-top: 2rem;
  }

  .watermark-container {
    position: absolute;
    z-index: 100;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 35rem;
    padding-top: 20rem;
    overflow: hidden;
    pointer-events: none;

    @media print {
      display: none;
    }
  }

  .watermark {
    z-index: 100;
    margin: auto;
    height: 4rem;
    width: 100%;
    color: var(--theme-divider-color);
    font-size: 8rem;
    transform: rotate(-45deg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
