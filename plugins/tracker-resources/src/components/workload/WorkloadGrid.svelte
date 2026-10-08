<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Person } from '@hcengineering/contact'
  import { Avatar } from '@hcengineering/contact-resources'
  import { Label, tooltip } from '@hcengineering/ui'
  import { createEventDispatcher, onMount, tick } from 'svelte'

  import {
    COLUMN_WIDTH,
    formatBucketLabel,
    formatBucketRange,
    formatHeaderGroup,
    headerGroups,
    scrollLeftForBucket,
    visibleBucketRange,
    type WorkloadAxis
  } from '../../workload/axis'
  import { loadState, utilization, type LoadState, type RowSummary } from '../../workload/compute'
  import type { LoadMeasure } from '../../workload/config'
  import { formatAmount, formatLoadValue, formatPercent } from '../../workload/format'
  import tracker from '../../plugin'
  import type { CellRef, GridRow } from './types'

  export let axis: WorkloadAxis
  export let rows: GridRow[]
  // Capacity of every bucket (what one person can take in it)
  export let capacities: ArrayLike<number>
  export let measure: LoadMeasure
  export let locale: string | undefined = undefined
  // The people of the rows, for the avatars
  export let people: Map<string, Person> = new Map()
  // Translated state names and the text for a bucket without capacity
  export let stateNames: Record<LoadState, string>
  export let noCapacityText: string
  export let selected: CellRef | undefined = undefined
  // The row an item that is dragged is over
  export let dropRow: string | undefined = undefined
  // Day on which the today line is drawn
  export let today: number
  // Accessible name of the grid, already translated
  export let label: string = ''

  const dispatch = createEventDispatcher<{ select: CellRef, open: { row: string } }>()

  // Widths of the columns that stay on the left while the timeline scrolls
  const NAME_WIDTH = 224
  const UNSCHEDULED_WIDTH = 96
  const FIXED_WIDTH = NAME_WIDTH + UNSCHEDULED_WIDTH

  let scroller: HTMLDivElement | undefined
  let scrollLeft = 0
  let viewportWidth = 0

  $: columnWidth = COLUMN_WIDTH[axis.zoom]
  $: trackWidth = axis.buckets.length * columnWidth
  $: groups = headerGroups(axis)
  $: visible = visibleBucketRange(scrollLeft, Math.max(0, viewportWidth - FIXED_WIDTH), columnWidth, axis.buckets.length)
  $: visibleBuckets = visible.to >= visible.from ? axis.buckets.slice(visible.from, visible.to + 1) : []
  $: visibleGroups = groups.filter((g) => g.from + g.count - 1 >= visible.from && g.from <= visible.to)

  // The today line sits inside the bucket that contains today, at the share of the bucket that has passed
  $: todayX = (() => {
    const bucket = axis.todayIndex >= 0 ? axis.buckets[axis.todayIndex] : undefined
    if (bucket === undefined) return undefined
    const share = axis.zoom === 'day' ? 0 : (today - bucket.start) / (bucket.end - bucket.start)
    return bucket.index * columnWidth + share * columnWidth
  })()

  // The timeline follows today until the viewer scrolls it themselves (the axis grows to the left when items load)
  let followToday = true
  let programmaticLeft = 0

  function onScroll (): void {
    scrollLeft = scroller?.scrollLeft ?? 0
    if (Math.abs(scrollLeft - programmaticLeft) > 1) followToday = false
  }

  /** Scrolls the timeline so that the bucket of today is in view. */
  export async function scrollToToday (): Promise<void> {
    await tick()
    if (scroller === undefined || axis.todayIndex < 0) return
    followToday = true
    scroller.scrollLeft = scrollLeftForBucket(
      axis.todayIndex,
      columnWidth,
      Math.max(0, scroller.clientWidth - FIXED_WIDTH),
      trackWidth
    )
    programmaticLeft = scroller.scrollLeft
    scrollLeft = scroller.scrollLeft
  }

  onMount(() => {
    void scrollToToday()
  })

  // Another zoom is another axis: the viewer is taken to today. A change of the axis of the same zoom (the items
  // loaded and the axis grew) moves today only for a timeline that nobody scrolled.
  let lastZoom = axis.zoom
  let lastTodayIndex = axis.todayIndex
  $: if (axis.zoom !== lastZoom) {
    lastZoom = axis.zoom
    lastTodayIndex = axis.todayIndex
    void scrollToToday()
  } else if (axis.todayIndex !== lastTodayIndex) {
    lastTodayIndex = axis.todayIndex
    if (followToday) void scrollToToday()
  }

  function isSelected (sel: CellRef | undefined, row: string, bucket: number | 'unscheduled'): boolean {
    return sel !== undefined && sel.row === row && sel.bucket === bucket
  }

  function stateOf (load: number, capacity: number): LoadState {
    return loadState(load, capacity)
  }

  function percentText (load: number, capacity: number): string {
    const u = utilization(load, capacity)
    return u === undefined ? noCapacityText : formatPercent(u, locale)
  }

  function cellParams (row: GridRow, bucketIndex: number): Record<string, string> {
    const bucket = axis.buckets[bucketIndex]
    const load = row.load.loads[bucketIndex]
    const capacity = capacities[bucketIndex]
    return {
      person: row.info.name,
      period: formatBucketRange(axis.zoom, bucket, locale),
      load: formatLoadValue(load, measure, locale, 2),
      capacity: formatLoadValue(capacity, measure, locale, 2),
      percent: percentText(load, capacity),
      state: stateNames[stateOf(load, capacity)]
    }
  }

  function rowSummaryText (summary: RowSummary): string {
    return formatLoadValue(summary.total, measure, locale, 1)
  }

  function onCellKey (ev: KeyboardEvent): void {
    // Arrow keys move between the cells of the visible part of the timeline
    const target = ev.target as HTMLElement
    const key = ev.key
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return
    const row = target.closest<HTMLElement>('[data-id="workload-row"]')
    if (row === null || target.dataset.cell === undefined) return
    ev.preventDefault()
    const raw = target.dataset.bucket ?? ''
    let next: HTMLElement | null = null
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const step = key === 'ArrowLeft' ? -1 : 1
      // From the unscheduled cell the right arrow goes to the first cell of the timeline
      let i = raw === 'unscheduled' ? (step > 0 ? visible.from : visible.to + 1) : Number(raw) + step
      for (; i >= visible.from && i <= visible.to; i += step) {
        next = row.querySelector<HTMLElement>(`[data-cell][data-bucket="${i}"]`)
        if (next !== null) break
      }
    } else {
      let sibling = (key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling) as HTMLElement | null
      while (sibling !== null && next === null) {
        next = sibling.querySelector<HTMLElement>(`[data-cell][data-bucket="${raw}"]`)
        sibling = (key === 'ArrowUp' ? sibling.previousElementSibling : sibling.nextElementSibling) as HTMLElement | null
      }
    }
    next?.focus()
  }
