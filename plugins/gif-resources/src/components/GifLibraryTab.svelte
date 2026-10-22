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
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button, Label, Scroller, SearchInput, Spinner, showPopup } from '@hcengineering/ui'
  import { createQuery } from '@hcengineering/presentation'
  import type { Ref } from '@hcengineering/core'
  import gifPlugin, {
    GIF_PAGE_SIZE,
    type WorkspaceGif,
    libraryPage,
    libraryViewState,
    likeContains,
    selectFirst
  } from '@hcengineering/gif'
  import { orderByRecents, parseRecents, pushRecent } from './GifGrid.svelte.helpers'
  import GifGrid from './GifGrid.svelte'
  import GifUploadPopup from './GifUploadPopup.svelte'

  export let active: boolean = true

  const dispatch = createEventDispatcher()
  const RECENTS_KEY = 'gif.recents'

  let items: WorkspaceGif[] = []
  let matchedTotal = 0
  let libraryTotal = 0
  let loaded = false
  let query = ''
  let page = 0
  let recents: string[] = []
  let recentGifs: WorkspaceGif[] = []

  // Search and paging run on the server. A library grows to hundreds of blob-backed docs, so
  // this asks for one window at a time instead of loading everything and filtering here, and
  // an entry older than any fixed window stays reachable. Scoped to this component's lifetime,
  // unlike the emoji plugin's load-everything-at-workbench-start store.
  const gifQuery = createQuery()
  $: term = query.trim()
  $: gifQuery.query(
    gifPlugin.class.WorkspaceGif,
    term === '' ? {} : { title: { $like: likeContains(term) } },
    (res) => {
      items = res
      matchedTotal = res.total
      loaded = true
    },
    { limit: (page + 1) * GIF_PAGE_SIZE, sort: { modifiedOn: -1 }, total: true }
  )

  // Whether the library is empty at all, so a search with no hits is not reported as an empty
  // library.
  const totalQuery = createQuery()
  $: totalQuery.query(
    gifPlugin.class.WorkspaceGif,
    {},
    (res) => {
      libraryTotal = res.total
    },
    { limit: 1, total: true }
  )

  // Recently used entries lead the unfiltered view, fetched by id so they are found however
  // old the upload is.
  const recentsQuery = createQuery()
  $: recentsQuery.query(gifPlugin.class.WorkspaceGif, { _id: { $in: recents as Array<Ref<WorkspaceGif>> } }, (res) => {
    recentGifs = res
  })

  onMount(() => {
    recents = parseRecents(localStorage.getItem(RECENTS_KEY))
  })

  $: leading = term === '' ? orderByRecents(recentGifs, recents) : []
  $: ordered = [...leading, ...items.filter((g) => !leading.some((r) => r._id === g._id))]
  $: pageResult = { items: ordered, hasMore: libraryPage(items, matchedTotal).hasMore }
  $: state = libraryViewState({ loaded, query: term, total: libraryTotal, matched: matchedTotal })

  function pick(gif: WorkspaceGif): void {
    recents = pushRecent(recents, gif._id)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
    dispatch('select', {
      'file-id': gif.blob,
      width: gif.width,
      height: gif.height,
      alt: gif.title
    })
  }

  function onSearchKeydown(e: KeyboardEvent): void {
    // Enter picks the first result of what is on screen. Type, Enter, sent.
    if (e.key !== 'Enter') return
    const first = selectFirst(pageResult.items)
    if (first !== undefined) {
      pick(first)
      e.preventDefault()
    }
  }

  function openUpload(): void {
    showPopup(GifUploadPopup, {}, undefined, () => {})
  }
</script>

<div class="gifLibrary">
  <div class="gifLibrary-tools">
    <SearchInput
      value={query}
      placeholder={gifPlugin.string.SearchGifs}
      width={'100%'}
      autoFocus={active}
      delay={50}
      on:change={(result) => {
        query = result.detail ?? ''
        page = 0
      }}
    />
    <Button
      kind={'regular'}
      size={'small'}
      icon={gifPlugin.icon.Gif}
      label={gifPlugin.string.Upload}
      on:click={openUpload}
    />
  </div>

  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="gifLibrary-body" on:keydown={onSearchKeydown}>
    {#if state === 'loading'}
      <div class="gifLibrary-placeholder"><Spinner size={'small'} /></div>
    {:else if state === 'empty'}
      <!-- The first thing anyone sees on a new workspace. A blank box and a broken grid look
           identical, so this always offers the next step. -->
      <div class="gifLibrary-placeholder">
        <span class="title"><Label label={gifPlugin.string.NoGifsYet} /></span>
        <span class="hint"><Label label={gifPlugin.string.NoGifsYetHint} /></span>
        <Button kind={'primary'} size={'medium'} label={gifPlugin.string.UploadGif} on:click={openUpload} />
      </div>
    {:else if state === 'no-results'}
      <!-- Deliberately not the empty-library message: telling someone their library is empty
           after a fruitless search says their uploads are gone. -->
      <div class="gifLibrary-placeholder">
        <span class="title"><Label label={gifPlugin.string.NoResults} /></span>
        <span class="hint"><Label label={gifPlugin.string.NoResultsHint} /></span>
      </div>
    {:else}
      <Scroller gap="0.5rem" noStretch>
        <GifGrid
          items={pageResult.items}
          on:select={(e) => {
            pick(e.detail)
          }}
        />
        {#if pageResult.hasMore}
          <div class="gifLibrary-more">
            <Button
              kind={'ghost'}
              size={'small'}
              label={gifPlugin.string.LoadMore}
              on:click={() => {
                page += 1
              }}
            />
          </div>
        {/if}
      </Scroller>
    {/if}
  </div>
</div>

<style lang="scss">
  .gifLibrary {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .gifLibrary-tools {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    flex-shrink: 0;
  }

  .gifLibrary-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 0 0.75rem 0.75rem;
  }

  .gifLibrary-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    flex: 1;
    text-align: center;
    padding: 1rem;

    .title {
      font-weight: 500;
      color: var(--theme-caption-color);
    }
    .hint {
      font-size: 0.8125rem;
      color: var(--theme-dark-color);
      max-width: 16rem;
    }
  }

  .gifLibrary-more {
    display: flex;
    justify-content: center;
    padding: 0.5rem 0;
  }
</style>
