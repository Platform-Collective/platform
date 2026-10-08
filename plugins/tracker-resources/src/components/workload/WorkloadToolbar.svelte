<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { IntlString, translate } from '@hcengineering/platform'
  import { Button, eventToHTMLElement, Label, showPopup, Switcher, themeStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import { NO_DATE_SOURCE } from '../../calendar/config'
  import { type DateSource } from '../../roadmap/dates'
  import { isWorkloadZoom, WORKLOAD_ZOOMS, type WorkloadZoom } from '../../workload/axis'
  import { validCapacity, type LoadMeasure, type WorkloadConfig } from '../../workload/config'
  import tracker from '../../plugin'
  import RoadmapOptionsPopup from '../roadmap/RoadmapOptionsPopup.svelte'
  import type { OptionSection } from '../roadmap/types'

  export let config: WorkloadConfig
  // Every date source a workload can use, with translated labels
  export let sources: DateSource[]
  // The Number fields of the project that can be the load measure
  export let numberFields: Array<{ key: string, label: string }>

  const dispatch = createEventDispatcher<{ change: WorkloadConfig, today: undefined }>()

  async function t (label: IntlString, params: Record<string, any> = {}): Promise<string> {
    return await translate(label, params, $themeStore.language)
  }

  const zoomLabels: Record<WorkloadZoom, IntlString> = {
    day: tracker.string.WorkloadZoomDay,
    week: tracker.string.CalendarWeek,
    month: tracker.string.CalendarMonth
  }
  const zoomItems = WORKLOAD_ZOOMS.map((zoom) => ({ id: zoom, labelIntl: zoomLabels[zoom] }))

  // Texts that are needed as plain strings
  let measureNames: Record<Exclude<LoadMeasure, 'field'>, string> = { estimate: '', remaining: '', count: '' }
  let capacityTitle = ''
  async function loadTexts (lang: string): Promise<void> {
    const [estimate, remaining, count, title] = await Promise.all([
      translate(tracker.string.Estimation, {}, lang),
      translate(tracker.string.RemainingTime, {}, lang),
      translate(tracker.string.WorkloadMeasureCount, {}, lang),
      translate(tracker.string.WorkloadCapacityHint, {}, lang)
    ])
    measureNames = { estimate, remaining, count }
    capacityTitle = title
  }
  $: void loadTexts($themeStore.language)

  $: measureText =
    config.measure === 'field'
      ? numberFields.find((f) => f.key === config.field)?.label ?? ''
      : measureNames[config.measure]

  // The popups act on the config that was current when they were opened plus their own changes
  let working = config
  $: working = config

  function apply (next: WorkloadConfig): void {
    working = next
    dispatch('change', next)
  }

  async function showDates (ev: MouseEvent): Promise<void> {
    const readOnlyNote = await t(tracker.string.RoadmapReadOnlySource)
    const noneLabel = await t(tracker.string.CalendarNoDateSource)
    const items = (selected: string): OptionSection['items'] => [
      { id: NO_DATE_SOURCE, label: noneLabel, checked: selected === NO_DATE_SOURCE },
      // The workload never writes dates, so a source that cannot be written is only a note here
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
        hint: await t(tracker.string.WorkloadDatesHint),
        onToggle: (sectionId: string, itemId: string) => {
          apply(sectionId === 'start' ? { ...working, start: itemId } : { ...working, target: itemId })
        }
      },
      eventToHTMLElement(ev)
    )
  }

  async function showMeasure (ev: MouseEvent): Promise<void> {
    const [estimate, remaining, count, fieldsTitle] = await Promise.all([
      t(tracker.string.Estimation),
      t(tracker.string.RemainingTime),
      t(tracker.string.WorkloadMeasureCount),
      t(tracker.string.CustomFields)
    ])
    const current = (): string => (working.measure === 'field' ? `field:${working.field ?? ''}` : working.measure)
    const sections: OptionSection[] = [
      {
        id: 'measure',
        mode: 'single',
        items: [
          { id: 'estimate', label: estimate, checked: current() === 'estimate' },
          { id: 'remaining', label: remaining, checked: current() === 'remaining' },
          { id: 'count', label: count, checked: current() === 'count' }
        ]
      }
    ]
    if (numberFields.length > 0) {
      sections.push({
        id: 'measure',
        title: fieldsTitle,
        mode: 'single',
        items: numberFields.map((f) => ({ id: `field:${f.key}`, label: f.label, checked: current() === `field:${f.key}` }))
      })
    }
    showPopup(
      RoadmapOptionsPopup,
      {
        sections,
        onToggle: (_sectionId: string, itemId: string) => {
          if (itemId.startsWith('field:')) apply({ ...working, measure: 'field', field: itemId.slice('field:'.length) })
          else apply({ ...working, measure: itemId as Exclude<LoadMeasure, 'field'>, field: undefined })
        }
      },
      eventToHTMLElement(ev)
    )
  }

  // The capacity is typed in a field and applied when the field is left or Enter is pressed; a value that is not a number
  // above zero goes back to the current one
  let capacityText = String(config.capacity)
  $: capacityText = String(config.capacity)

  function commitCapacity (): void {
    const value = validCapacity(capacityText)
    if (value === undefined) {
      capacityText = String(config.capacity)
      return
    }
    capacityText = String(value)
    if (value !== config.capacity) apply({ ...working, capacity: value })
  }
