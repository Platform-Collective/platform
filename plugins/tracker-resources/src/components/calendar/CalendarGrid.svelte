<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import type { Issue } from '@hcengineering/tracker'
  import { createEventDispatcher } from 'svelte'

  import type { CardFieldPlan } from '../../board/cardFields'
  import { isMultiDay, layoutWeek, type CalendarEvent } from '../../calendar/events'
  import { DAYS_IN_WEEK, type CalendarDay, type CalendarWeek } from '../../calendar/grid'
  import type { ItemSchedule } from '../../roadmap/dates'
  import type { RescheduleMode } from '../../roadmap/reschedule'
  import tracker from '../../plugin'
  import CalendarEventChip from './CalendarEventChip.svelte'

  // The month grid (weeks of cells) and the week view (one tall week). Items are drawn over the cells: bars across the days
  // they span, chips inside a day; what does not fit in a month cell is left out and counted in "+N more".
  export let weeks: CalendarWeek[]
  export let events: Array<CalendarEvent<Issue>>
  export let mode: 'month' | 'week'
  export let weekdays: string[]
  export let locale: string | undefined = undefined
  export let plan: CardFieldPlan
  // The day with the keyboard focus
  export let focusDay: number
  // The day a drag would drop on
  export let dropDay: number | undefined = undefined
  // The item that is dragged right now
  export let draggingId: string | undefined = undefined
  export let scheduleOf: (issue: Issue) => ItemSchedule
  export let colorOf: (issue: Issue) => string
  export let labelOf: (issue: Issue) => string
  export let canDrag: (issue: Issue, mode: RescheduleMode) => boolean

  // Height of the day number row and of a lane (a chip and the gap below it), in pixels
  const DAY_HEADER = 26
  const LANE_HEIGHT = 22
  const CELL_PADDING = 4

  const dispatch = createEventDispatcher<{
    press: { issue: Issue, mode: RescheduleMode, event: PointerEvent }
    open: { issue: Issue }
    menu: { issue: Issue, event: MouseEvent }
    dayclick: { day: number, element: HTMLElement }
    more: { day: number, element: HTMLElement }
    key: { day: number, event: KeyboardEvent, element: HTMLElement }
  }>()

  let bodyHeight = 0
  // How many lanes fit in a cell of the month grid; the week view grows with its items instead
  $: capacity =
    mode === 'week' || weeks.length === 0 || bodyHeight === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor((bodyHeight / weeks.length - DAY_HEADER - CELL_PADDING) / LANE_HEIGHT))

  $: layouts = weeks.map((week) => ({ week, layout: layoutWeek(events, week.startDay, capacity) }))

  $: dayLabel = (day: number): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(day * 86400000))

  const monthFormat = (cell: CalendarDay): string =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(cell.year, cell.month, 1)))

  function cellClick (ev: MouseEvent, cell: CalendarDay): void {
    dispatch('dayclick', { day: cell.day, element: ev.currentTarget as HTMLElement })
  }

  function cellKey (ev: KeyboardEvent, cell: CalendarDay): void {
    // Keys of an item or of a link inside the cell are theirs
    if (ev.target !== ev.currentTarget) return
    dispatch('key', { day: cell.day, event: ev, element: ev.currentTarget as HTMLElement })
  }

  function weekHeight (laneCount: number): string {
    return mode === 'week' ? `${DAY_HEADER + Math.max(laneCount, 3) * LANE_HEIGHT + CELL_PADDING + LANE_HEIGHT}px` : ''
  }
</script>

