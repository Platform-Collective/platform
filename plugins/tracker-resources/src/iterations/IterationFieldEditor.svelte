<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { translate } from '@hcengineering/platform'
  import {
    getAssignableIterations,
    getIterationState,
    type ProjectField
  } from '@hcengineering/tracker'
  import { Button, eventToHTMLElement, SelectPopup, showPopup, themeStore, type SelectPopupValueType } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../plugin'
  import IterationPresenter from './IterationPresenter.svelte'
  import { iterationsOfField, sharedIterationsStore } from './iterationsStore'

  // Single select of the iterations of a field: the current one is marked, "No iteration" clears the value
  export let field: ProjectField
  export let value: string | null = null
  export let readonly = false

  const dispatch = createEventDispatcher<{ change: string | null }>()

  $: store = sharedIterationsStore(field.space)
  $: iterations = getAssignableIterations(iterationsOfField($store, field))
  $: selected = iterations.find((it) => it._id === value)

  const NONE = '__none__'

  async function open (event: MouseEvent): Promise<void> {
    if (readonly) return
    const now = Date.now()
    const lang = $themeStore.language
    const marker = await translate(tracker.string.IterationCurrentMarker, {}, lang)
    const noIteration = await translate(tracker.string.NoIteration, {}, lang)
    // Current and upcoming first, completed ones last and newest first
    const upcoming = iterations.filter((it) => getIterationState(it, now) !== 'completed')
    const completed = iterations.filter((it) => getIterationState(it, now) === 'completed').reverse()
    const items: SelectPopupValueType[] = [
      { id: NONE, text: noIteration, isSelected: value === null },
      ...[...upcoming, ...completed].map((it) => ({
        id: it._id as string,
        text: getIterationState(it, now) === 'current' ? `${it.label} (${marker})` : it.label,
        isSelected: it._id === value
      }))
    ]
    showPopup(SelectPopup, { value: items, searchable: true }, eventToHTMLElement(event), (id) => {
      if (id === undefined) return
      const next = id === NONE ? null : String(id)
      if (next !== value) dispatch('change', next)
    })
  }
</script>

<Button
  kind={'link'}
  size={'medium'}
  width={'100%'}
  justify={'left'}
  disabled={readonly}
  label={selected === undefined ? tracker.string.NoIteration : undefined}
  on:click={open}
>
  <svelte:fragment slot="content">
    {#if selected !== undefined}
      <IterationPresenter iteration={selected} />
    {/if}
  </svelte:fragment>
</Button>
