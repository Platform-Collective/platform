<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import {
    daysToDuration,
    durationToDays,
    formatIterationRange,
    iterationEnd,
    startOfDay,
    type Iteration,
    type IterationDurationUnit
  } from '@hcengineering/tracker'
  import { ButtonIcon, DropdownLabelsIntl, EditBox, IconAdd, IconDelete, themeStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../plugin'

  export let iteration: Iteration
  // Completed iterations keep their dates
  export let datesLocked = false

  const dispatch = createEventDispatcher<{
    change: { label?: string, startDate?: number, duration?: number }
    insertBreak: undefined
    remove: undefined
  }>()

  const unitItems = [
    { id: 'days', label: tracker.string.IterationDurationDays },
    { id: 'weeks', label: tracker.string.IterationDurationWeeks }
  ]

  let amount = 0
  let unit: IterationDurationUnit = 'days'
  $: ({ amount, unit } = daysToDuration(iteration.duration))

  $: range = formatIterationRange(iteration, Date.now(), $themeStore.language)

  function pad (n: number): string {
    return String(n).padStart(2, '0')
  }

  function toInput (ts: number): string {
    const d = new Date(ts)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  function fromInput (raw: string): number | undefined {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
    return m === null ? undefined : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  }

  function commitLabel (e: CustomEvent<string>): void {
    const label = e.detail.trim()
    if (label !== iteration.label) dispatch('change', { label })
  }

  function commitStart (raw: string): void {
    const start = fromInput(raw)
    if (start === undefined || start === startOfDay(iteration.startDate)) return
    dispatch('change', { startDate: start })
  }

  function commitDuration (nextAmount: number, nextUnit: IterationDurationUnit): void {
    const days = durationToDays(nextAmount, nextUnit)
    if (days !== iteration.duration) dispatch('change', { duration: days })
    else ({ amount, unit } = daysToDuration(iteration.duration))
  }

  function onAmount (e: CustomEvent<string | number>): void {
    const parsed = Number(String(e.detail).trim())
    commitDuration(Number.isFinite(parsed) ? parsed : 0, unit)
  }

  function onUnit (e: CustomEvent<IterationDurationUnit | undefined>): void {
    if (e.detail === undefined) return
    unit = e.detail
    commitDuration(amount, e.detail)
  }

  // The tooltip of the date field shows the whole range
  $: lastDay = toInput(iterationEnd(iteration))
</script>

<div class="row" class:break={iteration.isBreak === true}>
  <div class="title">
    <EditBox
      kind={'default'}
      placeholder={tracker.string.IterationTitlePlaceholder}
      value={iteration.label}
      on:blur={commitLabel}
    />
  </div>
  <input
    type="date"
    aria-label="start"
    title={`${range} (${lastDay})`}
    disabled={datesLocked}
    value={toInput(iteration.startDate)}
    on:change={(e) => commitStart(e.currentTarget.value)}
  />
  <div class="amount">
    <EditBox kind={'default'} format={'number'} minValue={1} disabled={datesLocked} value={amount} on:blur={onAmount} />
  </div>
  <DropdownLabelsIntl
    kind={'regular'}
    size={'medium'}
    width={'5.5rem'}
    items={unitItems}
    selected={unit}
    disabled={datesLocked}
    on:selected={onUnit}
  />
  <ButtonIcon
    icon={IconAdd}
    size={'small'}
    kind={'tertiary'}
    tooltip={{ label: tracker.string.InsertIterationBreak }}
    on:click={() => dispatch('insertBreak')}
  />
  <ButtonIcon
    icon={IconDelete}
    size={'small'}
    kind={'tertiary'}
    tooltip={{ label: tracker.string.DeleteIteration }}
    on:click={() => dispatch('remove')}
  />
</div>

<style lang="scss">
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.125rem 0;
    &.break .title {
      font-style: italic;
      opacity: 0.8;
    }
  }
  .title {
    flex: 1 1 auto;
    min-width: 6rem;
  }
  .amount {
    width: 3.5rem;
    flex-shrink: 0;
  }
  input[type='date'] {
    padding: 0.25rem 0.5rem;
    color: var(--theme-caption-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
  }
</style>
