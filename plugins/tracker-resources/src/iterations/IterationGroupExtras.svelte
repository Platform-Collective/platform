<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { translate } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import { computeRollup, getAssignableIterations, type Iteration, type ProjectField } from '@hcengineering/tracker'
  import {
    ButtonIcon,
    eventToHTMLElement,
    IconMoreV,
    Label,
    SelectPopup,
    showPopup,
    themeStore,
    type SelectPopupValueType
  } from '@hcengineering/ui'
  import { statusStore } from '@hcengineering/view-resources'

  import tracker from '../plugin'
  import { moveIterationItems } from './actions'

  // Totals and the "Move items to…" menu in the header of an iteration group
  export let value: string | undefined = undefined
  export let docs: any[] = []
  export let field: ProjectField
  export let iterations: Iteration[] = []
  // Passed by the list, not needed here
  export let space: unknown = undefined
  void space

  const client = getClient()
  const NONE = '__none__'

  $: doneStatuses = new Set<string>(
    [...$statusStore.byId.values()].filter((s) => s.category === task.statusCategory.Won).map((s) => s._id)
  )
  $: rollup = computeRollup(docs, doneStatuses)

  async function openMenu (event: MouseEvent): Promise<void> {
    event.stopPropagation()
    const from = value
    if (from === undefined) return
    const lang = $themeStore.language
    const noIteration = await translate(tracker.string.NoIteration, {}, lang)
    const items: SelectPopupValueType[] = [
      { id: NONE, text: noIteration },
      ...getAssignableIterations(iterations)
        .filter((it) => it._id !== from)
        .map((it) => ({ id: it._id as string, text: it.label }))
    ]
    showPopup(
      SelectPopup,
      { value: items, searchable: true, placeholder: tracker.string.MoveItemsTo },
      eventToHTMLElement(event),
      (id) => {
        if (id === undefined || id === null) return
        void moveIterationItems(client, docs, field, from, id === NONE ? null : String(id)).catch((err) => {
          console.error('Failed to move the items of the iteration', err)
        })
      }
    )
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="flex-row-center flex-gap-2 ml-2" on:click|stopPropagation>
  <span class="content-dark-color fs-small">
    <Label
      label={tracker.string.IterationRollupSummary}
      params={{ done: rollup.done, count: rollup.count, estimation: Math.round(rollup.estimation * 10) / 10 }}
    />
  </span>
  {#if value !== undefined && rollup.count > 0}
    <ButtonIcon
      icon={IconMoreV}
      size={'small'}
      kind={'tertiary'}
      tooltip={{ label: tracker.string.MoveItemsTo }}
      on:click={openMenu}
    />
  {/if}
</div>
