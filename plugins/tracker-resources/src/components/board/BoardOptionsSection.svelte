<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import type { Project } from '@hcengineering/tracker'
  import { DropdownLabels, Label, themeStore, type DropdownTextItem } from '@hcengineering/ui'
  import type { ViewOptions } from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'
  import { readable } from 'svelte/store'

  import {
    BOARD_OPTION_KEY,
    columnFieldKeys,
    hiddenOf,
    isDefaultBoardConfig,
    limitsOf,
    readBoardConfig,
    resolveBoardDimensions,
    withAllColumnsShown,
    withColumnField,
    withoutColumnLimits,
    type BoardConfig
  } from '../../board/config'
  import tracker from '../../plugin'
  import { parseCustomFieldViewKey } from '../../projectFields/query'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import { buildRegistry } from '../../projectFields/registry'

  // Board settings in the "Customize view" popup, below the generic rows. "Group by" of the popup is the
  // swimlanes of the board; the column field, the hidden columns and the column limits are the board's own.
  export let viewOptions: ViewOptions
  export let space: Ref<Project> | undefined = undefined

  const dispatch = createEventDispatcher<{ update: { key: string, value: BoardConfig | undefined } }>()

  const emptyRegistry = readable(buildRegistry([]))
  $: registry = space !== undefined ? sharedProjectFieldsStore(space) : emptyRegistry

  // The popup works on a copy of the options, so it keeps track of its own changes
  let config = readBoardConfig(viewOptions)
  $: dimensions = resolveBoardDimensions(config, viewOptions.groupBy, { fields: $registry.fields })
  $: hiddenCount = hiddenOf(config, dimensions.columnKey).length
  $: limitCount = Object.keys(limitsOf(config, dimensions.columnKey)).length

  const builtinLabels = {
    status: tracker.string.Status,
    assignee: tracker.string.Assignee,
    priority: tracker.string.Priority,
    component: tracker.string.Component,
    milestone: tracker.string.Milestone
  } as const

  let items: DropdownTextItem[] = []
  async function updateItems (keys: string[], fields: ReadonlyArray<{ key: string, label: string }>, lang: string): Promise<void> {
    const res: DropdownTextItem[] = []
    for (const key of keys) {
      const fieldKey = parseCustomFieldViewKey(key)
      if (fieldKey !== undefined) {
        res.push({ id: key, label: fields.find((f) => f.key === fieldKey)?.label ?? fieldKey })
      } else {
        const label = builtinLabels[key as keyof typeof builtinLabels]
        res.push({ id: key, label: label !== undefined ? await translate(label, {}, lang) : key })
      }
    }
    items = res
  }
  $: void updateItems(columnFieldKeys({ fields: $registry.fields }), $registry.fields, $themeStore.language)

  function change (next: BoardConfig): void {
    config = next
    dispatch('update', { key: BOARD_OPTION_KEY, value: isDefaultBoardConfig(next) ? undefined : next })
  }
</script>

<div class="antiCard-menu__divider" />
<div class="antiCard-menu__item board-column-field" data-id="board-column-field">
  <span class="overflow-label"><Label label={tracker.string.BoardColumnField} /></span>
  <DropdownLabels
    kind={'regular'}
    size={'medium'}
    {items}
    selected={dimensions.columnKey}
    enableSearch={false}
    width="10rem"
    justify="left"
    on:selected={(e) => {
      if (e.detail !== dimensions.columnKey) change(withColumnField(config, e.detail))
    }}
  />
</div>
{#if hiddenCount > 0}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="antiCard-menu__item hoverable"
    data-id="board-show-hidden-columns"
    on:click={() => {
      change(withAllColumnsShown(config, dimensions.columnKey))
    }}
  >
    <span class="overflow-label"><Label label={tracker.string.BoardShowHiddenColumns} params={{ count: hiddenCount }} /></span>
  </div>
{/if}
{#if limitCount > 0}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="antiCard-menu__item hoverable"
    data-id="board-clear-column-limits"
    on:click={() => {
      change(withoutColumnLimits(config, dimensions.columnKey))
    }}
  >
    <span class="overflow-label"><Label label={tracker.string.BoardClearColumnLimits} params={{ count: limitCount }} /></span>
  </div>
{/if}
