<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import { Analytics } from '@hcengineering/analytics'
  import { BlobMetadata, SortingOrder, generateId, type Blob, type Ref } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import {
    Button,
    Modal,
    IconHistory,
    IconScribble,
    showPopup,
    tooltip,
    ButtonIcon,
    IconMaximize,
    IconMinimize,
    IconClose,
    Label
  } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'

  import ActionContext from './ActionContext.svelte'
  import FilePreview from './FilePreview.svelte'
  import DownloadFileButton from './DownloadFileButton.svelte'
  import ObjectPopup from './ObjectPopup.svelte'
  import { ComponentExtensions } from '../index'
  import presentation from '../plugin'
  import FileTypeIcon from './FileTypeIcon.svelte'

  export let file: Ref<Blob> | undefined
  export let name: string | undefined = undefined
  export let contentType: string
  export let metadata: BlobMetadata | undefined
  export let props: Record<string, any> & {
    drawings?: any[]
    drawingAvailable?: boolean
    drawingEditable?: boolean
    loadDrawings?: () => Promise<any>
    createDrawing?: (data: any) => Promise<any>
  } = {}

  export let fullSize = false
  export let showIcon = true

  let drawingLoading = false
  let drawingRequest = 0
  let preview: HTMLDivElement | undefined
  let previousFocus: HTMLElement | undefined
  let focusScope: Element | undefined
  let createDrawing: (data: any) => Promise<any>

  const dispatch = createEventDispatcher()
  const titleId = generateId()

  // Only normalize the title: storage URLs distinguish undefined from an empty filename.
  $: titleName = name ?? ''
  $: void loadDrawings(file)

  async function loadDrawings(requestedFile: Ref<Blob> | undefined): Promise<void> {
    const request = ++drawingRequest
    drawingLoading = false
    if (props.drawingAvailable === true) {
      if (props.loadDrawings !== undefined) {
        drawingLoading = true
        props
          .loadDrawings()
          .then((result) => {
            if (request !== drawingRequest || requestedFile !== file) return
            drawingLoading = false
            props.drawings = result
          })
          .catch((error) => {
            if (request === drawingRequest && requestedFile === file) drawingLoading = false
            Analytics.handleError(error)
          })
      }
    }
  }

  // Remember who had focus (e.g. a text editor that opened the preview) before the title takes it.
  function rememberFocus(): void {
    const active = document.activeElement
    if (preview === undefined || !(active instanceof HTMLElement) || active === document.body) return
    focusScope = preview.closest('.hulyModal-container') ?? preview
    if (!focusScope.contains(active)) previousFocus = active
  }

  // Give focus back only if it is still in the popup or was lost with it, never steal it from elsewhere.
  function restoreFocus(): void {
    if (previousFocus === undefined || !previousFocus.isConnected) return
    const active = document.activeElement
    if (active === null || active === document.body || focusScope?.contains(active) === true) {
      previousFocus.focus({ preventScroll: true })
    }
  }

  onDestroy(() => {
    drawingRequest++
    restoreFocus()
  })

  onMount(() => {
    rememberFocus()
    preview?.focus({ preventScroll: true })
    if (props.drawingAvailable === true) {
      if (props.createDrawing !== undefined) {
        createDrawing = props.createDrawing
        props.createDrawing = async (data: any): Promise<any> => {
          const newDrawing = await createDrawing(data)
          if (props.drawings !== undefined) {
            props.drawings = [newDrawing, ...props.drawings]
          } else {
            props.drawings = [newDrawing]
          }
          return newDrawing
        }
      }
    }
  })

  function toggleDrawingEdit(): void {
    props.drawingEditable = !(props.drawingEditable === true)
  }

  function selectCurrentDrawing(ev: MouseEvent): void {
    if (props.drawings === undefined || props.drawings.length === 0) {
      // no current means no history
      return
    }
    showPopup(
      ObjectPopup,
      {
        _class: props.drawings[0]._class,
        selected: props.drawings[0]._id,
        docQuery: {
          parent: props.drawings[0].parent
        },
        options: {
          sort: {
            createdOn: SortingOrder.Descending
          }
        },
        searchMode: 'disabled',
        type: 'presenter',
        width: 'auto'
      },
      ev.target as HTMLElement,
      async (result) => {
        if (result !== undefined) {
          props.drawings = [result]
        }
      }
    )
  }
</script>

<ActionContext context={{ mode: 'browser' }} />
<Modal
  type={'type-component'}
  padding={'0.5rem'}
  bottomPadding={'0'}
  on:fullsize
  on:close={() => {
    dispatch('close')
  }}
>
  <svelte:fragment slot="beforeTitle">
    <ButtonIcon
      icon={IconClose}
      kind={'tertiary'}
      size={'small'}
      noPrint
      on:click={() => {
        dispatch('close')
      }}
    />
    <div class="hulyHeader-divider short no-line no-print" />
    <ButtonIcon
      icon={!fullSize ? IconMaximize : IconMinimize}
      kind={'tertiary'}
      size={'small'}
      noPrint
      on:click={() => {
        fullSize = !fullSize
        dispatch('fullsize', fullSize)
        preview?.focus({ preventScroll: true })
      }}
    />
    <div class="hulyHeader-divider short no-print" />
  </svelte:fragment>

  <svelte:fragment slot="title">
    <div
      class="antiTitle icon-wrapper"
      role="heading"
      aria-level="1"
      aria-labelledby={titleId}
      tabindex="-1"
      bind:this={preview}
    >
      {#if showIcon}
        <div class="wrapped-icon">
          <FileTypeIcon name={titleName} />
        </div>
      {/if}
      <span id={titleId} class="wrapped-title" use:tooltip={{ label: getEmbeddedLabel(titleName) }}>
        {#if titleName.trim().length > 0}
          {titleName}
        {:else}
          <Label label={presentation.string.DocumentPreview} />
        {/if}
      </span>
    </div>
  </svelte:fragment>

  <svelte:fragment slot="actions">
    {#if props.drawingAvailable === true}
      {#if props.drawings !== undefined && props.drawings.length > 0}
        <Button
          icon={IconHistory}
          kind="icon"
          disabled={drawingLoading || props.drawingEditable === true}
          showTooltip={{ label: presentation.string.DrawingHistory }}
          on:click={selectCurrentDrawing}
        />
      {/if}
      <Button
        icon={IconScribble}
        kind="icon"
        disabled={drawingLoading}
        selected={props.drawingEditable === true}
        showTooltip={{ label: presentation.string.StartDrawing }}
        on:click={toggleDrawingEdit}
      />
      <div class="buttons-divider" />
    {/if}
    <DownloadFileButton
      {name}
      {file}
      tooltip={props.drawingAvailable === true ? presentation.string.DownloadOriginal : undefined}
    />
    <ComponentExtensions
      extension={presentation.extension.FilePreviewPopupActions}
      props={{
        file,
        name,
        contentType,
        metadata
      }}
    />
  </svelte:fragment>

  {#if file}
    <FilePreview {file} {contentType} {name} {metadata} {props} fit />
  {/if}
</Modal>

<style>
  .antiTitle:focus {
    outline: none;
  }
</style>
