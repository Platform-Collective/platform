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
  import gifPlugin, {
    type WorkspaceGif,
    gridPage,
    libraryViewState,
    matchesQuery,
    selectFirst
  } from '@hcengineering/gif'
  import { orderByRecents, parseRecents, pushRecent } from './GifGrid.svelte.helpers'
  import GifGrid from './GifGrid.svelte'
  import GifUploadPopup from './GifUploadPopup.svelte'

  export let active: boolean = true

  const dispatch = createEventDispatcher()
  const RECENTS_KEY = 'gif.recents'

  let all: WorkspaceGif[] = []
  let loaded = false
  let query = ''
  let page = 0
  let recents: string[] = []

  // Scoped to this component's lifetime with a bounded result, rather than the emoji plugin's
  // load-everything-at-workbench-start store. A library grows to hundreds of blob-backed docs.
  const gifQuery = createQuery()
  $: gifQuery.query(
    gifPlugin.class.WorkspaceGif,
    {},
    (res) => {
      all = res
      loaded = true
    },
    { limit: 500, sort: { modifiedOn: -1 } }
  )

  onMount(() => {
    recents = parseRecents(localStorage.getItem(RECENTS_KEY))
  })

  $: matched = all.filter((g) => matchesQuery(g, query))
  $: ordered = query.trim() === '' ? orderByRecents(matched, recents) : matched
  $: pageResult = gridPage(ordered, 0, (page + 1) * 12)
  $: state = libraryViewState({ loaded, query, total: all.length, matched: matched.length })

  function pick (gif: WorkspaceGif): void {
    recents = pushRecent(recents, gif._id)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
    dispatch('select', {
      'file-id': gif.blob,
      width: gif.width,
      height: gif.height,
      alt: gif.title
    })
  }

  function onSearchKeydown (e: KeyboardEvent): void {
    // Enter picks the first result of what is on screen. Type, Enter, sent.
    if (e.key !== 'Enter') return
    const first = selectFirst(pageResult.items)
    if (first !== undefined) {
      pick(first)
      e.preventDefault()
    }
  }

  function openUpload (): void {
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
        <GifGrid items={pageResult.items} on:select={(e) => { pick(e.detail) }} />
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
