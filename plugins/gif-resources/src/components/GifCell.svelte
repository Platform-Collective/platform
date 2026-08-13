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
  import { createEventDispatcher, onDestroy } from 'svelte'
  import { Label, tooltip } from '@hcengineering/ui'
  import { getBlobRef } from '@hcengineering/presentation'
  import gifPlugin, { type WorkspaceGif } from '@hcengineering/gif'

  export let gif: WorkspaceGif

  const dispatch = createEventDispatcher()

  let node: HTMLButtonElement | undefined
  let src: string | undefined
  let failed = false
  let visible = false
  let observer: IntersectionObserver | undefined

  // Nothing is fetched until the cell is near the viewport. A GIF is served unresized, because
  // the front deliberately skips preview generation for image/gif so the animation survives,
  // so eagerly loading a page of them would pull down every full-size original at once.
  function observe (el: HTMLButtonElement): { destroy: () => void } {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible = true
            observer?.disconnect()
          }
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return {
      destroy: () => {
        observer?.disconnect()
      }
    }
  }

  $: if (visible && src === undefined && !failed) {
    void getBlobRef(gif.blob)
      .then((ref) => {
        src = ref.src
      })
      .catch(() => {
        failed = true
      })
  }

  onDestroy(() => {
    observer?.disconnect()
  })
</script>

<button
  bind:this={node}
  use:observe
  use:tooltip={{ label: gifPlugin.string.Gifs, props: { title: gif.title } }}
  class="gifCell"
  title={gif.title}
  on:click={() => {
    dispatch('select')
  }}
>
  {#if failed}
    <!-- A row whose blob is gone renders a permanent broken box otherwise, with nothing to
         tell the user what happened or how to clear it. -->
    <span class="gifCell-failed"><Label label={gifPlugin.string.Unavailable} /></span>
  {:else if src !== undefined}
    <img
      {src}
      alt={gif.title}
      loading="lazy"
      on:error={() => {
        failed = true
      }}
    />
  {/if}
</button>

<style lang="scss">
  .gifCell {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      // Fades in as it decodes rather than snapping, which is what reads as smooth when a
      // column of GIFs arrives at slightly different times.
      animation: gif-fade-in 0.2s var(--timing-shadow);
    }
  }

  .gifCell-failed {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0.25rem;
    font-size: 0.75rem;
    text-align: center;
    color: var(--theme-dark-color);
  }

  @keyframes gif-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
