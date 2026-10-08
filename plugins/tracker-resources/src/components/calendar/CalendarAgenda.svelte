<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref, WithLookup } from '@hcengineering/core'
  import type { Issue, Project } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'
  import type { BuildModelKey } from '@hcengineering/view'
  import { showMenu } from '@hcengineering/view-resources'

  import type { AgendaDay } from '../../calendar/agenda'
  import { formatDayShort } from '../../calendar/grid'
  import tracker from '../../plugin'
  import CardFieldRenderer from '../board/CardFieldRenderer.svelte'

  // The agenda: the days of the month that have items, each with the items as cards (the fields of the view)
  export let days: Array<AgendaDay<Issue>>
  export let config: Array<string | BuildModelKey>
  export let space: Ref<Project> | undefined = undefined
  export let locale: string | undefined = undefined
  export let today: number
  export let colorOf: (issue: Issue) => string
</script>

<div class="agenda" data-id="calendar-agenda">
  {#each days as { day, entries } (day)}
    <section class="day" class:today={day === today} data-day={day}>
      <h3 class="heading">
        <span class="date">{formatDayShort(day, locale)}</span>
        <span class="count">{entries.length}</span>
      </h3>
      <div class="entries">
        {#each entries as entry (entry.event.id)}
          {@const issue = entry.event.item}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="entry"
            class:continues-before={!entry.first}
            class:continues-after={!entry.last}
            style:--item-color={colorOf(issue)}
            data-id="calendar-agenda-item"
            on:contextmenu={(ev) => {
              showMenu(ev, { object: issue })
            }}
          >
            <CardFieldRenderer issue={issue} {config} {space} />
          </div>
        {/each}
      </div>
    </section>
  {:else}
    <div class="empty"><Label label={tracker.string.CalendarAgendaEmpty} /></div>
  {/each}
</div>

<style lang="scss">
  .agenda {
    flex-grow: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.5rem 1rem 1rem;
  }
  .day {
    display: flex;
    gap: 1rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .heading {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 7rem;
    margin: 0;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .day.today .date {
    color: var(--theme-error-color, #d73a49);
  }
  .count {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--theme-dark-color);
  }
  .entries {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    gap: 0.5rem;
    min-width: 0;
    max-width: 40rem;
  }
  .entry {
    border: 1px solid var(--theme-divider-color);
    border-left: 3px solid var(--item-color);
    border-radius: 0.375rem;
    background: var(--theme-bg-color);
    cursor: pointer;

    &.continues-before {
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
    }
    &:hover {
      background: var(--theme-table-row-hover, var(--theme-bg-accent-color));
    }
  }
  .empty {
    padding: 4rem 1rem;
    text-align: center;
    color: var(--theme-dark-color);
  }
</style>
