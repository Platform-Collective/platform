<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { IntlString, translate } from '@hcengineering/platform'
  import { Button, eventToHTMLElement, showPopup, Switcher, themeStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { cloneConfig, type RoadmapConfig } from '../../roadmap/config'
  import { type DateSource } from '../../roadmap/dates'
  import { toggleLabelField } from '../../roadmap/label'
  import { toggleMarker } from '../../roadmap/markers'
  import { isRoadmapZoom, ROADMAP_ZOOMS } from '../../roadmap/timeScale'
  import tracker from '../../plugin'
  import RoadmapOptionsPopup from './RoadmapOptionsPopup.svelte'
  import type { OptionSection } from './types'

  export let config: RoadmapConfig
  // Every date source a roadmap can use, with translated labels
  export let sources: DateSource[]
  export let iterationFields: Array<{ key: string, label: string }>
  // Fields that can be shown on an item, with translated labels
  export let labelFields: Array<{ id: string, label: string }>

  const dispatch = createEventDispatcher<{ change: RoadmapConfig, today: undefined }>()

  async function t (label: IntlString, params: Record<string, any> = {}): Promise<string> {
    return await translate(label, params, $themeStore.language)
  }

  function change (next: RoadmapConfig): void {
    dispatch('change', next)
  }

  const zoomLabels: Record<string, IntlString> = {
    month: tracker.string.RoadmapZoomMonth,
    quarter: tracker.string.RoadmapZoomQuarter,
    year: tracker.string.RoadmapZoomYear
  }
  const zoomItems = ROADMAP_ZOOMS.map((zoom) => ({ id: zoom, labelIntl: zoomLabels[zoom] }))

  // The popups act on the config that was current when they were opened plus their own changes
  let working = config
  $: working = config

  function apply (next: RoadmapConfig): void {
    working = next
    change(next)
  }

  async function showDates (ev: MouseEvent): Promise<void> {
    const readOnlyNote = await t(tracker.string.RoadmapReadOnlySource)
    const items = (selected: string): OptionSection['items'] =>
      sources.map((s) => ({
        id: s.id,
        label: s.label,
        checked: s.id === selected,
        note: s.writable ? undefined : readOnlyNote
      }))
    const sections: OptionSection[] = [
      { id: 'start', title: await t(tracker.string.RoadmapStartField), mode: 'single', items: items(config.start) },
      { id: 'target', title: await t(tracker.string.RoadmapTargetField), mode: 'single', items: items(config.target) }
    ]
    showPopup(
      RoadmapOptionsPopup,
      {
        sections,
        hint: await t(tracker.string.RoadmapDatesHint),
        onToggle: (sectionId: string, itemId: string) => {
          const next = cloneConfig(working)
          if (sectionId === 'start') next.start = itemId
          else next.target = itemId
          apply(next)
        }
      },
      eventToHTMLElement(ev)
    )
  }

  async function showMarkers (ev: MouseEvent): Promise<void> {
    const sections: OptionSection[] = [
      {
        id: 'milestones',
        mode: 'multi',
        items: [
          { id: 'milestones', label: await t(tracker.string.RoadmapMarkerMilestones), checked: config.markers.milestones }
        ]
      }
    ]
    if (iterationFields.length > 0) {
      sections.push({
        id: 'iterations',
        title: await t(tracker.string.RoadmapMarkerIterations),
        mode: 'multi',
        items: iterationFields.map((f) => ({
          id: f.key,
          label: f.label,
          checked: config.markers.iterations.includes(f.key)
        }))
      })
    }
    // Dates of the items: the dates of the issue and the Date fields (milestone dates have their own markers)
    const dateSources = sources.filter((s) => s.kind === 'issue' || s.kind === 'field')
    sections.push({
      id: 'dates',
      title: await t(tracker.string.RoadmapMarkerDates),
      mode: 'multi',
      items: dateSources.map((s) => ({ id: s.id, label: s.label, checked: config.markers.dates.includes(s.id) }))
    })
    showPopup(
      RoadmapOptionsPopup,
      {
        sections,
        onToggle: (sectionId: string, itemId: string) => {
          const markers =
            sectionId === 'milestones'
              ? toggleMarker(working.markers, { kind: 'milestones' })
              : toggleMarker(working.markers, { kind: sectionId as 'iterations' | 'dates', id: itemId })
          apply({ ...cloneConfig(working), markers })
        }
      },
      eventToHTMLElement(ev)
    )
  }

  async function showFields (ev: MouseEvent): Promise<void> {
    const all = labelFields.map((f) => f.id)
    const sections: OptionSection[] = [
      {
        id: 'fields',
        mode: 'multi',
        items: labelFields.map((f) => ({ id: f.id, label: f.label, checked: config.fields.includes(f.id) }))
      }
    ]
    showPopup(
      RoadmapOptionsPopup,
      {
        sections,
        onToggle: (_sectionId: string, itemId: string) => {
          apply({ ...cloneConfig(working), fields: toggleLabelField(working.fields, itemId, all) })
        }
      },
      eventToHTMLElement(ev)
    )
  }
</script>

<div class="roadmap-toolbar" data-id="roadmap-toolbar">
  <div class="group">
    <Button
      kind={'ghost'}
      size={'small'}
      label={tracker.string.RoadmapDates}
      dataId={'roadmap-dates'}
      on:click={(ev) => {
        void showDates(ev)
      }}
    />
    <Button
      kind={'ghost'}
      size={'small'}
      label={tracker.string.RoadmapMarkers}
      dataId={'roadmap-markers'}
      on:click={(ev) => {
        void showMarkers(ev)
      }}
    />
    <Button
      kind={'ghost'}
      size={'small'}
      label={tracker.string.RoadmapFields}
      dataId={'roadmap-fields'}
      on:click={(ev) => {
        void showFields(ev)
      }}
    />
  </div>
  <div class="group">
    <Button
      kind={'regular'}
      size={'small'}
      label={tracker.string.RoadmapToday}
      dataId={'roadmap-today'}
      on:click={() => {
        dispatch('today')
      }}
    />
    <Switcher
      name={'roadmap-zoom'}
      kind={'subtle'}
      items={zoomItems}
      selected={config.zoom}
      disabled={false}
      on:select={(ev) => {
        const id = ev.detail?.id
        if (isRoadmapZoom(id) && id !== config.zoom) change({ ...cloneConfig(config), zoom: id })
      }}
    />
  </div>
</div>

<style lang="scss">
  .roadmap-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-shrink: 0;
    padding: 0.375rem 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
