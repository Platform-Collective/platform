<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import type { Project } from '@hcengineering/tracker'
  import { Label, themeStore, Toggle } from '@hcengineering/ui'
  import type { ViewOptions } from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'
  import { readable } from 'svelte/store'

  import { FIELD_SUMS_OPTION_KEY, readFieldSums, toggleFieldSum, type SummableField } from '../../fieldSum/config'
  import { loadSummableFields } from '../../fieldSum/load'
  import { HIERARCHY_OPTION_KEY, isHierarchySwitchedOn } from '../../hierarchy/config'
  import tracker from '../../plugin'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import { buildRegistry } from '../../projectFields/registry'
  import BoardOptionsSection from '../board/BoardOptionsSection.svelte'

  // Rows of the "Customize view" popup that belong to the project views, below the generic rows: the board
  // settings (board), the sub-issue hierarchy (table) and the number fields to sum (every layout).
  export let viewOptions: ViewOptions
  export let space: Ref<Project> | undefined = undefined
  export let layout: 'table' | 'board' | 'roadmap'

  const dispatch = createEventDispatcher<{ update: { key: string, value: unknown } }>()

  const emptyRegistry = readable(buildRegistry([]))
  $: registry = space !== undefined ? sharedProjectFieldsStore(space) : emptyRegistry

  // The popup works on a copy of the options, so it keeps track of its own changes
  let hierarchy = isHierarchySwitchedOn(viewOptions)
  let sums = readFieldSums(viewOptions)

  let available: SummableField[] = []
  $: void loadSummableFields($registry.fields, $themeStore.language).then((res) => {
    available = res
  })

  function toggleHierarchy (): void {
    hierarchy = !hierarchy
    // Off is not stored, so that switching it off again leaves the view as it was
    dispatch('update', { key: HIERARCHY_OPTION_KEY, value: hierarchy ? true : undefined })
  }

  function toggleSum (key: string): void {
    sums = toggleFieldSum(sums, key)
    dispatch('update', { key: FIELD_SUMS_OPTION_KEY, value: sums.length > 0 ? sums : undefined })
  }
</script>

{#if layout === 'board'}
  <BoardOptionsSection
    {viewOptions}
    {space}
    on:update={(e) => {
      dispatch('update', e.detail)
    }}
  />
{/if}
{#if layout === 'table'}
  <div class="antiCard-menu__divider" />
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="antiCard-menu__item hoverable" data-id="hierarchy-option" on:click={toggleHierarchy}>
    <span class="overflow-label"><Label label={tracker.string.HierarchyView} /></span>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <span on:click|stopPropagation>
      <Toggle on={hierarchy} on:change={toggleHierarchy} />
    </span>
  </div>
{/if}
<div class="antiCard-menu__divider" />
<div class="antiCard-menu__item section-title" data-id="field-sum-title">
  <span class="overflow-label"><Label label={tracker.string.FieldSum} /></span>
</div>
{#each available as field (field.key)}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="antiCard-menu__item hoverable"
    data-id="field-sum-option"
    on:click={() => {
      toggleSum(field.key)
    }}
  >
    <span class="overflow-label" title={field.label}>{field.label}</span>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <span on:click|stopPropagation>
      <Toggle
        on={sums.includes(field.key)}
        on:change={() => {
          toggleSum(field.key)
        }}
      />
    </span>
  </div>
{/each}

<style lang="scss">
  .section-title {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--theme-dark-color);
    text-transform: uppercase;
  }
</style>
