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
  import { Component, Label, deviceOptionsStore as deviceInfo } from '@hcengineering/ui'
  import emojiPlugin from '@hcengineering/emoji'
  import gifPlugin from '@hcengineering/gif'
  import GifLibraryTab from './GifLibraryTab.svelte'
  import GiphyTab from './GiphyTab.svelte'
  import { giphyConfigured } from '../giphy'

  export let embedded: boolean = false

  const dispatch = createEventDispatcher()

  type Tab = 'emoji' | 'giphy' | 'gif'
  // Always opens on Emoji. Persisting the last tab would mean the emoji button sometimes opens
  // a GIF grid, which is the one variant that reads as broken rather than as a feature.
  let tab: Tab = 'emoji'

  $: isMobile = $deviceInfo.isMobile

  // Resolved once at construction: the key comes from config.json, which is fixed for the life
  // of the page, so re-reading it per render would be work for a value that cannot change.
  const hasGiphy = giphyConfigured()

  // GIPHY sits before the workspace library because it is the one people reach for. With no
  // key configured the tab is absent entirely rather than present and broken.
  const tabs: Array<{ id: Tab, label: typeof gifPlugin.string.Emoji }> = [
    { id: 'emoji', label: gifPlugin.string.Emoji },
    ...(hasGiphy ? [{ id: 'giphy' as Tab, label: gifPlugin.string.Giphy }] : []),
    { id: 'gif', label: gifPlugin.string.Gifs }
  ]

  function select (next: Tab): void {
    tab = next
  }

  function onKeydown (e: KeyboardEvent): void {
    // Switch tabs without leaving the search box. Escape is left to the popup framework, which
    // already handles it for every popup in the app.
    if (!(e.ctrlKey || e.metaKey)) return
    const idx = Number(e.key)
    if (!Number.isInteger(idx) || idx < 1 || idx > tabs.length) return
    select(tabs[idx - 1].id)
    e.preventDefault()
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="gifPicker-container" class:embedded class:mobile={isMobile}>
  <div class="gifPicker-tabs" role="tablist">
    {#each tabs as t (t.id)}
      <button
        class="gifPicker-tab"
        class:selected={tab === t.id}
        role="tab"
        aria-selected={tab === t.id}
        data-id={`tab-${t.id}`}
        on:click={() => {
          select(t.id)
        }}
      >
        <Label label={t.label} />
      </button>
    {/each}
    <!-- Width and offset both derive from tabs.length so adding or hiding a tab cannot leave
         the underline the wrong size, which a hardcoded 50% did when GIPHY made it three. -->
    <div
      class="gifPicker-tab-cursor"
      style:width={`${100 / tabs.length}%`}
      style:left={`${(tabs.findIndex((t) => t.id === tab) * 100) / tabs.length}%`}
    />
  </div>

  <!--
    Both tabs stay mounted and are toggled with CSS. EmojiPopup's onMount walks the whole emoji
    catalogue and its category strip reads element geometry, so remounting on every tab switch
    would re-run that work and reset the scroll position.
  -->
  <div class="gifPicker-body" class:hidden={tab !== 'emoji'} aria-hidden={tab !== 'emoji'}>
    <Component
      is={emojiPlugin.component.EmojiPopup}
      props={{ embedded: true }}
      on:close={(evt) => {
        const detail = evt.detail
        if (detail === null || detail === undefined) return
        dispatch('close', { kind: 'emoji', ...detail })
      }}
    />
  </div>

  {#if hasGiphy}
    <div class="gifPicker-body" class:hidden={tab !== 'giphy'} aria-hidden={tab !== 'giphy'}>
      <GiphyTab
        active={tab === 'giphy'}
        on:select={(evt) => {
          dispatch('close', { kind: 'gif', ...evt.detail })
        }}
      />
    </div>
  {/if}

  <div class="gifPicker-body" class:hidden={tab !== 'gif'} aria-hidden={tab !== 'gif'}>
    <GifLibraryTab
      active={tab === 'gif'}
      on:select={(evt) => {
        dispatch('close', { kind: 'gif', ...evt.detail })
      }}
    />
  </div>
</div>

<style lang="scss">
  .gifPicker-container {
    display: flex;
    flex-direction: column;
    // The emoji body is a fixed 29rem and stays that way; the tab bar sits outside it, so the
    // popup grows rather than the emoji grid losing a row.
    width: 25.5rem;
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: var(--medium-BorderRadius);
    box-shadow: var(--theme-popup-shadow);
    overflow: hidden;

    &.embedded {
      background: transparent;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }

    &.mobile {
      width: 100%;
      max-width: calc(100vw - 2rem);
    }
  }

  .gifPicker-tabs {
    position: relative;
    display: flex;
    flex-shrink: 0;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--theme-popup-divider);
  }

  // Text labels, never icons: the emoji tab already renders its own strip of category icons
  // directly below, and a second row of icons would read as more categories.
  .gifPicker-tab {
    flex: 1;
    padding: 0.625rem 0.25rem;
    font-weight: 500;
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 0.15s var(--timing-shadow);

    &:hover {
      color: var(--theme-caption-color);
    }
    &.selected {
      color: var(--theme-caption-color);
    }
  }

  .gifPicker-tab-cursor {
    position: absolute;
    bottom: -1px;
    width: 50%;
    height: 2px;
    background: var(--theme-caption-color);
    border-radius: 1px;
    transition: left 0.2s var(--timing-shadow);
  }

  .gifPicker-body {
    display: flex;
    flex-direction: column;
    min-height: 29rem;
    max-height: 29rem;

    &.hidden {
      display: none;
    }
  }
</style>
