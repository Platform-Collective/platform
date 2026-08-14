<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  import { createEventDispatcher } from 'svelte'
  import core from '@hcengineering/core'
  import { Button, Label, Spinner } from '@hcengineering/ui'
  import { getClient, uploadFile } from '@hcengineering/presentation'
  import gifPlugin, { type UploadRejection } from '@hcengineering/gif'
  import { readGif, rejectionLabel } from './GifUploadPopup.svelte.helpers'

  const dispatch = createEventDispatcher()
  const client = getClient()

  let input: HTMLInputElement
  let busy = false
  let rejection: UploadRejection | undefined
  let failed = false
  let duplicate = false

  async function onSelected(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file === undefined) return

    rejection = undefined
    failed = false
    duplicate = false

    // Validation lives in one place and this component calls it, rather than re-implementing
    // the checks inline the way the custom-emoji popup does. Nothing here re-derives a limit.
    const read = await readGif(file)
    if (!read.ok) {
      rejection = read.reason
      return
    }

    const existing = await client.findOne(gifPlugin.class.WorkspaceGif, { sha256: read.sha256 })
    if (existing !== undefined) {
      duplicate = true
      return
    }

    busy = true
    try {
      const { uuid } = await uploadFile(file)
      await client.createDoc(gifPlugin.class.WorkspaceGif, core.space.Workspace, {
        title: read.title,
        keywords: read.keywords,
        blob: uuid,
        width: read.width,
        height: read.height,
        size: file.size,
        sha256: read.sha256
      })
      dispatch('close')
    } catch {
      // The upload and the doc are two steps. If the second fails the user gets told rather
      // than watching a spinner end in nothing.
      failed = true
    } finally {
      busy = false
    }
  }
</script>

<div class="gifUpload">
  <div class="gifUpload-title"><Label label={gifPlugin.string.UploadGif} /></div>

  <input
    bind:this={input}
    type="file"
    accept="image/gif"
    style:display="none"
    on:change={(e) => {
      void onSelected(e)
    }}
  />

  {#if busy}
    <div class="gifUpload-state"><Spinner size={'small'} /></div>
  {:else}
    <Button
      kind={'primary'}
      size={'medium'}
      label={gifPlugin.string.Upload}
      on:click={() => {
        input.click()
      }}
    />
  {/if}

  <!-- Each rejection has its own message naming the actual limit, rather than one "invalid
       file" for every cause. -->
  {#if rejection !== undefined}
    <div class="gifUpload-error"><Label label={rejectionLabel(rejection)} /></div>
  {:else if duplicate}
    <div class="gifUpload-error"><Label label={gifPlugin.string.AlreadyInLibrary} /></div>
  {:else if failed}
    <div class="gifUpload-error"><Label label={gifPlugin.string.UploadFailed} /></div>
  {/if}
</div>

<style lang="scss">
  .gifUpload {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 1.25rem;
    min-width: 18rem;
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: var(--medium-BorderRadius);
    box-shadow: var(--theme-popup-shadow);
  }

  .gifUpload-title {
    font-weight: 500;
    color: var(--theme-caption-color);
  }

  .gifUpload-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 2rem;
  }

  .gifUpload-error {
    font-size: 0.8125rem;
    text-align: center;
    color: var(--theme-error-color);
    max-width: 18rem;
  }
</style>