<div class="calendar-grid" class:week-mode={mode === 'week'} role="grid" data-id="calendar-grid">
  <div class="weekdays" role="row">
    {#each weekdays as name}
      <div class="weekday" role="columnheader">{name}</div>
    {/each}
  </div>
  <div class="weeks" bind:clientHeight={bodyHeight}>
    {#each layouts as { week, layout } (week.startDay)}
      <div class="week" role="row" style:min-height={weekHeight(layout.laneCount)}>
        <div class="cells">
          {#each week.days as cell (cell.day)}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
              class="cell"
              class:other-month={!cell.inMonth}
              class:weekend={cell.weekend}
              class:today={cell.today}
              class:drop={dropDay === cell.day}
              role="gridcell"
              tabindex={cell.day === focusDay ? 0 : -1}
              aria-selected={cell.day === focusDay}
              aria-label={dayLabel(cell.day)}
              data-day={cell.day}
              data-id="calendar-day"
              on:click={(ev) => {
                cellClick(ev, cell)
              }}
              on:keydown={(ev) => {
                cellKey(ev, cell)
              }}
            >
              <span class="date" class:today-badge={cell.today}>
                {#if cell.date === 1 && mode === 'month'}{monthFormat(cell)}&nbsp;{/if}{cell.date}
              </span>
            </div>
          {/each}
        </div>
        <div class="overlay">
          {#each layout.segments as seg (seg.event.id)}
            {#if !seg.hidden}
              {@const issue = seg.event.item}
              {@const schedule = scheduleOf(issue)}
              {@const resizable = schedule.kind === 'range' && !schedule.inverted}
              <div
                class="segment"
                style:top="{DAY_HEADER + seg.lane * LANE_HEIGHT}px"
                style:left="calc({(seg.col / DAYS_IN_WEEK) * 100}% + {seg.continuesBefore ? 0 : 3}px)"
                style:width="calc({(seg.span / DAYS_IN_WEEK) * 100}% - {(seg.continuesBefore ? 0 : 3) + (seg.continuesAfter ? 0 : 3)}px)"
                style:height="{LANE_HEIGHT - 2}px"
              >
                <CalendarEventChip
                  {issue}
                  color={colorOf(issue)}
                  label={labelOf(issue)}
                  showAssignee={plan.assignee}
                  showPriority={plan.chips.some((c) => c.kind === 'builtin' && c.id === 'priority')}
                  multiDay={isMultiDay(seg.event)}
                  continuesBefore={seg.continuesBefore}
                  continuesAfter={seg.continuesAfter}
                  inverted={seg.event.inverted}
                  draggable={canDrag(issue, 'move')}
                  resizeStart={resizable && canDrag(issue, 'resize-start')}
                  resizeEnd={resizable && canDrag(issue, 'resize-end')}
                  dragging={draggingId === issue._id}
                  on:press={(e) => {
                    dispatch('press', { issue, mode: e.detail.mode, event: e.detail.event })
                  }}
                  on:open={() => {
                    dispatch('open', { issue })
                  }}
                  on:menu={(e) => {
                    dispatch('menu', { issue, event: e.detail })
                  }}
                />
              </div>
            {/if}
          {/each}
          {#each layout.hiddenByColumn as count, col}
            {#if count > 0}
              <button
                class="more"
                type="button"
                style:top="{DAY_HEADER + layout.visibleLanes * LANE_HEIGHT}px"
                style:left="calc({(col / DAYS_IN_WEEK) * 100}% + 3px)"
                style:width="calc({100 / DAYS_IN_WEEK}% - 6px)"
                style:height="{LANE_HEIGHT - 2}px"
                data-id="calendar-more"
                on:click={(ev) => {
                  dispatch('more', { day: layout.startDay + col, element: ev.currentTarget })
                }}
              >
                <Label label={tracker.string.CalendarMore} params={{ count }} />
              </button>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style lang="scss">
  .calendar-grid {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-height: 0;
    min-width: 0;
  }
  .weekdays {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    flex-shrink: 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .weekday {
    padding: 0.375rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    color: var(--theme-dark-color);
  }
  .weeks {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .week {
    position: relative;
    display: flex;
    flex: 1 1 0;
    min-height: 5.5rem;
    border-bottom: 1px solid var(--theme-divider-color);

    .week-mode & {
      flex: 1 0 auto;
    }
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    flex-grow: 1;
  }
  .cell {
    min-width: 0;
    padding: 0.25rem 0.375rem;
    border-right: 1px solid var(--theme-divider-color);
    cursor: pointer;
    outline: none;

    &:last-child {
      border-right: none;
    }
    &.weekend {
      background: var(--theme-bg-accent-color, rgba(128, 128, 128, 0.06));
    }
    &.other-month .date {
      color: var(--theme-dark-color);
      opacity: 0.6;
    }
    &:hover {
      background: var(--theme-table-row-hover, var(--theme-bg-accent-color));
    }
    &.drop {
      background: var(--theme-button-hovered, rgba(75, 107, 251, 0.15));
      box-shadow: inset 0 0 0 2px var(--primary-button-default, #4b6bfb);
    }
    &:focus-visible {
      box-shadow: inset 0 0 0 2px var(--primary-button-focused-border, var(--theme-caption-color));
    }
  }
  .date {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.25rem;
    font-size: 0.75rem;
    color: var(--theme-content-color);
    border-radius: 0.625rem;

    &.today-badge {
      color: #fff;
      font-weight: 600;
      background: var(--theme-error-color, #d73a49);
    }
  }
  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .segment,
  .more {
    position: absolute;
    box-sizing: border-box;
    pointer-events: auto;
  }
  .more {
    padding: 0 0.375rem;
    border: none;
    border-radius: 0.25rem;
    background: transparent;
    text-align: left;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    cursor: pointer;

    &:hover {
      color: var(--theme-caption-color);
      background: var(--theme-button-hovered);
    }
  }
</style>
