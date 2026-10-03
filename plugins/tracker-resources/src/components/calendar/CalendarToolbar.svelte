<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { IntlString, translate } from '@hcengineering/platform'
  import { Button, eventToHTMLElement, IconBack, IconForward, showPopup, Switcher, themeStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import { NO_DATE_SOURCE, type CalendarConfig } from '../../calendar/config'
  import { CALENDAR_MODES, isCalendarMode, type CalendarMode } from '../../calendar/grid'
  import { type DateSource } from '../../roadmap/dates'
  import tracker from '../../plugin'
  import RoadmapOptionsPopup from '../roadmap/RoadmapOptionsPopup.svelte'
  import type { OptionSection } from '../roadmap/types'

  export let config: CalendarConfig
  // Every date source a calendar can use, with translated labels
  export let sources: DateSource[]
  // Title of the month or week that is shown
  export let title: string
  export let unscheduledCount: number = 0
  export let unscheduledOpen: boolean = true

  const dispatch = createEventDispatcher<{
    change: CalendarConfig
    previous: undefined
    next: undefined
    today: undefined
    unscheduled: undefined
  }>()

  async function t (label: IntlString, params: Record<string, any> = {}): Promise<string> {
    return await translate(label, params, $themeStore.language)
  }

  const modeLabels: Record<CalendarMode, IntlString> = {
    month: tracker.string.CalendarMonth,
    week: tracker.string.CalendarWeek,
    agenda: tracker.string.CalendarAgenda
  }
  const modeItems = CALENDAR_MODES.map((mode) => ({ id: mode, labelIntl: modeLabels[mode] }))

  // The popup acts on the config that was current when it was opened plus its own changes
  let working = config
  $: working = config

  function apply (next: CalendarConfig): void {
    working = next
    dispatch('change', next)
  }

  async function showDates (ev: MouseEvent): Promise<void> {
    const readOnlyNote = await t(tracker.string.RoadmapReadOnlySource)
    const noneLabel = await t(tracker.string.CalendarNoDateSource)
    const items = (selected: string): OptionSection['items'] => [
      { id: NO_DATE_SOURCE, label: noneLabel, checked: selected === NO_DATE_SOURCE },
      ...sources.map((s) => ({
        id: s.id,
        label: s.label,
        checked: s.id === selected,
        note: s.writable ? undefined : readOnlyNote
      }))
    ]
    const sections: OptionSection[] = [
      { id: 'start', title: await t(tracker.string.RoadmapStartField), mode: 'single', items: items(config.start) },
      { id: 'target', title: await t(tracker.string.RoadmapTargetField), mode: 'single', items: items(config.target) }
    ]
    showPopup(
      RoadmapOptionsPopup,
      {
        sections,
        hint: await t(tracker.string.CalendarDatesHint),
        onToggle: (sectionId: string, itemId: string) => {
          apply(sectionId === 'start' ? { ...working, start: itemId } : { ...working, target: itemId })
        }
      },
      eventToHTMLElement(ev)
    )
  }
</script>

<div class="calendar-toolbar" data-id="calendar-toolbar">
  <div class="group">
    <Button
      kind={'ghost'}
      size={'small'}
      label={tracker.string.RoadmapDates}
      dataId={'calendar-dates'}
      on:click={(ev) => {
        void showDates(ev)
      }}
    />
    <Button
      kind={'ghost'}
      size={'small'}
      label={tracker.string.CalendarUnscheduledCount}
      labelParams={{ count: unscheduledCount }}
      selected={unscheduledOpen}
      dataId={'calendar-unscheduled'}
      on:click={() => {
        dispatch('unscheduled')
      }}
    />
  </div>
  <div class="group">
    <Button
      kind={'ghost'}
      size={'small'}
      icon={IconBack}
      showTooltip={{ label: tracker.string.CalendarPrevious }}
      dataId={'calendar-previous'}
      on:click={() => {
        dispatch('previous')
      }}
    />
    <Button
      kind={'regular'}
      size={'small'}
      label={tracker.string.RoadmapToday}
      dataId={'calendar-today'}
      on:click={() => {
        dispatch('today')
      }}
    />
    <Button
      kind={'ghost'}
      size={'small'}
      icon={IconForward}
      showTooltip={{ label: tracker.string.CalendarNext }}
      dataId={'calendar-next'}
      on:click={() => {
        dispatch('next')
      }}
    />
    <span class="title" aria-live="polite" data-id="calendar-title">{title}</span>
  </div>
  <div class="group">
    <Switcher
      name={'calendar-mode'}
      kind={'subtle'}
      items={modeItems}
      selected={config.mode}
      disabled={false}
      on:select={(ev) => {
        const id = ev.detail?.id
        if (isCalendarMode(id) && id !== config.mode) dispatch('change', { ...config, mode: id })
      }}
    />
  </div>
</div>

<style lang="scss">
  .calendar-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-shrink: 0;
    flex-wrap: wrap;
    padding: 0.375rem 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .title {
    min-width: 8rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
</style>
