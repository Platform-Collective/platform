<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { DocumentQuery, FindOptions, generateId, Ref, SortingOrder, Space } from '@hcengineering/core'
  import { IntlString, translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import { Issue, Iteration, Milestone, Project, ProjectFieldType } from '@hcengineering/tracker'
  import { DatePopup, deviceOptionsStore, eventToHTMLElement, Label, showPopup, themeStore } from '@hcengineering/ui'
  import { BuildModelKey, Viewlet, ViewOptions, ViewOptionModel } from '@hcengineering/view'
  import {
    claimResultCountOwner,
    clientViewExtension,
    getCategoryQueryNoLookup,
    getResultOptions,
    getResultQuery,
    isClientViewKey,
    openDoc,
    releaseResultCountOwner,
    restrictionStore,
    setResultCount,
    setViewOptions,
    showMenu,
    statusStore,
    tableEdit
  } from '@hcengineering/view-resources'
  import { onDestroy, tick } from 'svelte'
  import { readable } from 'svelte/store'

  import { issueTarget, runIssueOps } from '../../bulkEdit/issueCells'
  import { groupAgenda } from '../../calendar/agenda'
  import { draftValuesForDay } from '../../calendar/addItem'
  import {
    calendarSelection,
    readCalendarConfig,
    sanitizeCalendarConfig,
    withCalendarConfig,
    type CalendarConfig
  } from '../../calendar/config'
  import { dragDelta } from '../../calendar/drag'
  import { buildCalendarEvents, eventsInRange, eventsOnDay, type CalendarEvent } from '../../calendar/events'
  import {
    anchorForDay,
    buildMonthGrid,
    buildWeek,
    formatCalendarTitle,
    formatDayLong,
    isFocusKey,
    moveFocusDay,
    normalizeFirstDay,
    rangeHas,
    shiftAnchor,
    visibleRange,
    weekdayLabels
  } from '../../calendar/grid'
  import { planCardFields } from '../../board/cardFields'
  import { iterationsByFieldKey, sharedIterationsStore } from '../../iterations/iterationsStore'
  import tracker from '../../plugin'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import { buildRegistry } from '../../projectFields/registry'
  import { buildDateSources, resolveSchedule, type DateLookups, type DateSource, type ItemSchedule } from '../../roadmap/dates'
  import {
    buildIssuePatch,
    planReschedule,
    planSchedule,
    previewSchedule,
    type DatePlan,
    type PlanContext,
    type RescheduleMode
  } from '../../roadmap/reschedule'
  import { toDay } from '../../roadmap/timeScale'
  import CalendarAddItemPopup from './CalendarAddItemPopup.svelte'
  import CalendarAgenda from './CalendarAgenda.svelte'
  import CalendarDayPopup from './CalendarDayPopup.svelte'
  import CalendarGrid from './CalendarGrid.svelte'
  import CalendarToolbar from './CalendarToolbar.svelte'
  import CalendarUnscheduled from './CalendarUnscheduled.svelte'

  export let space: Ref<Space> | undefined = undefined
  export let query: DocumentQuery<Issue> = {}
  export let viewOptions: ViewOptions
  export let viewlet: Viewlet
  export let viewOptionsConfig: ViewOptionModel[] | undefined = undefined
  export let options: FindOptions<Issue> | undefined = undefined
  // The fields of the view (Configure columns): what an item shows besides the identifier, the title and the status
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

  // ---- texts ----
  const textKeys: Record<string, IntlString> = {
    startDate: tracker.string.StartDate,
    dueDate: tracker.string.DueDate,
    deadline: tracker.string.Deadline,
    milestoneStart: tracker.string.RoadmapMilestoneStart,
    milestoneTarget: tracker.string.RoadmapMilestoneTarget,
    undo: tracker.string.RoadmapUndo,
    updated: tracker.string.RoadmapRescheduled,
    failed: tracker.string.RoadmapRescheduleFailed,
    readonly: tracker.string.RoadmapReadOnlyDates,
    needsDates: tracker.string.CalendarAddNeedsDates
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
  const text = (key: string): string => textOf(texts, key)

  // ---- configuration of the view ----
  $: sources = buildDateSources($registry.fields, {
    startDate: textOf(texts, 'startDate'),
    dueDate: textOf(texts, 'dueDate'),
    deadline: textOf(texts, 'deadline'),
    milestoneStart: textOf(texts, 'milestoneStart'),
    milestoneTarget: textOf(texts, 'milestoneTarget')
  })
  $: sourceMap = new Map<string, DateSource>(sources.map((s) => [s.id, s]))

  // A date field that no longer exists (a deleted field) is left out of the displayed settings but stays in the saved ones
  $: settings = sanitizeCalendarConfig(readCalendarConfig(viewOptions), new Set(sources.map((s) => s.id)))
  $: selection = calendarSelection(settings)

  function changeSettings (next: CalendarConfig): void {
    setViewOptions(viewlet, withCalendarConfig(viewOptions, next))
  }

  // The fields on an item follow the field list of the view
  $: plan = planCardFields(config)

  // ---- navigation (not stored: which month or week is open is not a setting of the view) ----
  $: firstDay = normalizeFirstDay($deviceOptionsStore.firstDayOfWeek)
  let anchor = today
  let focusDay = today
  $: range = visibleRange(settings.mode, anchor, firstDay)
  $: if (!rangeHas(range, focusDay)) focusDay = anchor
  $: title = formatCalendarTitle(settings.mode, anchor, firstDay, $themeStore.language)
  $: weekdays = weekdayLabels(firstDay, $themeStore.language)
  $: weeks =
    settings.mode === 'month'
      ? buildMonthGrid(anchor, firstDay, today)
      : settings.mode === 'week'
        ? [buildWeek(anchor, firstDay, today)]
        : []

  function navigate (direction: -1 | 1): void {
    anchor = shiftAnchor(settings.mode, anchor, direction)
    focusDay = anchor
  }

  function goToday (): void {
    anchor = today
    focusDay = today
  }

  // ---- items ----
  let loaded: Issue[] = []
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

  // The order inside a day is the order of the view; there is no grouping in a calendar
  $: orderBy = viewOptions.orderBy
  $: ext = $clientViewExtension
  // Order by a custom field is evaluated on the client, every other key by the server
  $: clientSort = isClientViewKey(ext, orderBy?.[0])
  $: findOptions = {
    ...resultOptions,
    limit: ITEM_LIMIT + 1,
    // The parent of a sub-issue, whose comments the cards of the agenda show
    lookup: { ...(resultOptions.lookup ?? {}), attachedTo: tracker.class.Issue },
    ...(!clientSort && orderBy !== undefined ? { sort: { [orderBy[0]]: orderBy[1] } } : {})
  } as FindOptions<Issue>

  const issuesQuery = createQuery()
  $: issuesQuery.query(
    tracker.class.Issue,
    getCategoryQueryNoLookup(resultQuery),
    (res) => {
      truncated = res.length > ITEM_LIMIT
      loaded = truncated ? res.slice(0, ITEM_LIMIT) : res
      setResultCount(resultCountOwner, loaded.length)
    },
    findOptions
  )

  $: comparator = clientSort && orderBy !== undefined ? ext?.compare(orderBy[0], orderBy[1] as SortingOrder) : undefined
  $: items = comparator !== undefined ? [...loaded].sort((a, b) => comparator(a, b)) : loaded

  // ---- schedules and events ----
  let lookups: DateLookups
  $: lookups = {
    milestone: (id) => milestoneById.get(id),
    iterations: (key) => iterationsByKey.get(key) ?? []
  }
  $: schedules = new Map<string, ItemSchedule>(items.map((i) => [i._id as string, resolveSchedule(i, selection, lookups)]))
  const scheduleOf = (issue: Issue): ItemSchedule => schedules.get(issue._id) ?? { kind: 'unscheduled' }
  const idOf = (issue: Issue): string => issue._id

  $: built = buildCalendarEvents(items, idOf, scheduleOf)
  $: unscheduled = built.unscheduled
  // While an item is dragged its event is shown where it would land
  $: events = withPreview(built.events, drag, schedules)
  $: visibleEvents = eventsInRange(events, range)
  $: agendaDays = settings.mode === 'agenda' ? groupAgenda(visibleEvents, range) : []

  function withPreview (
    list: Array<CalendarEvent<Issue>>,
    state: DragState | undefined,
    byId: Map<string, ItemSchedule>
  ): Array<CalendarEvent<Issue>> {
    if (state === undefined || !state.moved || !state.allowed || state.mode === 'schedule' || state.overDay === undefined) {
      return list
    }
    const base = byId.get(state.id)
    if (base === undefined) return list
    const next = previewSchedule(base, state.mode, dragDelta(state.mode, base, state.grabDay, state.overDay))
    const start = next.kind === 'range' ? next.start : next.kind === 'marker' ? next.day : undefined
    const end = next.kind === 'range' ? next.target : next.kind === 'marker' ? next.day : undefined
    if (start === undefined || end === undefined) return list
    return list.map((e) => (e.id === state.id ? { ...e, start, end } : e))
  }

  // ---- item text and color ----
  function barColor (issue: Issue, store: typeof $statusStore): string {
    const category = store.byId.get(issue.status)?.category
    if (category === task.statusCategory.Won) return 'var(--theme-won-color, #3fb950)'
    if (category === task.statusCategory.Lost) return 'var(--theme-dark-color, #8b949e)'
    return 'var(--primary-button-default, #4b6bfb)'
  }
  $: colorOf = (issue: Issue): string => barColor(issue, $statusStore)

  $: dateText = (schedule: ItemSchedule): string => {
    const format = new Intl.DateTimeFormat($themeStore.language, { dateStyle: 'medium', timeZone: 'UTC' })
    const fmt = (day: number): string => format.format(new Date(day * 86400000))
    switch (schedule.kind) {
      case 'range':
        return schedule.start === schedule.target ? fmt(schedule.start) : `${fmt(schedule.start)} – ${fmt(schedule.target)}`
      case 'marker':
        return fmt(schedule.day)
      case 'unscheduled':
        return ''
    }
  }
  $: labelOf = (issue: Issue): string => `${issue.identifier} ${issue.title}\n${dateText(scheduleOf(issue))}`.trim()

  // ---- editing the dates ----
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

  function planContext (issue: Issue): PlanContext {
    return { issue, schedule: scheduleOf(issue), selection, sources: sourceMap, lookups }
  }

  // Whether dragging the item that way can change anything (a milestone date cannot be written, a chip has one edge)
  function canDrag (issue: Issue, mode: RescheduleMode): boolean {
    if (readonly) return false
    const result = planReschedule(planContext(issue), mode, 1)
    if (result.ok === false) {
      return result.reason !== 'readonly' && result.reason !== 'unsupported' && result.reason !== 'noSchedule'
    }
    return true
  }

  // Whether any of the date fields of the view can be written (a view that takes both dates from the milestone cannot)
  $: datesWritable = [selection.start, selection.target].some((id) => sourceMap.get(id)?.writable === true)

  // Whether an item without a day (or with one date) can be put on a day: a date field of the view can be written
  function canSchedule (issue: Issue): boolean {
    if (readonly) return false
    const result = planSchedule({ issue, selection, sources: sourceMap, lookups }, today)
    return result.ok === false ? result.reason !== 'readonly' : true
  }

  async function applyPlan (issue: Issue, result: DatePlan): Promise<void> {
    if (result.ok === false) {
      if (result.reason === 'readonly') showToast({ text: text('readonly') })
      return
    }
    const patch = buildIssuePatch(issue, result.writes)
    const op = tableEdit.updateOp(issueTarget(issue), issue as unknown as Record<string, unknown>, patch)
    // An issue without custom fields goes back to an empty record, not to null
    if (op.kind === 'update' && 'customFields' in patch) op.before.customFields = issue.customFields ?? {}
    try {
      await runIssueOps(client, [op])
      const batch = tableEdit.createBatch(generateId(), [op])
      journal.record(batch)
      showToast({ text: text('updated'), undo: batch.id })
    } catch (err) {
      Analytics.handleError(err as Error)
      showToast({ text: text('failed') })
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
      showToast({ text: text('failed') })
    }
  }

  // Sets the dates of an item without dates (or the missing one of a chip) to a day
  async function scheduleAt (issue: Issue, day: number): Promise<void> {
    if (readonly) return
    await applyPlan(issue, planSchedule({ issue, selection, sources: sourceMap, lookups }, day))
  }

  function pickDates (ev: MouseEvent, issue: Issue): void {
    if (readonly) return
    showPopup(
      DatePopup,
      { currentDate: null, withTime: false, label: tracker.string.RoadmapSetDates },
      eventToHTMLElement(ev),
      undefined,
      (result) => {
        const ts = result instanceof Date ? result.getTime() : typeof result === 'number' ? result : undefined
        if (ts !== undefined) void scheduleAt(issue, toDay(ts))
      }
    )
  }

  // ---- drag to reschedule ----
  // `schedule` drops an item without a day on a day
  type DragMode = RescheduleMode | 'schedule'
  interface DragState {
    id: string
    mode: DragMode
    startX: number
    startY: number
    // The day cell the pointer grabbed the item in, and the one it is over now
    grabDay: number
    overDay: number | undefined
    moved: boolean
    allowed: boolean
    // Where the pointer is (for the label that follows it while an item without a day is dragged)
    x: number
    y: number
  }
  let drag: DragState | undefined
  let dragIssue: Issue | undefined

  function dayAtPoint (x: number, y: number): number | undefined {
    for (const el of document.elementsFromPoint(x, y)) {
      const value = (el as HTMLElement).dataset?.day
      if (value !== undefined && el.getAttribute('data-id') === 'calendar-day') {
        const day = Number(value)
        if (Number.isFinite(day)) return day
      }
    }
    return undefined
  }

  function startDrag (ev: PointerEvent, issue: Issue, mode: DragMode): void {
    if (ev.button !== 0) return
    ev.preventDefault()
    ev.stopPropagation()
    const base = scheduleOf(issue)
    const own = base.kind === 'range' ? base.start : base.kind === 'marker' ? base.day : today
    const grabDay = dayAtPoint(ev.clientX, ev.clientY) ?? own
    dragIssue = issue
    drag = {
      id: issue._id,
      mode,
      startX: ev.clientX,
      startY: ev.clientY,
      grabDay,
      overDay: grabDay,
      moved: false,
      allowed: mode === 'schedule' ? canSchedule(issue) : canDrag(issue, mode),
      x: ev.clientX,
      y: ev.clientY
    }
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
    drag = { ...drag, moved, x: ev.clientX, y: ev.clientY, overDay: dayAtPoint(ev.clientX, ev.clientY) ?? drag.overDay }
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
      // Pressing an edge without moving it does nothing, pressing the item opens it
      if (state.mode === 'move' || state.mode === 'schedule') openIssue(issue)
      return
    }
    if (!state.allowed) {
      if (!readonly) showToast({ text: text('readonly') })
      return
    }
    if (state.overDay === undefined) return
    if (state.mode === 'schedule') {
      void scheduleAt(issue, state.overDay)
      return
    }
    const delta = dragDelta(state.mode, scheduleOf(issue), state.grabDay, state.overDay)
    void applyPlan(issue, planReschedule(planContext(issue), state.mode, delta))
  }

  onDestroy(() => {
    stopDrag()
  })

  function openIssue (issue: Issue): void {
    void openDoc(hierarchy, issue)
  }

  $: dropDay = drag?.moved === true ? drag.overDay : undefined
  $: draggingId = drag?.moved === true ? drag.id : undefined

  // ---- day cells: add an item, "+N more", keyboard ----
  function addItemOnDay (day: number, element: HTMLElement): void {
    focusDay = day
    if (readonly || project === undefined) return
    const values = draftValuesForDay({ selection, sources: sourceMap, lookups }, day)
    if (values.ok === false) {
      showToast({ text: text('needsDates') })
      return
    }
    showPopup(
      CalendarAddItemPopup,
      { project, values: values.values, dateLabel: formatDayLong(day, $themeStore.language) },
      element
    )
  }

  function showDayItems (day: number, element: HTMLElement): void {
    showPopup(
      CalendarDayPopup,
      {
        issues: eventsOnDay(events, day).map((e) => e.item),
        dateLabel: formatDayLong(day, $themeStore.language),
        config,
        space: project
      },
      element
    )
  }

  let root: HTMLDivElement | undefined
  async function focusCell (day: number): Promise<void> {
    await tick()
    root?.querySelector<HTMLElement>(`[data-id="calendar-day"][data-day="${day}"]`)?.focus()
  }

  function onGridKey (detail: { day: number, event: KeyboardEvent, element: HTMLElement }): void {
    const { day, event, element } = detail
    if (isFocusKey(event.key)) {
      event.preventDefault()
      const next = moveFocusDay(day, event.key, firstDay)
      anchor = anchorForDay(settings.mode, anchor, next, firstDay)
      focusDay = next
      void focusCell(next)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      addItemOnDay(day, element)
    }
  }

  // ---- the panel of items without a day ----
  let unscheduledOpen = true
</script>

<div class="calendar" bind:this={root} data-id="calendar-view">
  <CalendarToolbar
    config={settings}
    {sources}
    {title}
    unscheduledCount={unscheduled.length}
    {unscheduledOpen}
    on:change={(e) => {
      changeSettings(e.detail)
    }}
    on:previous={() => {
      navigate(-1)
    }}
    on:next={() => {
      navigate(1)
    }}
    on:today={goToday}
    on:unscheduled={() => {
      unscheduledOpen = !unscheduledOpen
    }}
  />
  {#if truncated}
    <div class="notice" role="status">
      <!-- The same notice as the roadmap -->
      <Label label={tracker.string.RoadmapTruncated} params={{ limit: ITEM_LIMIT }} />
    </div>
  {/if}
  <div class="main">
    <div class="content">
      {#if settings.mode === 'agenda'}
        <CalendarAgenda days={agendaDays} {config} space={project} locale={$themeStore.language} {today} {colorOf} />
      {:else}
        <CalendarGrid
          {weeks}
          events={visibleEvents}
          mode={settings.mode}
          {weekdays}
          locale={$themeStore.language}
          {plan}
          {focusDay}
          {dropDay}
          {draggingId}
          {scheduleOf}
          {colorOf}
          {labelOf}
          {canDrag}
          on:press={(e) => {
            startDrag(e.detail.event, e.detail.issue, e.detail.mode)
          }}
          on:open={(e) => {
            openIssue(e.detail.issue)
          }}
          on:menu={(e) => {
            showMenu(e.detail.event, { object: e.detail.issue })
          }}
          on:dayclick={(e) => {
            addItemOnDay(e.detail.day, e.detail.element)
          }}
          on:more={(e) => {
            showDayItems(e.detail.day, e.detail.element)
          }}
          on:key={(e) => {
            onGridKey(e.detail)
          }}
        />
      {/if}
    </div>
    {#if unscheduledOpen && unscheduled.length > 0}
      <CalendarUnscheduled
        issues={unscheduled}
        editable={!readonly && datesWritable}
        {colorOf}
        {draggingId}
        on:press={(e) => {
          startDrag(e.detail.event, e.detail.issue, 'schedule')
        }}
        on:open={(e) => {
          openIssue(e.detail.issue)
        }}
        on:dates={(e) => {
          pickDates(e.detail.event, e.detail.issue)
        }}
      />
    {/if}
  </div>

  {#if drag !== undefined && drag.moved && drag.mode === 'schedule' && drag.allowed && dragIssue !== undefined}
    <div class="drag-ghost" style:left="{drag.x + 12}px" style:top="{drag.y + 12}px" data-id="calendar-drag-ghost">
      <span class="identifier">{dragIssue.identifier}</span>
      {dragIssue.title}
    </div>
  {/if}

  {#if toast !== undefined}
    <div class="toast" role="status" data-id="calendar-toast">
      <span>{toast.text}</span>
      {#if toast.undo !== undefined}
        <button
          class="undo"
          type="button"
          data-id="calendar-undo"
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
  .calendar {
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
