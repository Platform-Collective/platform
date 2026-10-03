<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import contact, { getName, type Person } from '@hcengineering/contact'
  import { employeeRefByAccountUuidStore, getAnonymousRefs } from '@hcengineering/contact-resources'
  import { DocumentQuery, FindOptions, generateId, notEmpty, Ref, Space } from '@hcengineering/core'
  import hr from '@hcengineering/hr'
  import { IntlString, translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import { Issue, Iteration, Milestone, Project, ProjectFieldType } from '@hcengineering/tracker'
  import { closePopup, deviceOptionsStore, eventToHTMLElement, Label, showPopup, themeStore } from '@hcengineering/ui'
  import { BuildModelKey, Viewlet, ViewOptions, ViewOptionModel } from '@hcengineering/view'
  import {
    claimResultCountOwner,
    getCategoryQueryNoLookup,
    getResultOptions,
    getResultQuery,
    openDoc,
    releaseResultCountOwner,
    restrictionStore,
    setResultCount,
    setViewOptions,
    showMenu,
    statusStore,
    tableEdit
  } from '@hcengineering/view-resources'
  import { onDestroy } from 'svelte'
  import { readable } from 'svelte/store'

  import { issueTarget, runIssueOps } from '../../bulkEdit/issueCells'
  import { normalizeFirstDay } from '../../calendar/grid'
  import { CalendarStateMachine, type CalendarSnapshot } from '../gantt/lib/calendar-state'
  import { iterationsByFieldKey, sharedIterationsStore } from '../../iterations/iterationsStore'
  import tracker from '../../plugin'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import { buildRegistry } from '../../projectFields/registry'
  import { buildDateSources, resolveSchedule, type DateLookups, type DateSource } from '../../roadmap/dates'
  import { toDay } from '../../roadmap/timeScale'
  import { computeAxis, formatBucketRange } from '../../workload/axis'
  import {
    bucketCapacities,
    cellItems,
    computeWorkload,
    emptyRowLoad,
    scheduleSpan,
    summarizeRow,
    type LoadEntry,
    type LoadState
  } from '../../workload/compute'
  import {
    readWorkloadConfig,
    sanitizeWorkloadConfig,
    withWorkloadConfig,
    workloadSelection,
    type WorkloadConfig
  } from '../../workload/config'
  import { readLoad } from '../../workload/load'
  import { planReassign, type ReassignPlan } from '../../workload/reassign'
  import { orderRows, rowKeyOf, UNASSIGNED_ROW } from '../../workload/rows'
  import { DEFAULT_WORKING_CALENDAR, effectiveWorkingCalendar, WorkdayIndex } from '../../workload/workdays'
  import RoadmapOptionsPopup from '../roadmap/RoadmapOptionsPopup.svelte'
  import type { OptionSection } from '../roadmap/types'
  import type { CellRef, GridRow, PanelItem } from './types'
  import WorkloadGrid from './WorkloadGrid.svelte'
  import WorkloadPanel from './WorkloadPanel.svelte'
  import WorkloadToolbar from './WorkloadToolbar.svelte'

  export let space: Ref<Space> | undefined = undefined
  export let query: DocumentQuery<Issue> = {}
  export let viewOptions: ViewOptions
  export let viewlet: Viewlet
  export let viewOptionsConfig: ViewOptionModel[] | undefined = undefined
  export let options: FindOptions<Issue> | undefined = undefined
  // The fields of the view are not used: an item of the workload is a row in the list of a cell
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export let config: Array<string | BuildModelKey> = []

  // Items that are loaded; above it the view says so instead of silently cutting the list
  const ITEM_LIMIT = 5000
  // A pointer movement shorter than this is a click, not a drag
  const DRAG_THRESHOLD_PX = 3
  const TOAST_MS = 8000

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const today = toDay(Date.now())

  $: project = space as Ref<Project> | undefined

  // ---- project data ----
  const emptyRegistry = readable(buildRegistry([]))
  const noIterations = readable<Iteration[]>([])
  $: registry = project !== undefined ? sharedProjectFieldsStore(project) : emptyRegistry
  $: iterationsStore = project !== undefined ? sharedIterationsStore(project) : noIterations
  $: iterationsByKey = iterationsByFieldKey($iterationsStore, $registry.fields)

  let milestones: Milestone[] = []
  const milestoneQuery = createQuery()
  $: milestoneQuery.query(tracker.class.Milestone, project !== undefined ? { space: project } : {}, (res) => {
    milestones = res
  })
  $: milestoneById = new Map(milestones.map((m) => [m._id as string, m]))

  // The members of the project are rows even when they have no work yet: that is where free capacity shows
  let projectDoc: Project | undefined
  const projectQuery = createQuery()
  $: if (project !== undefined) {
    projectQuery.query(tracker.class.Project, { _id: project }, (res) => {
      projectDoc = res[0]
    })
  } else {
    projectQuery.unsubscribe()
    projectDoc = undefined
  }
  $: anonymous = new Set<string>(getAnonymousRefs($employeeRefByAccountUuidStore, []))
  $: memberRows = (projectDoc?.members ?? [])
    .map((m) => $employeeRefByAccountUuidStore.get(m) as string | undefined)
    .filter(notEmpty)
    .filter((id) => !anonymous.has(id))

  // ---- working days of the project (the calendar of the Gantt) ----
  const hrModelPresent = hierarchy.hasClass(hr.class.PublicHoliday)
  const calendarConfigQuery = createQuery()
  const hrDepartmentQuery = createQuery()
  const hrHolidayQuery = createQuery()
  let calendarSnapshot: CalendarSnapshot = { ready: false, mutable: false, cfg: undefined, holidays: [] }
  const calendarState = new CalendarStateMachine(
    { project: calendarConfigQuery, departments: hrDepartmentQuery, holidays: hrHolidayQuery },
    hrModelPresent,
    { project: tracker.class.Project, department: hr.class.Department, holiday: hr.class.PublicHoliday },
    hr.ids.Head,
    (snap) => {
      calendarSnapshot = snap
    },
    () => {}
  )
  $: calendarState.setSpace(project)
  // Until the calendar is loaded the default one (Monday to Friday) is used
  $: workingCalendar = effectiveWorkingCalendar(
    calendarSnapshot.ready ? calendarSnapshot.cfg : undefined,
    calendarSnapshot.holidays
  )
  function calendarKey (mask: number, holidays: readonly number[]): string {
    return `${mask}|${[...holidays].sort((a, b) => a - b).join(',')}`
  }
  let indexKey = calendarKey(DEFAULT_WORKING_CALENDAR.weekdayMask, [])
  let workdayIndex = WorkdayIndex.around(today, DEFAULT_WORKING_CALENDAR)
  $: {
    // The index is rebuilt only when the weekdays or the holidays really changed
    const key = calendarKey(workingCalendar.weekdayMask, workingCalendar.holidays)
    if (key !== indexKey) {
      indexKey = key
      workdayIndex = WorkdayIndex.around(today, workingCalendar)
    }
  }

  // ---- texts ----
  const textKeys: Record<string, IntlString> = {
    startDate: tracker.string.StartDate,
    dueDate: tracker.string.DueDate,
    deadline: tracker.string.Deadline,
    milestoneStart: tracker.string.RoadmapMilestoneStart,
    milestoneTarget: tracker.string.RoadmapMilestoneTarget,
    undo: tracker.string.RoadmapUndo,
    reassigned: tracker.string.WorkloadReassigned,
    failed: tracker.string.WorkloadReassignFailed,
    unassigned: tracker.string.Unassigned,
    unscheduled: tracker.string.RoadmapUnscheduled,
    noCapacity: tracker.string.WorkloadNoCapacity,
    stateUnder: tracker.string.WorkloadStateUnder,
    stateNear: tracker.string.WorkloadStateNear,
    stateOver: tracker.string.WorkloadStateOver,
    workload: tracker.string.Workload
  }
  let texts = new Map<string, string>()

  async function loadTexts (lang: string): Promise<void> {
    const entries = await Promise.all(
      Object.entries(textKeys).map(async ([key, label]) => [key, await translate(label, {}, lang)] as const)
    )
    texts = new Map(entries)
  }
  $: void loadTexts($themeStore.language)

  const textOf = (map: Map<string, string>, key: string): string => map.get(key) ?? ''
  $: stateNames = {
    empty: '',
    under: textOf(texts, 'stateUnder'),
    near: textOf(texts, 'stateNear'),
    over: textOf(texts, 'stateOver')
  } as Record<LoadState, string>

  // ---- configuration of the view ----
  $: sources = buildDateSources($registry.fields, {
    startDate: textOf(texts, 'startDate'),
    dueDate: textOf(texts, 'dueDate'),
    deadline: textOf(texts, 'deadline'),
    milestoneStart: textOf(texts, 'milestoneStart'),
    milestoneTarget: textOf(texts, 'milestoneTarget')
  })
  $: numberFields = $registry.fields
    .filter((f) => f.type === ProjectFieldType.Number)
    .map((f) => ({ key: f.key, label: f.label }))

  // A date or number field that no longer exists (a deleted field) is left out of the displayed settings but stays in the saved ones
  $: settings = sanitizeWorkloadConfig(readWorkloadConfig(viewOptions), {
    sourceIds: new Set(sources.map((s) => s.id)),
    numberFieldKeys: new Set(numberFields.map((f) => f.key))
  })
  $: selection = workloadSelection(settings)

  function changeSettings (next: WorkloadConfig): void {
    setViewOptions(viewlet, withWorkloadConfig(viewOptions, next))
  }

  // ---- items ----
  let items: Issue[] = []
  let truncated = false
  const resultCountOwner = claimResultCountOwner()
  onDestroy(() => {
    releaseResultCountOwner(resultCountOwner)
  })

  let resultQuery: DocumentQuery<Issue> = { ...query }
  let resultOptions: FindOptions<Issue> = { ...(options ?? {}) }
  $: void getResultQuery(hierarchy, query, viewOptionsConfig, viewOptions).then((q) => {
    resultQuery = q as DocumentQuery<Issue>
  })
  $: void getResultOptions(options, viewOptionsConfig, viewOptions).then((o) => {
    resultOptions = o ?? {}
  })

  $: findOptions = { ...resultOptions, limit: ITEM_LIMIT + 1 } as FindOptions<Issue>

  const issuesQuery = createQuery()
  $: issuesQuery.query(
    tracker.class.Issue,
    getCategoryQueryNoLookup(resultQuery),
    (res) => {
      truncated = res.length > ITEM_LIMIT
      items = truncated ? res.slice(0, ITEM_LIMIT) : res
      setResultCount(resultCountOwner, items.length)
    },
    findOptions
  )

  $: issueById = new Map<string, Issue>(items.map((i) => [i._id as string, i]))

  // ---- people ----
  let people = new Map<string, Person>()
  const personQuery = createQuery()
  $: personIds = [...new Set([...items.map((i) => i.assignee).filter(notEmpty) as string[], ...memberRows])].sort()
  $: if (personIds.length > 0) {
    personQuery.query(contact.class.Person, { _id: { $in: personIds as Array<Ref<Person>> } }, (res) => {
      people = new Map(res.map((p) => [p._id as string, p]))
    })
  } else {
    personQuery.unsubscribe()
    people = new Map()
  }
  $: nameOf = (key: string): string | undefined => {
    const person = people.get(key)
    return person !== undefined ? getName(hierarchy, person) : undefined
  }

  // ---- the load ----
  let lookups: DateLookups
  $: lookups = {
    milestone: (id) => milestoneById.get(id),
    iterations: (key) => iterationsByKey.get(key) ?? []
  }
  $: entries = items.map(
    (issue): LoadEntry => ({
      id: issue._id,
      row: rowKeyOf(issue.assignee),
      load: readLoad(issue, settings.measure, settings.field),
      schedule: resolveSchedule(issue, selection, lookups)
    })
  )
  $: scheduledDays = (function * (): Generator<number> {
    for (const entry of entries) {
      const span = scheduleSpan(entry.schedule)
      if (span !== undefined) {
        yield span.start
        yield span.end
      }
    }
  })()
  $: firstDay = normalizeFirstDay($deviceOptionsStore.firstDayOfWeek)
  $: axis = computeAxis(settings.zoom, scheduledDays, today, firstDay)
  $: result = computeWorkload(entries, axis, workdayIndex)
  $: capacities = bucketCapacities(axis, workdayIndex, settings.capacity)

  $: rowKeys = new Set<string>([...result.rows.keys(), ...memberRows])
  $: rowInfos = orderRows(rowKeys, nameOf, textOf(texts, 'unassigned'), $themeStore.language)
  $: gridRows = rowInfos.map((info): GridRow => {
    const load = result.rows.get(info.key) ?? emptyRowLoad(info.key, axis.buckets.length)
    return { info, load, summary: summarizeRow(load, capacities) }
  })

  // ---- item color ----
  function barColor (issue: Issue, store: typeof $statusStore): string {
    const category = store.byId.get(issue.status)?.category
    if (category === task.statusCategory.Won) return 'var(--theme-won-color, #3fb950)'
    if (category === task.statusCategory.Lost) return 'var(--theme-dark-color, #8b949e)'
    return 'var(--primary-button-default, #4b6bfb)'
  }
  $: colorOf = (issue: Issue): string => barColor(issue, $statusStore)

  // ---- the items behind a cell ----
  let selected: CellRef | undefined
  let lastZoom = settings.zoom
  $: if (settings.zoom !== lastZoom) {
    // A bucket index means something else in another zoom
    lastZoom = settings.zoom
    selected = undefined
  }

  $: panelItems = ((): PanelItem[] => {
    if (selected === undefined) return []
    const res: PanelItem[] = []
    for (const part of cellItems(entries, axis, workdayIndex, selected.row, selected.bucket)) {
      const issue = issueById.get(part.id)
      if (issue !== undefined) res.push({ issue, share: part.share })
    }
    return res
  })()

  let panelTitle = ''
  async function updateTitle (
    sel: CellRef | undefined,
    lang: string,
    rows: Array<{ key: string, name: string }>,
    timeline: typeof axis,
    names: Map<string, string>
  ): Promise<void> {
    if (sel === undefined) {
      panelTitle = ''
      return
    }
    const person = rows.find((r) => r.key === sel.row)?.name ?? ''
    const bucket = sel.bucket === 'unscheduled' ? undefined : timeline.buckets[sel.bucket]
    const period = bucket === undefined ? textOf(names, 'unscheduled') : formatBucketRange(timeline.zoom, bucket, lang)
    panelTitle = await translate(tracker.string.WorkloadPanelTitle, { person, period }, lang)
  }
  $: void updateTitle(selected, $themeStore.language, rowInfos, axis, texts)

  function select (cell: CellRef): void {
    selected = selected !== undefined && selected.row === cell.row && selected.bucket === cell.bucket ? undefined : cell
  }

  // ---- reassigning ----
  const journal = new tableEdit.EditJournal()
  interface Toast {
    text: string
    // Batch that "Undo" reverts
    undo?: string
  }
  let toast: Toast | undefined
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  onDestroy(() => {
    if (toastTimer !== undefined) clearTimeout(toastTimer)
  })

  function showToast (value: Toast): void {
    toast = value
    if (toastTimer !== undefined) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toast = undefined
    }, TOAST_MS)
  }

  $: readonly = $restrictionStore.readonly

  async function applyPlan (issue: Issue, plan: ReassignPlan): Promise<void> {
    if (plan.ok === false) return
    const op = tableEdit.updateOp(issueTarget(issue), issue as unknown as Record<string, unknown>, plan.patch)
    try {
      await runIssueOps(client, [op])
      const batch = tableEdit.createBatch(generateId(), [op])
      journal.record(batch)
      showToast({ text: textOf(texts, 'reassigned'), undo: batch.id })
    } catch (err) {
      Analytics.handleError(err as Error)
      showToast({ text: textOf(texts, 'failed') })
    }
  }

  async function undo (): Promise<void> {
    const id = toast?.undo
    if (id === undefined) return
    toast = undefined
    try {
      await journal.undo(async (ops) => {
        await runIssueOps(client, ops)
      }, id)
    } catch (err) {
      Analytics.handleError(err as Error)
      showToast({ text: textOf(texts, 'failed') })
    }
  }

  async function reassignTo (issue: Issue, row: string): Promise<void> {
    await applyPlan(issue, planReassign(issue, row, { readonly }))
  }

  // The keyboard way: a list of the rows to move the item to
  function pickAssignee (ev: MouseEvent, issue: Issue): void {
    if (readonly) return
    const current = rowKeyOf(issue.assignee)
    const sections: OptionSection[] = [
      {
        id: 'assignee',
        mode: 'single',
        items: rowInfos.map((r) => ({ id: r.key, label: r.name, checked: r.key === current }))
      }
    ]
    // The unassigned row is only listed when it exists, so an item can always be unassigned
    if (!rowInfos.some((r) => r.key === UNASSIGNED_ROW)) {
      sections[0].items.push({ id: UNASSIGNED_ROW, label: textOf(texts, 'unassigned'), checked: current === UNASSIGNED_ROW })
    }
    showPopup(
      RoadmapOptionsPopup,
      {
        sections,
        onToggle: (_sectionId: string, itemId: string) => {
          closePopup()
          void reassignTo(issue, itemId)
        }
      },
      eventToHTMLElement(ev)
    )
  }

  // ---- drag to reassign ----
  interface DragState {
    id: string
    startX: number
    startY: number
    moved: boolean
    // The row the pointer is over
    overRow: string | undefined
    // Where the pointer is (for the label that follows it)
    x: number
    y: number
  }
  let drag: DragState | undefined
  let dragIssue: Issue | undefined

  function rowAtPoint (x: number, y: number): string | undefined {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.getAttribute('data-id') === 'workload-row') return (el as HTMLElement).dataset.row
    }
    return undefined
  }

  function startDrag (ev: PointerEvent, issue: Issue): void {
    if (ev.button !== 0) return
    ev.preventDefault()
    ev.stopPropagation()
    dragIssue = issue
    drag = { id: issue._id, startX: ev.clientX, startY: ev.clientY, moved: false, overRow: undefined, x: ev.clientX, y: ev.clientY }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('keydown', onDragKey)
  }

  function stopDrag (): void {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('keydown', onDragKey)
    drag = undefined
    dragIssue = undefined
  }

  function onPointerMove (ev: PointerEvent): void {
    if (drag === undefined) return
    const distance = Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY)
    const moved = drag.moved || distance > DRAG_THRESHOLD_PX
    drag = { ...drag, moved, x: ev.clientX, y: ev.clientY, overRow: rowAtPoint(ev.clientX, ev.clientY) }
  }

  function onDragKey (ev: KeyboardEvent): void {
    if (ev.key === 'Escape') stopDrag()
  }

  function onPointerUp (): void {
    const state = drag
    const issue = dragIssue
    stopDrag()
    if (state === undefined || issue === undefined) return
    if (!state.moved) {
      // Pressing an item without moving it opens it
      openIssue(issue)
      return
    }
    if (readonly || state.overRow === undefined) return
    void reassignTo(issue, state.overRow)
  }

  onDestroy(() => {
    stopDrag()
  })

  function openIssue (issue: Issue): void {
    void openDoc(hierarchy, issue)
  }

  // A read-only viewer cannot drag: the press only opens the item
  function onPress (issue: Issue, ev: PointerEvent): void {
    if (readonly) {
      if (ev.button === 0) openIssue(issue)
      return
    }
    startDrag(ev, issue)
  }

  $: dropRow = drag?.moved === true ? drag.overRow : undefined
  $: draggingId = drag?.moved === true ? drag.id : undefined

  let grid: WorkloadGrid | undefined
