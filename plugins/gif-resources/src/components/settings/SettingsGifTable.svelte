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
  import { Button, Label, Scroller, showPopup } from '@hcengineering/ui'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import gifPlugin, { type WorkspaceGif } from '@hcengineering/gif'
  import GifCell from '../GifCell.svelte'
  import GifUploadPopup from '../GifUploadPopup.svelte'

  const client = getClient()
  let gifs: WorkspaceGif[] = []

  const query = createQuery()
  $: query.query(gifPlugin.class.WorkspaceGif, {}, (res) => {
    gifs = res
  })

  // A shared library with no way to remove anything is one tasteless upload from a problem, so the
  // row goes. THE BLOB DOES NOT. Every message that already contains this gif stores the blob id,
  // not a copy, and nothing rewrites sent messages - so deleting the blob here breaks every one of
  // them permanently, for everyone, with no recovery. Removing the row only takes it out of the
  // picker, which is what "remove from the library" has to mean.
  // The cost is an orphan blob per removal. That is deliberate: an accumulating datalake is a
  // housekeeping problem, a broken message history is not recoverable. A sweep that deletes blobs
  // no live message references is the correct fix and belongs server-side, not behind this button.
  async function remove(gif: WorkspaceGif): Promise<void> {
    await client.removeDoc(gif._class, gif.space, gif._id)
  }
</script>

<div class="gifSettings">
  <div class="gifSettings-header">
    <span class="title"><Label label={gifPlugin.string.GifLibrary} /></span>
    <Button
      kind={'primary'}
      size={'small'}
      label={gifPlugin.string.UploadGif}
      on:click={() => {
        showPopup(GifUploadPopup, {}, undefined, () => {})
      }}
    />
  </div>

  {#if gifs.length === 0}
    <div class="gifSettings-empty">
      <span><Label label={gifPlugin.string.NoGifsYet} /></span>
      <span class="hint"><Label label={gifPlugin.string.NoGifsYetHint} /></span>
    </div>
  {:else}
    <Scroller>
      <div class="gifSettings-list">
        {#each gifs as gif (gif._id)}
          <div class="gifSettings-row">
            <div class="preview"><GifCell {gif} /></div>
            <div class="meta">
              <span class="name">{gif.title}</span>
              <span class="detail">{gif.width}x{gif.height} · {Math.round(gif.size / 1024)} KB</span>
            </div>
            <Button
              kind={'ghost'}
              size={'small'}
              label={gifPlugin.string.Remove}
              on:click={() => {
                void remove(gif)
              }}
            />
          </div>
        {/each}
      </div>
    </Scroller>
  {/if}
</div>

<style lang="scss">
  .gifSettings {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 1rem;
  }

  .gifSettings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.75rem;

    .title {
      font-weight: 500;
      color: var(--theme-caption-color);
    }
  }

  .gifSettings-empty {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 2rem;
    text-align: center;
    color: var(--theme-dark-color);

    .hint {
      font-size: 0.8125rem;
    }
  }

  .gifSettings-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .gifSettings-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    border-radius: var(--small-BorderRadius);
    background: var(--theme-bg-color);

    .preview {
      width: 3rem;
      height: 3rem;
      flex-shrink: 0;
      border-radius: var(--small-BorderRadius);
      overflow: hidden;
      background: var(--theme-button-default);
    }
    .meta {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .name {
      font-weight: 500;
      color: var(--theme-caption-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail {
      font-size: 0.75rem;
      color: var(--theme-dark-color);
    }
  }
</style>