</script>

<div
  class="workload-grid"
  bind:this={scroller}
  bind:clientWidth={viewportWidth}
  on:scroll={onScroll}
  data-id="workload-grid"
  role="grid"
  aria-label={label}
>
  <div class="canvas" style:width="{FIXED_WIDTH + trackWidth}px">
    <div class="head" role="row">
      <div class="fixed name-head" style:width="{NAME_WIDTH}px" role="columnheader">
        <Label label={tracker.string.Assignee} />
      </div>
      <div class="fixed unscheduled-head" style:left="{NAME_WIDTH}px" style:width="{UNSCHEDULED_WIDTH}px" role="columnheader">
        <Label label={tracker.string.RoadmapUnscheduled} />
      </div>
      <div class="track head-track" style:width="{trackWidth}px">
        <div class="groups">
          {#each visibleGroups as group (group.from)}
            <div class="group" style:left="{group.from * columnWidth}px" style:width="{group.count * columnWidth}px">
              <span class="group-label">{formatHeaderGroup(group, locale)}</span>
            </div>
          {/each}
        </div>
        <div class="buckets">
          {#each visibleBuckets as bucket (bucket.index)}
            <div
              class="bucket-head"
              class:today={bucket.index === axis.todayIndex}
              class:nonworking={capacities[bucket.index] === 0}
              style:left="{bucket.index * columnWidth}px"
              style:width="{columnWidth}px"
              role="columnheader"
              aria-current={bucket.index === axis.todayIndex ? 'date' : undefined}
              title={formatBucketRange(axis.zoom, bucket, locale)}
            >
              {formatBucketLabel(axis.zoom, bucket, locale)}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="body" on:keydown={onCellKey} role="presentation">
      {#each rows as row (row.info.key)}
        {@const person = people.get(row.info.key)}
        <div
          class="row"
          class:drop-target={dropRow === row.info.key}
          data-id="workload-row"
          data-row={row.info.key}
          role="row"
        >
          <div class="fixed name-cell" style:width="{NAME_WIDTH}px" role="rowheader">
            <div class="avatar">
              {#if person !== undefined}
                <Avatar {person} name={person.name} size={'small'} />
              {/if}
            </div>
            <div class="person">
              <span class="person-name" class:muted={row.info.unassigned} title={row.info.name}>{row.info.name}</span>
              <span class="person-total" data-id="workload-row-total">
                {#if row.summary.activeFrom >= 0}
                  <span class={`state-text ${row.summary.state}`}>{rowSummaryText(row.summary)}</span>
                  {#if row.summary.utilization !== undefined}
                    · <Label
                      label={tracker.string.WorkloadUtilization}
                      params={{ percent: formatPercent(row.summary.utilization, locale) }}
                    />
                  {:else}
                    · {noCapacityText}
                  {/if}
                {:else}
                  <span class="muted">{formatLoadValue(0, measure, locale)}</span>
                {/if}
              </span>
              {#if row.summary.overCount > 0}
                <span class="person-over" data-id="workload-row-over">
                  <span class="mark" aria-hidden="true">!</span>
                  <Label label={tracker.string.WorkloadOverBuckets} params={{ count: row.summary.overCount }} />
                </span>
              {/if}
              {#if row.load.noLoadCount > 0}
                <span class="person-note" data-id="workload-row-noload">
                  <Label label={tracker.string.WorkloadNoLoadItems} params={{ count: row.load.noLoadCount }} />
                </span>
              {/if}
            </div>
          </div>
          <div
            class="fixed unscheduled-cell"
            style:left="{NAME_WIDTH}px"
            style:width="{UNSCHEDULED_WIDTH}px"
            role="gridcell"
          >
            {#if row.load.unscheduledCount > 0}
              <button
                class="cell-button unscheduled"
                class:selected={isSelected(selected, row.info.key, 'unscheduled')}
                type="button"
                data-cell
                data-bucket="unscheduled"
                data-id="workload-unscheduled-cell"
                on:click={() => {
                  dispatch('select', { row: row.info.key, bucket: 'unscheduled' })
                }}
              >
                <span class="value">{formatLoadValue(row.load.unscheduledLoad, measure, locale)}</span>
                <span class="sr-only">
                  <Label
                    label={tracker.string.WorkloadUnscheduledCellLabel}
                    params={{
                      person: row.info.name,
                      load: formatLoadValue(row.load.unscheduledLoad, measure, locale, 2),
                      count: row.load.unscheduledCount
                    }}
                  />
                </span>
              </button>
            {/if}
          </div>
          <div class="track" style:width="{trackWidth}px">
            {#each visibleBuckets as bucket (bucket.index)}
              {@const load = row.load.loads[bucket.index]}
              {@const count = row.load.counts[bucket.index]}
              {@const capacity = capacities[bucket.index]}
              {@const state = stateOf(load, capacity)}
              <div
                class="cell"
                class:nonworking={capacity === 0}
                class:today={bucket.index === axis.todayIndex}
                style:left="{bucket.index * columnWidth}px"
                style:width="{columnWidth}px"
                role="gridcell"
              >
                {#if count > 0}
                  <button
                    class="cell-button {state}"
                    class:selected={isSelected(selected, row.info.key, bucket.index)}
                    type="button"
                    data-cell
                    data-bucket={bucket.index}
                    data-state={state}
                    data-id="workload-cell"
                    use:tooltip={{ label: tracker.string.WorkloadCellLabel, props: cellParams(row, bucket.index) }}
                    on:click={() => {
                      dispatch('select', { row: row.info.key, bucket: bucket.index })
                    }}
                  >
                    {#if state === 'over'}<span class="mark" aria-hidden="true">!</span>{/if}
                    <span class="value">{formatAmount(load, locale)}</span>
                    <span class="sr-only">
                      <Label label={tracker.string.WorkloadCellLabel} params={cellParams(row, bucket.index)} />
                    </span>
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
      {#if todayX !== undefined}
        <div class="today-line" style:left="{FIXED_WIDTH + todayX}px" data-id="workload-today-line" aria-hidden="true" />
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  .workload-grid {
    position: relative;
    flex-grow: 1;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    background: var(--theme-bg-color);
  }
  .canvas {
    position: relative;
    min-width: 100%;
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 4;
    display: flex;
    height: 3.25rem;
    background: var(--theme-bg-color);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .body {
    position: relative;
  }
  .row {
    display: flex;
    min-height: 3.75rem;
    border-bottom: 1px solid var(--theme-divider-color);

    &.drop-target {
      background: var(--highlight-select, rgba(75, 107, 251, 0.1));
      box-shadow: inset 0 0 0 2px var(--primary-button-default, #4b6bfb);
    }
  }
  .fixed {
    position: sticky;
    left: 0;
    z-index: 3;
    flex-shrink: 0;
    box-sizing: border-box;
    background: var(--theme-bg-color);
  }
  .name-head,
  .unscheduled-head {
    display: flex;
    align-items: flex-end;
    padding: 0 0.75rem 0.375rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--theme-dark-color);
  }
  .unscheduled-head {
    border-left: 1px solid var(--theme-divider-color);
    border-right: 1px solid var(--theme-divider-color);
  }
  .name-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    padding: 0 0.75rem;
  }
  .avatar {
    display: flex;
    flex-shrink: 0;
    width: 1.5rem;
  }
  .person {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 0.75rem;
    line-height: 1.15rem;
    color: var(--theme-content-color);
  }
  .person-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--theme-caption-color);

    &.muted {
      font-style: italic;
      color: var(--theme-dark-color);
    }
  }
  .person-total,
  .person-over,
  .person-note {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .person-note {
    color: var(--theme-dark-color);
  }
  .person-over {
    font-weight: 500;
    color: var(--theme-error-color, #d1242f);
  }
  .state-text {
    font-weight: 500;

    &.over {
      color: var(--theme-error-color, #d1242f);
    }
  }
  .muted {
    color: var(--theme-dark-color);
  }
  .mark {
    font-weight: 700;
    color: var(--theme-error-color, #d1242f);
  }
  .unscheduled-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border-left: 1px solid var(--theme-divider-color);
    border-right: 1px solid var(--theme-divider-color);
  }
  .track {
    position: relative;
    flex-shrink: 0;
  }
  .groups,
  .buckets {
    position: relative;
    height: 50%;
  }
  .group,
  .bucket-head {
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    overflow: hidden;
    white-space: nowrap;
    border-left: 1px solid var(--theme-divider-color);
  }
  .group {
    display: flex;
    align-items: center;
    padding: 0 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .group-label {
    position: sticky;
    left: 0;
  }
  .bucket-head {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6875rem;
    color: var(--theme-dark-color);

    &.today {
      font-weight: 700;
      color: var(--primary-button-default, #4b6bfb);
      background: var(--highlight-select, rgba(75, 107, 251, 0.1));
    }
    &.nonworking {
      background: var(--theme-button-default, rgba(128, 128, 128, 0.08));
    }
  }
  .cell {
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    padding: 0.25rem;
    border-left: 1px solid var(--theme-divider-color);

    &.nonworking {
      background: var(--theme-button-default, rgba(128, 128, 128, 0.08));
    }
    &.today {
      background: var(--highlight-select, rgba(75, 107, 251, 0.06));
    }
  }
  .cell-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    width: 100%;
    height: 100%;
    padding: 0;
    font-size: 0.8125rem;
    color: var(--theme-caption-color);
    border: 1px solid transparent;
    border-radius: 0.25rem;
    background: transparent;
    cursor: pointer;

    &.under {
      background: var(--workload-under, rgba(63, 185, 80, 0.22));
    }
    &.near {
      background: var(--workload-near, rgba(210, 153, 34, 0.32));
    }
    &.over {
      font-weight: 600;
      background: var(--workload-over, rgba(248, 81, 73, 0.34));
      border-color: var(--theme-error-color, #d1242f);
    }
    &.empty,
    &.unscheduled {
      background: var(--theme-button-default, rgba(128, 128, 128, 0.14));
    }
    &.selected {
      outline: 2px solid var(--primary-button-default, #4b6bfb);
      outline-offset: 1px;
    }
    &:hover {
      filter: brightness(0.95);
    }
    &:focus-visible {
      outline: 2px solid var(--primary-button-focused-border, var(--theme-caption-color));
      outline-offset: 1px;
    }
  }
  .today-line {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 2;
    width: 2px;
    margin-left: -1px;
    background: var(--theme-error-color, #d1242f);
    pointer-events: none;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
