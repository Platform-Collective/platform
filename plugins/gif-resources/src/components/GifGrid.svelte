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
  import { Label } from '@hcengineering/ui'
  import gifPlugin, { type WorkspaceGif } from '@hcengineering/gif'
  import { aspectRatio, columnCount, packColumns } from './GifGrid.svelte.helpers'
  import GifCell from './GifCell.svelte'

  export let items: WorkspaceGif[] = []

  const dispatch = createEventDispatcher()

  let width = 0
  $: columns = packColumns(items, columnCount(width))
</script>

<div class="gifGrid" bind:clientWidth={width}>
  {#each columns as column, ci (ci)}
    <div class="gifGrid-column">
      {#each column as gif (gif._id)}
        <!--
          The box is reserved from the stored dimensions before the image arrives, so the grid
          does not reflow as GIFs load. That reflow is the single thing that makes a picker
          feel broken.
        -->
        <div class="gifGrid-cell" style:aspect-ratio={`${aspectRatio(gif)}`}>
          <GifCell
            {gif}
            on:select={() => {
              dispatch('select', gif)
            }}
          />
        </div>
      {/each}
    </div>
  {/each}
</div>

{#if items.length === 0}
  <div class="gifGrid-none"><Label label={gifPlugin.string.NoResults} /></div>
{/if}

<style lang="scss">
  .gifGrid {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
  }

  .gifGrid-column {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }

  .gifGrid-cell {
    position: relative;
    width: 100%;
    border-radius: var(--small-BorderRadius);
    overflow: hidden;
    // A transparent GIF on the popup background reads as a rendering artifact, so every cell
    // gets its own ground in both themes.
    background: var(--theme-button-default);
    transition:
      transform 0.15s var(--timing-shadow),
      box-shadow 0.15s var(--timing-shadow);

    &:hover {
      transform: translateY(-1px);
      box-shadow: var(--theme-popup-shadow);
    }
  }

  .gifGrid-none {
    padding: 1rem;
    text-align: center;
    color: var(--theme-dark-color);
  }
</style>