</script>

<div class="workload" data-id="workload-view">
  <WorkloadToolbar
    config={settings}
    {sources}
    {numberFields}
    on:change={(e) => {
      changeSettings(e.detail)
    }}
    on:today={() => {
      void grid?.scrollToToday()
    }}
  />
  {#if truncated}
    <div class="notice" role="status">
      <!-- The same notice as the roadmap -->
      <Label label={tracker.string.RoadmapTruncated} params={{ limit: ITEM_LIMIT }} />
    </div>
  {/if}
  {#if result.outOfRange > 0}
    <div class="notice" role="status" data-id="workload-out-of-range">
      <Label label={tracker.string.WorkloadOutOfRange} params={{ count: result.outOfRange }} />
    </div>
  {/if}
  <div class="main">
    <div class="content">
      {#if gridRows.length === 0}
        <div class="empty" data-id="workload-empty"><Label label={tracker.string.RoadmapEmpty} /></div>
      {:else}
        <WorkloadGrid
          bind:this={grid}
          {axis}
          rows={gridRows}
          {capacities}
          measure={settings.measure}
          locale={$themeStore.language}
          {people}
          {stateNames}
          noCapacityText={textOf(texts, 'noCapacity')}
          label={textOf(texts, 'workload')}
          {selected}
          {dropRow}
          {today}
          on:select={(e) => {
            select(e.detail)
          }}
        />
      {/if}
    </div>
    {#if selected !== undefined}
      <WorkloadPanel
        title={panelTitle}
        items={panelItems}
        measure={settings.measure}
        locale={$themeStore.language}
        editable={!readonly}
        {colorOf}
        {draggingId}
        on:press={(e) => {
          onPress(e.detail.issue, e.detail.event)
        }}
        on:open={(e) => {
          openIssue(e.detail.issue)
        }}
        on:reassign={(e) => {
          pickAssignee(e.detail.event, e.detail.issue)
        }}
        on:close={() => {
          selected = undefined
        }}
      />
    {/if}
  </div>

  {#if drag !== undefined && drag.moved && dragIssue !== undefined}
    <div class="drag-ghost" style:left="{drag.x + 12}px" style:top="{drag.y + 12}px" data-id="workload-drag-ghost">
      <span class="identifier">{dragIssue.identifier}</span>
      {dragIssue.title}
    </div>
  {/if}

  {#if toast !== undefined}
    <div class="toast" role="status" data-id="workload-toast">
      <span>{toast.text}</span>
      {#if toast.undo !== undefined}
        <button
          class="undo"
          type="button"
          data-id="workload-undo"
          on:click={() => {
            void undo()
          }}
        >
          {texts.get('undo') ?? ''}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  .workload {
    position: relative;
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-height: 0;
    min-width: 0;
    height: 100%;
    overflow: hidden;
    background: var(--theme-bg-color);
  }
  .notice {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    color: var(--theme-warning-color, #9a6700);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .main {
    display: flex;
    flex-grow: 1;
    min-height: 0;
  }
  .content {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-height: 0;
    min-width: 0;
  }
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-grow: 1;
    color: var(--theme-dark-color);
  }
  .drag-ghost {
    position: fixed;
    z-index: 30;
    max-width: 16rem;
    padding: 0.25rem 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    color: #fff;
    background: var(--primary-button-default, #4b6bfb);
    border-radius: 0.25rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    pointer-events: none;
  }
  .identifier {
    opacity: 0.75;
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: 1rem;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    transform: translateX(-50%);
    border: 1px solid var(--theme-popup-divider);
    border-radius: 0.5rem;
    background: var(--theme-popup-color);
    box-shadow: var(--theme-popup-shadow);
    color: var(--theme-caption-color);
  }
  .undo {
    padding: 0.125rem 0.5rem;
    border: none;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--primary-button-default, var(--theme-caption-color));
    font-weight: 500;
    cursor: pointer;

    &:hover {
      background: var(--theme-button-hovered);
    }
  }
</style>
