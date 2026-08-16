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
  import { Label, Spinner, EditBox, IconSearch } from '@hcengineering/ui'
  import gifPlugin from '@hcengineering/gif'
  import { giphySearch, giphyTrending, GiphyRateLimited, type GiphyGif } from '../giphy'

  export let active: boolean = false

  const dispatch = createEventDispatcher()

  const PAGE = 24
  // 450ms is a compromise forced by the beta key's 100 calls/hour. Typing "excited" at a
  // typical speed fires one call instead of seven, which is the difference between the tab
  // working all afternoon and dying by lunchtime.
  const DEBOUNCE_MS = 450

  let query = ''
  let gifs: GiphyGif[] = []
  let loading = false
  let rateLimited = false
  let failed = false
  let offset = 0
  let more = false

  let timer: any
  let controller: AbortController | undefined
  let loadedOnce = false

  function abort (): void {
    controller?.abort()
    controller = undefined
  }

  async function run (q: string, nextOffset: number, append: boolean): Promise<void> {
    abort()
    controller = new AbortController()
    loading = true
    rateLimited = false
    failed = false
    try {
      const batch =
        q.trim() === ''
          ? await giphyTrending(PAGE, nextOffset, controller.signal)
          : await giphySearch(q, PAGE, nextOffset, controller.signal)
      gifs = append ? [...gifs, ...batch] : batch
      offset = nextOffset + batch.length
      // GIPHY returns a short page at the end of a result set, so a full page implies more.
      more = batch.length === PAGE
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      if (err instanceof GiphyRateLimited) rateLimited = true
      else failed = true
    } finally {
      loading = false
    }
  }

  function schedule (q: string): void {
    clearTimeout(timer)
    timer = setTimeout(() => {
      void run(q, 0, false)
    }, DEBOUNCE_MS)
  }

  // Only fetch once the tab is actually looked at. Loading trending while the user is on the
  // emoji tab would spend one of the hundred calls on something nobody asked to see.
  $: if (active && !loadedOnce) {
    loadedOnce = true
    void run('', 0, false)
  }

  $: if (active && loadedOnce) schedule(query)

  onDestroy(() => {
    clearTimeout(timer)
    abort()
  })

  function pick (g: GiphyGif): void {
    // Hot-link via `src`. The library tab sends `file-id` instead, and the gif node already
    // accepts either (text-editor/src/types.ts insertGif), so no node change is needed.
    // Nothing is uploaded to workspace storage, because GIPHY forbid storing copies.
    //
    // The consequence, worth being explicit about: a message keeps working only while GIPHY
    // keeps serving that url. Library GIFs are ours and permanent. Slack behaves the same way.
    dispatch('select', { src: g.url, width: g.width, height: g.height, alt: g.title })
  }
</script>

<div class="giphyTab">
  <div class="giphyTab-search">
    <div class="giphyTab-searchIcon"><IconSearch size={'small'} /></div>
    <EditBox bind:value={query} placeholder={gifPlugin.string.SearchGiphy} focusable />
  </div>

  <div class="giphyTab-grid">
    {#if loading && gifs.length === 0}
      <div class="giphyTab-state"><Spinner size={'medium'} /></div>
    {:else if rateLimited}
      <!-- Named explicitly. "Nothing found" for a rate limit would send someone hunting for a
           bug in their search terms. -->
      <div class="giphyTab-state">
        <span class="title"><Label label={gifPlugin.string.GiphyRateLimited} /></span>
        <span class="hint"><Label label={gifPlugin.string.GiphyRateLimitedHint} /></span>
      </div>
    {:else if failed}
      <div class="giphyTab-state">
        <span class="title"><Label label={gifPlugin.string.GiphyUnavailable} /></span>
        <span class="hint"><Label label={gifPlugin.string.GiphyUnavailableHint} /></span>
      </div>
    {:else if gifs.length === 0}
      <div class="giphyTab-state">
        <span class="title"><Label label={gifPlugin.string.NoResults} /></span>
        <span class="hint"><Label label={gifPlugin.string.NoResultsHint} /></span>
      </div>
    {:else}
      <div class="giphyTab-cells">
        {#each gifs as g (g.id)}
          <button
            class="giphyTab-cell"
            title={g.title}
            on:click={() => {
              pick(g)
            }}
          >
            <img src={g.previewUrl} alt={g.title} loading="lazy" />
          </button>
        {/each}
      </div>
      {#if more}
        <button
          class="giphyTab-more"
          disabled={loading}
          on:click={() => {
            void run(query, offset, true)
          }}
        >
          <Label label={loading ? gifPlugin.string.Loading : gifPlugin.string.LoadMore} />
        </button>
      {/if}
    {/if}
  </div>

  <!--
    Required by the GIPHY API terms: "We require all apps that use the GIPHY API to
    conspicuously display 'Powered By GIPHY' attribution marks where the API is utilized."
    Do not remove this to save a row of pixels.
  -->
  <div class="giphyTab-attribution">
    <Label label={gifPlugin.string.PoweredByGiphy} />
  </div>
</div>

<style lang="scss">
  .giphyTab {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .giphyTab-search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.5rem;
    padding: 0.375rem 0.625rem;
    background: var(--theme-refinput-color);
    border: 1px solid var(--theme-refinput-border);
    border-radius: var(--small-BorderRadius);
    flex-shrink: 0;
  }

  .giphyTab-searchIcon {
    display: flex;
    color: var(--theme-dark-color);
    flex-shrink: 0;
  }

  .giphyTab-grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0.5rem 0.5rem;
  }

  .giphyTab-cells {
    // Two columns of ~200px previews. A masonry layout would fit more per screen but reflows
    // as images decode, which makes the tile under the cursor move at click time.
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.375rem;
  }

  .giphyTab-cell {
    padding: 0;
    background: var(--theme-bg-accent-color);
    border: 1px solid transparent;
    border-radius: var(--small-BorderRadius);
    overflow: hidden;
    cursor: pointer;
    aspect-ratio: 1 / 1;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    &:hover {
      border-color: var(--theme-caption-color);
    }
  }

  .giphyTab-more {
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.5rem;
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    border-radius: var(--small-BorderRadius);
    cursor: pointer;

    &:disabled {
      cursor: default;
      opacity: 0.6;
    }
  }

  .giphyTab-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    height: 100%;
    min-height: 18rem;
    text-align: center;

    .title {
      font-weight: 500;
      color: var(--theme-caption-color);
    }
    .hint {
      font-size: 0.8125rem;
      color: var(--theme-dark-color);
    }
  }

  .giphyTab-attribution {
    flex-shrink: 0;
    padding: 0.375rem 0.5rem;
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
    text-align: center;
    color: var(--theme-dark-color);
    border-top: 1px solid var(--theme-popup-divider);
  }
</style>