</script>

<div class="workload-toolbar" data-id="workload-toolbar">
  <div class="group">
    <Button
      kind={'ghost'}
      size={'small'}
      label={tracker.string.RoadmapDates}
      dataId={'workload-dates'}
      on:click={(ev) => {
        void showDates(ev)
      }}
    />
    <Button
      kind={'ghost'}
      size={'small'}
      dataId={'workload-measure'}
      title={measureText}
      on:click={(ev) => {
        void showMeasure(ev)
      }}
    >
      <svelte:fragment slot="content">
        <span class="measure"><Label label={tracker.string.WorkloadMeasure} />: {measureText}</span>
      </svelte:fragment>
    </Button>
    <label class="capacity" title={capacityTitle}>
      <span class="capacity-label"><Label label={tracker.string.WorkloadCapacity} /></span>
      <input
        class="capacity-input"
        type="number"
        min="0.25"
        step="0.5"
        inputmode="decimal"
        data-id="workload-capacity"
        bind:value={capacityText}
        on:change={commitCapacity}
        on:keydown={(ev) => {
          if (ev.key === 'Enter') commitCapacity()
        }}
      />
    </label>
  </div>
  <div class="group">
    <ul class="legend" data-id="workload-legend">
      <li><span class="swatch under" /><Label label={tracker.string.WorkloadStateUnder} /></li>
      <li><span class="swatch near" /><Label label={tracker.string.WorkloadStateNear} /></li>
      <li><span class="swatch over" /><span class="mark">!</span><Label label={tracker.string.WorkloadStateOver} /></li>
    </ul>
    <Button
      kind={'regular'}
      size={'small'}
      label={tracker.string.RoadmapToday}
      dataId={'workload-today'}
      on:click={() => {
        dispatch('today')
      }}
    />
    <Switcher
      name={'workload-zoom'}
      kind={'subtle'}
      items={zoomItems}
      selected={config.zoom}
      disabled={false}
      on:select={(ev) => {
        const id = ev.detail?.id
        if (isWorkloadZoom(id) && id !== config.zoom) dispatch('change', { ...config, zoom: id })
      }}
    />
  </div>
</div>

<style lang="scss">
  .workload-toolbar {
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
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .measure {
    white-space: nowrap;
  }
  .capacity {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);
  }
  .capacity-input {
    width: 4rem;
    height: 1.5rem;
    padding: 0 0.375rem;
    color: var(--theme-caption-color);
    background: transparent;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;

    &:focus-visible {
      outline: 2px solid var(--primary-button-focused-border, var(--theme-caption-color));
    }
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.75rem;
    color: var(--theme-content-color);

    li {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
  }
  .swatch {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 0.1875rem;

    &.under {
      background: var(--workload-under, rgba(63, 185, 80, 0.35));
    }
    &.near {
      background: var(--workload-near, rgba(210, 153, 34, 0.45));
    }
    &.over {
      background: var(--workload-over, rgba(248, 81, 73, 0.5));
    }
  }
  .mark {
    font-weight: 700;
    color: var(--theme-error-color, #d1242f);
  }
</style>
