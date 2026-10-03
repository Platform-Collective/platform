<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import contact, { Employee, getName } from '@hcengineering/contact'
  import { DocumentQuery, FindOptions, generateId, Ref, SortingOrder, Space } from '@hcengineering/core'
  import { IntlString, translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tags, { TagReference } from '@hcengineering/tags'
  import task from '@hcengineering/task'
  import { taskTypeStore } from '@hcengineering/task-resources'
  import { Issue, Iteration, Milestone, Project, ProjectFieldType } from '@hcengineering/tracker'
  import {
    DatePopup,
    eventToHTMLElement,
    getPlatformColor,
    Icon,
    IconChevronRight,
    IconDown,
    Label,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import { Viewlet, ViewOptions, ViewOptionModel } from '@hcengineering/view'
  import {
    clientViewExtension,
    getCategoryQueryNoLookup,
    getResultOptions,
    getResultQuery,
    isClientViewKey,
    noCategory,
    openDoc,
    claimResultCountOwner,
    releaseResultCountOwner,
    restrictionStore,
    setResultCount,
    setViewOptions,
    showMenu,
    statusStore,
    tableEdit
  } from '@hcengineering/view-resources'
  import { afterUpdate, onDestroy, onMount, tick } from 'svelte'
  import { readable } from 'svelte/store'
  import { issueTarget, runIssueOps } from '../../bulkEdit/issueCells'
  import { readFieldSums, resolveFieldSums, type SummableField } from '../../fieldSum/config'
  import { loadSummableFields } from '../../fieldSum/load'
  import { computeFieldSums, formatFieldSums } from '../../fieldSum/sum'
  import { iterationsByFieldKey, sharedIterationsStore } from '../../iterations/iterationsStore'
  import tracker from '../../plugin'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import { parseCustomFieldViewKey } from '../../projectFields/query'
  import { buildRegistry } from '../../projectFields/registry'
  import { readRoadmapConfig, sanitizeConfig, selectionOf, withRoadmapConfig, type RoadmapConfig } from '../../roadmap/config'
  import { formatCustomValue } from '../../roadmap/customValue'
  import {
    buildDateSources,
    partitionBySchedule,
    resolveSchedule,
    scheduleDays,
    type DateLookups,
    type DateSource,
    type ItemSchedule
  } from '../../roadmap/dates'
  import { groupItems, sortGroupsByLabel, type RoadmapGroupOf } from '../../roadmap/grouping'
  import {
    BUILTIN_LABEL_FIELDS,
    buildItemLabel,
    customLabelFieldId,
    LABEL_FIELD_LABELS,
    type LabelResolvers
  } from '../../roadmap/label'
  import {
    buildRows,
    estimateTextWidth,
    itemShape,
    placeLabel,
    visibleRowRange,
    type RoadmapRow
  } from '../../roadmap/layout'
  import { collectMarkers, markersInRange } from '../../roadmap/markers'
  import {
    buildIssuePatch,
    planReschedule,
    planSchedule,
    previewSchedule,
    type DatePlan,
    type PlanContext,
    type RescheduleMode
  } from '../../roadmap/reschedule'
  import {
    computeRange,
    createScale,
    formatTick,
    headerRows,
    PX_PER_DAY,
    pixelsToDays,
    scrollLeftForDay,
    toDay,
    type RoadmapScale
  } from '../../roadmap/timeScale'
  import { issuePriorities } from '../../types'
  import RoadmapToolbar from './RoadmapToolbar.svelte'

  export let space: Ref<Space> | undefined = undefined
  export let query: DocumentQuery<Issue> = {}
  export let viewOptions: ViewOptions
  export let viewlet: Viewlet
  export let viewOptionsConfig: ViewOptionModel[] | undefined = undefined
  export let options: FindOptions<Issue> | undefined = undefined

  // Items that are loaded; above it the view says so instead of silently cutting the list
  const ITEM_LIMIT = 5000
  // Width of the sticky column with the titles
  const LEFT_WIDTH = 288
  const TOP_ROW_HEIGHT = 24
  const BOTTOM_ROW_HEIGHT = 22
  const MARKER_ROW_HEIGHT = 22
  const HEADER_HEIGHT = TOP_ROW_HEIGHT + BOTTOM_ROW_HEIGHT + MARKER_ROW_HEIGHT
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
  $: iterationFields = $registry.fields
    .filter((f) => f.type === ProjectFieldType.Iteration)
    .map((f) => ({ key: f.key, label: f.label }))

  let milestones: Milestone[] = []
  let components: Array<{ _id: string, label: string }> = []
  let assignees = new Map<string, string>()
  let labelRefs = new Map<string, string[]>()
  const milestoneQuery = createQuery()
  const componentQuery = createQuery()
  const assigneeQuery = createQuery()
  const labelRefQuery = createQuery()

  $: milestoneQuery.query(tracker.class.Milestone, project !== undefined ? { space: project } : {}, (res) => {
    milestones = res
  })
  $: componentQuery.query(tracker.class.Component, project !== undefined ? { space: project } : {}, (res) => {
    components = res
  })
  assigneeQuery.query(contact.mixin.Employee, { active: true }, (res: Employee[]) => {
    assignees = new Map(res.map((e) => [e._id as string, getName(hierarchy, e)]))
  })

  $: milestoneById = new Map(milestones.map((m) => [m._id as string, m]))
  $: componentById = new Map(components.map((c) => [c._id, c.label]))

  // ---- texts ----
  const textKeys: Record<string, IntlString> = {
    startDate: tracker.string.StartDate,
    dueDate: tracker.string.DueDate,
    deadline: tracker.string.Deadline,
    milestoneStart: tracker.string.RoadmapMilestoneStart,
    milestoneTarget: tracker.string.RoadmapMilestoneTarget,
    noValue: tracker.string.RoadmapNoValue,
    identifier: tracker.string.Identifier,
    title: tracker.string.Title,
    status: tracker.string.Status,
    assignee: tracker.string.Assignee,
    priority: tracker.string.Priority,
    labels: tracker.string.Labels,
    component: tracker.string.Component,
    milestone: tracker.string.Milestone,
    estimation: tracker.string.Estimation,
    undo: tracker.string.RoadmapUndo,
    updated: tracker.string.RoadmapRescheduled,
    failed: tracker.string.RoadmapRescheduleFailed,
    readonly: tracker.string.RoadmapReadOnlyDates,
    setDates: tracker.string.RoadmapSetDates
  }
  let texts = new Map<string, string>()
  let priorityNames = new Map<number, string>()

  async function loadTexts (lang: string): Promise<void> {
    const entries = await Promise.all(
      Object.entries(textKeys).map(async ([key, label]) => [key, await translate(label, {}, lang)] as const)
    )
    texts = new Map(entries)
    const priorities = await Promise.all(
      Object.entries(issuePriorities).map(
        async ([value, { label }]) => [Number(value), await translate(label, {}, lang)] as const
      )
    )
    priorityNames = new Map(priorities)
  }
  $: void loadTexts($themeStore.language)

  // Pass `texts` where the result has to follow the loaded translations
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

  $: labelFields = [
    ...BUILTIN_LABEL_FIELDS.map((id) => ({ id, label: textOf(texts, id) })),
    ...$registry.fields.map((f) => ({ id: customLabelFieldId(f.key), label: f.label }))
  ]

  // What no longer exists (a deleted field) is left out of the displayed config but stays in the saved one
  $: config = sanitizeConfig(readRoadmapConfig(viewOptions), {
    sourceIds: new Set(sources.map((s) => s.id)),
    iterationFieldKeys: new Set(iterationFields.map((f) => f.key)),
    labelFieldIds: new Set(labelFields.map((f) => f.id))
  })
  $: selection = selectionOf(config)

  function changeConfig (next: RoadmapConfig): void {
    setViewOptions(viewlet, withRoadmapConfig(viewOptions, next))
  }

  // ---- items ----
  let loaded: Issue[] = []
  let ready = false
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

  $: orderBy = viewOptions.orderBy
  $: groupKey = viewOptions.groupBy?.[0] ?? noCategory
  $: ext = $clientViewExtension
  // Order by a custom field is evaluated on the client, every other key by the server
  $: clientSort = isClientViewKey(ext, orderBy?.[0])
  $: findOptions = {
    ...resultOptions,
    limit: ITEM_LIMIT + 1,
    ...(!clientSort && orderBy !== undefined ? { sort: { [orderBy[0]]: orderBy[1] } } : {})
  } as FindOptions<Issue>

  const issuesQuery = createQuery()
  $: issuesQuery.query(
    tracker.class.Issue,
    getCategoryQueryNoLookup(resultQuery),
    (res) => {
      truncated = res.length > ITEM_LIMIT
      loaded = truncated ? res.slice(0, ITEM_LIMIT) : res
      ready = true
      setResultCount(resultCountOwner, loaded.length)
    },
    findOptions
  )

  $: comparator = clientSort && orderBy !== undefined ? ext?.compare(orderBy[0], orderBy[1] as SortingOrder) : undefined
  $: items = comparator !== undefined ? [...loaded].sort((a, b) => comparator(a, b)) : loaded

  // ---- schedules ----
  let lookups: DateLookups
  $: lookups = {
    milestone: (id) => milestoneById.get(id),
    iterations: (key) => iterationsByKey.get(key) ?? []
  }
  $: schedules = new Map<string, ItemSchedule>(items.map((i) => [i._id as string, resolveSchedule(i, selection, lookups)]))
  const scheduleOf = (issue: Issue): ItemSchedule => schedules.get(issue._id) ?? { kind: 'unscheduled' }

  $: split = partitionBySchedule(items, scheduleOf)

  // ---- groups ----
  $: grouping = groupKey !== noCategory
  const idOf = (issue: Issue): string => issue._id

  function groupValueOf (issue: Issue): string | undefined {
    const fieldKey = parseCustomFieldViewKey(groupKey)
    const raw = fieldKey !== undefined ? issue.customFields?.[fieldKey] : (issue as unknown as Record<string, unknown>)[groupKey]
    return raw === undefined || raw === null || raw === '' ? undefined : String(raw)
  }

  const categoryOrder: unknown[] = [
    task.statusCategory.UnStarted,
    task.statusCategory.Active,
    task.statusCategory.Won,
    task.statusCategory.Lost
  ]
  function statusRank (category: unknown): number {
    const index = categoryOrder.indexOf(category)
    return index === -1 ? categoryOrder.length : index
  }

  function buildGroups (
    scheduled: Issue[],
    key: string,
    fieldsDep: unknown,
    shouldShowAll: boolean
  ): Array<RoadmapGroupOf<Issue>> {
    void fieldsDep
    if (key === noCategory) return [{ id: 'all', value: undefined, items: scheduled }]
    if (isClientViewKey(ext, key) && ext !== undefined) {
      // Custom fields: the extension knows the order of the values (options, iterations in calendar order)
      const order = ext
        .getCategories(key, scheduled, viewOptions)
        .filter((c): c is string | undefined => c === undefined || typeof c === 'string')
      return groupItems(scheduled, groupValueOf, order, shouldShowAll)
    }
    const groups = groupItems(scheduled, groupValueOf)
    switch (key) {
      case 'status':
        return [...groups].sort((a, b) => {
          if (a.value === undefined || b.value === undefined) return a.value === b.value ? 0 : a.value === undefined ? 1 : -1
          const sa = $statusStore.byId.get(a.value as any)
          const sb = $statusStore.byId.get(b.value as any)
          // Not started, active, done, canceled; then by name
          return statusRank(sa?.category) - statusRank(sb?.category) || (sa?.name ?? '').localeCompare(sb?.name ?? '')
        })
      case 'priority': {
        // Urgent first, "No priority" (0) last
        const rank = (v: string | undefined): number => (v === undefined ? 10 : Number(v) === 0 ? 9 : Number(v))
        return [...groups].sort((a, b) => rank(a.value) - rank(b.value))
      }
      default:
        return sortGroupsByLabel(groups, (v) => groupLabel(v))
    }
  }

  function groupLabel (value: string | undefined): string {
    if (value === undefined) return ext?.emptyGroupLabel(groupKey) ?? text('noValue')
    const fieldKey = parseCustomFieldViewKey(groupKey)
    if (fieldKey !== undefined) {
      const field = $registry.byKey.get(fieldKey)
      if (field === undefined) return value
      return (
        formatCustomValue(field, { [field.key]: value }, iterationsByKey.get(field.key) ?? [], $themeStore.language) ?? value
      )
    }
    switch (groupKey) {
      case 'status':
        return $statusStore.byId.get(value as any)?.name ?? value
      case 'kind':
        return $taskTypeStore.get(value as any)?.name ?? value
      case 'assignee':
        return assignees.get(value) ?? value
      case 'priority':
        return priorityNames.get(Number(value)) ?? value
      case 'component':
        return componentById.get(value) ?? value
      case 'milestone':
        return milestoneById.get(value)?.label ?? value
      default:
        return value
    }
  }

  $: groups = buildGroups(split.scheduled, groupKey, [ext, $statusStore, $taskTypeStore, $registry, iterationsByKey, assignees, componentById, milestoneById, priorityNames, texts], viewOptions.shouldShowAll === true)

  // Sums of the chosen number fields in the group headers (GitHub's "Field sum"); the items of a group are the ones
  // the view shows, so what the filter leaves out is not counted
  let summable: SummableField[] = []
  $: void loadSummableFields($registry.fields, $themeStore.language).then((res) => {
    summable = res
  })
  $: sumFields = resolveFieldSums(readFieldSums(viewOptions), summable)
  $: groupSums = new Map<string, string>(
    sumFields.length === 0
      ? []
      : groups.flatMap((g): Array<[string, string]> => {
        const text = formatFieldSums(computeFieldSums(g.items, sumFields))
        return text === undefined ? [] : [[g.id, text]]
      })
  )

  let collapsed = new Set<string>()
  function toggleGroup (id: string): void {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    collapsed = next
  }

  $: layout = buildRows<Issue>({
    groups,
    unscheduled: split.unscheduled,
    idOf,
    collapsed,
    showGroupHeaders: grouping
  })

  // ---- time axis ----
  $: markers = collectMarkers({
    settings: config.markers,
    milestones,
    iterationFields,
    iterations: (key) => iterationsByKey.get(key) ?? [],
    sources: sourceMap,
    issues: items,
    lookups
  })

  $: dataDays = (() => {
    const days: number[] = []
    for (const s of schedules.values()) days.push(...scheduleDays(s))
    for (const m of markers) {
      days.push(m.day)
      if (m.endDay !== undefined) days.push(m.endDay)
    }
    return days
  })()
  $: wanted = computeRange(config.zoom, dataDays, today)

  // The axis only grows while the view is open, so that rescheduling an item does not shift the whole canvas
  let stable: { startDay: number, endDay: number, zoom: string } | undefined
  let pendingShiftPx = 0

  function nextRange (
    range: { startDay: number, endDay: number },
    zoom: RoadmapConfig['zoom']
  ): { startDay: number, endDay: number } {
    if (stable === undefined || stable.zoom !== zoom) {
      stable = { ...range, zoom }
      return range
    }
    const startDay = Math.min(stable.startDay, range.startDay)
    const endDay = Math.max(stable.endDay, range.endDay)
    if (startDay < stable.startDay) pendingShiftPx += (stable.startDay - startDay) * PX_PER_DAY[zoom]
    stable = { startDay, endDay, zoom }
    return { startDay, endDay }
  }
  $: range = nextRange(wanted, config.zoom)
  let scale: RoadmapScale
  $: scale = createScale(config.zoom, range.startDay, range.endDay)
  $: header = headerRows(scale)
  $: visibleMarkers = markersInRange(markers, scale.startDay, scale.endDay)
  $: todayX = scale.dayToX(today) + scale.pxPerDay / 2

  // ---- scrolling ----
  let scroller: HTMLDivElement | undefined
  let scrollTop = 0
  let viewportHeight = 600
  let viewportWidth = 1000
  let pendingCenter: { day: number, anchor: number } | undefined

  function onScroll (): void {
    scrollTop = scroller?.scrollTop ?? 0
  }

  function axisViewport (): number {
    return Math.max(100, viewportWidth - LEFT_WIDTH)
  }

  function scrollToDay (day: number, anchor: number): void {
    if (scroller === undefined) return
    scroller.scrollLeft = scrollLeftForDay(scale, day, axisViewport(), anchor)
  }

  function centerDay (): number {
    if (scroller === undefined) return today
    return scale.xToDay(scroller.scrollLeft + axisViewport() / 2)
  }

  async function onConfigChange (e: CustomEvent<RoadmapConfig>): Promise<void> {
    const next = e.detail
    // Keep the middle of the visible time span in place when the zoom changes
    if (next.zoom !== config.zoom) pendingCenter = { day: centerDay(), anchor: 0.5 }
    changeConfig(next)
    await tick()
  }

  afterUpdate(() => {
    if (scroller === undefined) return
    if (pendingShiftPx !== 0) {
      scroller.scrollLeft += pendingShiftPx
      pendingShiftPx = 0
    }
    if (pendingCenter !== undefined) {
      const { day, anchor } = pendingCenter
      pendingCenter = undefined
      scrollToDay(day, anchor)
    }
  })

  onMount(() => {
    pendingShiftPx = 0
    // The viewport size is known after the first layout
    void tick().then(() => {
      scrollToDay(today, 0.25)
    })
  })

  // ---- visible rows ----
  $: [firstRow, lastRow] = visibleRowRange(layout.rows, scrollTop, viewportHeight)
  $: visibleRows = layout.rows.slice(firstRow, lastRow)

  // ---- item text ----
  let resolvers: LabelResolvers<Issue>
  $: resolvers = {
    status: (i) => $statusStore.byId.get(i.status)?.name,
    assignee: (i) => (i.assignee != null ? assignees.get(i.assignee) : undefined),
    priority: (i) => priorityNames.get(i.priority),
    component: (i) => (i.component != null ? componentById.get(i.component) : undefined),
    milestone: (i) => (i.milestone != null ? milestoneById.get(i.milestone)?.label : undefined),
    labels: (i) => labelRefs.get(i._id) ?? [],
    custom: (i, key) => {
      const field = $registry.byKey.get(key)
      return field === undefined
        ? undefined
        : formatCustomValue(field, i.customFields, iterationsByKey.get(key) ?? [], $themeStore.language)
    }
  }

  $: needsLabels = config.fields.includes(LABEL_FIELD_LABELS)
  $: if (needsLabels) {
    labelRefQuery.query(
      tags.class.TagReference,
      { ...(project !== undefined ? { space: project } : {}), attachedToClass: tracker.class.Issue },
      (res: TagReference[]) => {
        const byIssue = new Map<string, string[]>()
        for (const r of res) {
          const list = byIssue.get(r.attachedTo) ?? []
          list.push(r.title)
          byIssue.set(r.attachedTo, list)
        }
        labelRefs = byIssue
      },
      { projection: { attachedTo: 1, title: 1 } }
    )
  } else {
    labelRefQuery.unsubscribe()
    labelRefs = new Map()
  }

  function barColor (issue: Issue, store: typeof $statusStore): string {
    const category = store.byId.get(issue.status)?.category
    if (category === task.statusCategory.Won) return 'var(--theme-won-color, #3fb950)'
    if (category === task.statusCategory.Lost) return 'var(--theme-dark-color, #8b949e)'
    return 'var(--primary-button-default, #4b6bfb)'
  }

  function dateText (schedule: ItemSchedule): string {
    const format = new Intl.DateTimeFormat($themeStore.language, { dateStyle: 'medium', timeZone: 'UTC' })
    const fmt = (day: number): string => format.format(new Date(day * 86400000))
    switch (schedule.kind) {
      case 'range':
        return `${fmt(schedule.start)} – ${fmt(schedule.target)}`
      case 'marker':
        return fmt(schedule.day)
      case 'unscheduled':
        return ''
    }
  }

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

  // Whether dragging the item that way can change anything (a milestone date cannot be written, a marker has one edge)
  function canDrag (issue: Issue, mode: RescheduleMode): boolean {
    if (readonly) return false
    const plan = planReschedule(planContext(issue), mode, 1)
    return plan.ok || (plan.reason !== 'readonly' && plan.reason !== 'unsupported' && plan.reason !== 'noSchedule')
  }

  async function applyPlan (issue: Issue, plan: DatePlan): Promise<void> {
    if (plan.ok === false) {
      if (plan.reason === 'readonly') showToast({ text: text('readonly') })
      return
    }
    const patch = buildIssuePatch(issue, plan.writes)
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

  // Sets the dates of an item without dates (or the missing one of a marker) to a day
  async function scheduleAt (issue: Issue, day: number): Promise<void> {
    if (readonly) return
    const plan = planSchedule({ issue, selection, sources: sourceMap, lookups }, day)
    await applyPlan(issue, plan)
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

  function timelineClick (ev: MouseEvent, issue: Issue): void {
    const cell = ev.currentTarget as HTMLElement
    const x = ev.clientX - cell.getBoundingClientRect().left
    void scheduleAt(issue, scale.xToDay(x))
  }

  // ---- drag to reschedule ----
  interface DragState {
    id: string
    mode: RescheduleMode
    startX: number
    delta: number
    moved: boolean
    allowed: boolean
  }
  let drag: DragState | undefined
  let dragIssue: Issue | undefined

  function startDrag (ev: PointerEvent, issue: Issue, mode: RescheduleMode): void {
    if (ev.button !== 0) return
    ev.preventDefault()
    ev.stopPropagation()
    dragIssue = issue
    drag = { id: issue._id, mode, startX: ev.clientX, delta: 0, moved: false, allowed: canDrag(issue, mode) }
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
    const dx = ev.clientX - drag.startX
    const moved = drag.moved || Math.abs(dx) > DRAG_THRESHOLD_PX
    drag = { ...drag, moved, delta: drag.allowed && moved ? pixelsToDays(dx, scale.pxPerDay) : 0 }
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
      void openDoc(hierarchy, issue)
      return
    }
    if (!state.allowed) {
      if (!readonly) showToast({ text: text('readonly') })
      return
    }
    void applyPlan(issue, planReschedule(planContext(issue), state.mode, state.delta))
  }

  onDestroy(() => {
    stopDrag()
  })

  function shownSchedule (issue: Issue, base: ItemSchedule, state: DragState | undefined): ItemSchedule {
    return state !== undefined && state.id === issue._id ? previewSchedule(base, state.mode, state.delta) : base
  }

  function openIssue (issue: Issue): void {
    void openDoc(hierarchy, issue)
  }

  function rowKey (row: RoadmapRow<Issue>): string {
    return row.type === 'item' ? row.id : `${row.type}:${row.id}`
  }
</script>

<div class="roadmap" data-id="roadmap-view">
  <RoadmapToolbar
    {config}
    {sources}
    {iterationFields}
    {labelFields}
    on:change={onConfigChange}
    on:today={() => {
      scrollToDay(today, 0.3)
    }}
  />
  {#if truncated}
    <div class="notice" role="status">
      <Label label={tracker.string.RoadmapTruncated} params={{ limit: ITEM_LIMIT }} />
    </div>
  {/if}
  <div
    class="scroller"
    bind:this={scroller}
    bind:clientHeight={viewportHeight}
    bind:clientWidth={viewportWidth}
    on:scroll={onScroll}
    data-id="roadmap-scroller"
  >
    <div class="canvas" style:width="{LEFT_WIDTH + scale.width}px" style:height="{HEADER_HEIGHT + layout.height}px">
      <!-- header: coarse and fine ticks, then the labels of the markers -->
      <div class="header" style:height="{HEADER_HEIGHT}px">
        <div class="header-left" style:width="{LEFT_WIDTH}px" />
        <div class="header-axis" style:left="{LEFT_WIDTH}px" style:width="{scale.width}px">
          <div class="tick-row" style:height="{TOP_ROW_HEIGHT}px">
            {#each header.top as tick (tick.startDay)}
              <div class="tick top" style:left="{tick.x}px" style:width="{tick.width}px">
                <span class="tick-label">{formatTick(tick, $themeStore.language, 'top')}</span>
              </div>
            {/each}
          </div>
          <div class="tick-row" style:height="{BOTTOM_ROW_HEIGHT}px">
            {#each header.bottom as tick (tick.startDay)}
              <div class="tick bottom" style:left="{tick.x}px" style:width="{tick.width}px">
                <span class="tick-label">{formatTick(tick, $themeStore.language, 'bottom')}</span>
              </div>
            {/each}
          </div>
          <div class="marker-row" style:height="{MARKER_ROW_HEIGHT}px">
            {#each visibleMarkers as marker (marker.id)}
              <span
                class="marker-flag {marker.kind}"
                style:left="{scale.dayToX(marker.day)}px"
                style:--marker-color={marker.color !== undefined ? getPlatformColor(marker.color, $themeStore.dark) : undefined}
                title={marker.count !== undefined ? `${marker.label} (${marker.count})` : marker.label}
                data-id="roadmap-marker"
              >
                {marker.label}
              </span>
            {/each}
          </div>
        </div>
      </div>

      <div class="body" style:top="{HEADER_HEIGHT}px" style:height="{layout.height}px">
        <!-- grid lines, iteration spans, marker lines and today -->
        <div class="axis-layer" style:left="{LEFT_WIDTH}px" style:width="{scale.width}px">
          {#each header.bottom as tick (tick.startDay)}
            <div class="grid-line" style:left="{tick.x}px" />
          {/each}
          {#each visibleMarkers as marker (marker.id)}
            {#if marker.endDay !== undefined}
              <div
                class="iteration-span"
                style:left="{scale.dayToX(marker.day)}px"
                style:width="{(marker.endDay - marker.day + 1) * scale.pxPerDay}px"
              />
            {/if}
            <div
              class="marker-line {marker.kind}"
              style:left="{scale.dayToX(marker.day)}px"
              style:--marker-color={marker.color !== undefined ? getPlatformColor(marker.color, $themeStore.dark) : undefined}
            />
          {/each}
          <div class="today-line" style:left="{todayX}px" data-id="roadmap-today-line" />
        </div>

        {#each visibleRows as row (rowKey(row))}
          {#if row.type === 'item'}
            {@const issue = row.item}
            {@const base = scheduleOf(issue)}
            {@const schedule = shownSchedule(issue, base, drag)}
            {@const shape = itemShape(schedule, scale)}
            {@const label = buildItemLabel(issue, config.fields, resolvers)}
            {@const placement = shape !== undefined ? placeLabel(shape, estimateTextWidth(label), scale.width) : 'right'}
            {@const dragging = drag?.id === issue._id && drag.moved}
            <div
              class="row item-row"
              class:dragging
              style:top="{row.y}px"
              style:height="{row.height}px"
              style:width="{LEFT_WIDTH + scale.width}px"
              data-id="roadmap-row"
              on:contextmenu={(ev) => {
                showMenu(ev, { object: issue })
              }}
            >
              <div class="left-cell" style:width="{LEFT_WIDTH}px">
                <button
                  class="title-button"
                  type="button"
                  on:click={() => {
                    openIssue(issue)
                  }}
                >
                  <span class="identifier">{issue.identifier}</span>
                  <span class="title">{issue.title}</span>
                </button>
                {#if row.unscheduled && !readonly}
                  <button
                    class="set-dates"
                    type="button"
                    data-id="roadmap-set-dates"
                    on:click={(ev) => {
                      pickDates(ev, issue)
                    }}
                  >
                    <Label label={tracker.string.RoadmapSetDates} />
                  </button>
                {/if}
              </div>
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div
                class="timeline-cell"
                class:schedulable={row.unscheduled && !readonly}
                style:left="{LEFT_WIDTH}px"
                style:width="{scale.width}px"
                on:click={(ev) => {
                  if (row.unscheduled) timelineClick(ev, issue)
                }}
              >
                {#if shape !== undefined}
                  <!-- svelte-ignore a11y-no-static-element-interactions -->
                  <div
                    class="item-shape {shape.kind}"
                    class:draggable={canDrag(issue, 'move')}
                    class:inverted={schedule.kind === 'range' && schedule.inverted}
                    style:left="{shape.x}px"
                    style:width="{shape.width}px"
                    style:--item-color={barColor(issue, $statusStore)}
                    title="{label !== '' ? label + '\n' : ''}{dateText(schedule)}"
                    role="button"
                    tabindex="0"
                    data-id="roadmap-bar"
                    on:pointerdown={(ev) => {
                      startDrag(ev, issue, 'move')
                    }}
                    on:keydown={(ev) => {
                      if (ev.key === 'Enter') openIssue(issue)
                    }}
                  >
                    {#if shape.kind === 'bar' && placement === 'inside'}
                      <span class="inside-label">{label}</span>
                    {/if}
                    {#if shape.kind === 'bar' && base.kind === 'range' && !base.inverted}
                      {#if canDrag(issue, 'resize-start')}
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div
                          class="handle start"
                          data-id="roadmap-resize-start"
                          on:pointerdown={(ev) => {
                            startDrag(ev, issue, 'resize-start')
                          }}
                        />
                      {/if}
                      {#if canDrag(issue, 'resize-end')}
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div
                          class="handle end"
                          data-id="roadmap-resize-end"
                          on:pointerdown={(ev) => {
                            startDrag(ev, issue, 'resize-end')
                          }}
                        />
                      {/if}
                    {/if}
                  </div>
                  {#if label !== '' && placement !== 'inside'}
                    <span
                      class="outside-label"
                      style:left={placement === 'right' ? `${shape.x + shape.width + 8}px` : undefined}
                      style:right={placement === 'left' ? `${scale.width - shape.x + 8}px` : undefined}
                    >
                      {label}
                    </span>
                  {/if}
                {:else if row.unscheduled && !readonly}
                  <span class="ghost"><Label label={tracker.string.RoadmapSetDates} /></span>
                {/if}
              </div>
            </div>
          {:else}
            <!-- group header or the header of the unscheduled section -->
            <div
              class="row group-row"
              class:unscheduled-row={row.type === 'unscheduled'}
              style:top="{row.y}px"
              style:height="{row.height}px"
              style:width="{LEFT_WIDTH + scale.width}px"
            >
              <button
                class="group-toggle"
                type="button"
                style:width="{LEFT_WIDTH}px"
                aria-expanded={!row.collapsed}
                on:click={() => {
                  toggleGroup(row.id)
                }}
              >
                <Icon icon={row.collapsed ? IconChevronRight : IconDown} size={'small'} />
                <span class="group-label">
                  {#if row.type === 'unscheduled'}
                    <Label label={tracker.string.RoadmapUnscheduled} />
                  {:else}
                    {groupLabel(groups.find((g) => g.id === row.id)?.value)}
                  {/if}
                </span>
                <span class="count">{row.count}</span>
                {#if row.type !== 'unscheduled' && groupSums.has(row.id)}
                  <span class="group-sums" data-id="roadmap-group-sums" title={groupSums.get(row.id)}>
                    {groupSums.get(row.id)}
                  </span>
                {/if}
              </button>
            </div>
          {/if}
        {/each}
      </div>
    </div>
    {#if ready && layout.rows.length === 0}
      <div class="empty"><Label label={tracker.string.RoadmapEmpty} /></div>
    {/if}
  </div>

  {#if toast !== undefined}
    <div class="toast" role="status" data-id="roadmap-toast">
      <span>{toast.text}</span>
      {#if toast.undo !== undefined}
        <button
          class="undo"
          type="button"
          data-id="roadmap-undo"
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
  .roadmap {
    position: relative;
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-height: 0;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }
  .notice {
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    color: var(--theme-warning-color, #9a6700);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .scroller {
    position: relative;
    flex-grow: 1;
    min-height: 0;
    overflow: auto;
    background: var(--theme-bg-color);
  }
  .canvas {
    position: relative;
  }
  .empty {
    position: absolute;
    left: 0;
    right: 0;
    top: 6rem;
    text-align: center;
    color: var(--theme-dark-color);
    pointer-events: none;
  }

  /* ---- header ---- */
  .header {
    position: sticky;
    top: 0;
    z-index: 6;
    background: var(--theme-bg-color);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .header-left {
    position: sticky;
    left: 0;
    z-index: 7;
    height: 100%;
    background: var(--theme-bg-color);
    border-right: 1px solid var(--theme-divider-color);
  }
  .header-axis {
    position: absolute;
    top: 0;
    bottom: 0;
  }
  .tick-row {
    position: relative;
  }
  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    padding: 0 0.375rem;
    overflow: hidden;
    border-left: 1px solid var(--theme-divider-color);
    font-size: 0.75rem;
    color: var(--theme-content-color);
    white-space: nowrap;

    &.top {
      font-weight: 500;
      color: var(--theme-caption-color);
    }
  }
  .tick-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .marker-row {
    position: relative;
    overflow: hidden;
  }
  .marker-flag {
    position: absolute;
    top: 3px;
    max-width: 12rem;
    padding: 0 0.375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.6875rem;
    line-height: 1rem;
    border-radius: 0.25rem;
    color: #fff;
    background: var(--marker-color, var(--theme-dark-color));

    &.iteration {
      color: var(--theme-caption-color);
      background: var(--theme-button-default, rgba(128, 128, 128, 0.2));
    }
    &.date {
      color: var(--theme-caption-color);
      background: transparent;
      border: 1px dashed var(--theme-dark-color);
    }
  }

  /* ---- body ---- */
  .body {
    position: absolute;
    left: 0;
    right: 0;
  }
  .axis-layer {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 1;
  }
  .grid-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--theme-divider-color);
    opacity: 0.6;
  }
  .iteration-span {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--theme-button-default, rgba(128, 128, 128, 0.2));
    opacity: 0.35;
  }
  .marker-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 2px solid var(--marker-color, var(--theme-dark-color));

    &.iteration {
      border-left: 1px solid var(--theme-dark-color);
    }
    &.date {
      border-left: 1px dashed var(--theme-dark-color);
    }
  }
  .today-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 2px solid var(--theme-error-color, #d73a49);
    z-index: 2;
  }

  .row {
    position: absolute;
    left: 0;
    z-index: 3;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .left-cell {
    position: sticky;
    left: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    height: 100%;
    padding: 0 0.5rem 0 0.75rem;
    background: var(--theme-bg-color);
    border-right: 1px solid var(--theme-divider-color);
    box-sizing: border-box;
  }
  .item-row:hover .left-cell {
    background: var(--theme-table-row-hover, var(--theme-bg-accent-color));
  }
  .title-button {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-grow: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    color: var(--theme-caption-color);
    cursor: pointer;
  }
  .identifier {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .set-dates {
    flex-shrink: 0;
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    background: transparent;
    color: var(--theme-content-color);
    cursor: pointer;

    &:hover {
      color: var(--theme-caption-color);
      background: var(--theme-button-hovered);
    }
  }
  .timeline-cell {
    position: absolute;
    top: 0;
    bottom: 0;

    &.schedulable {
      cursor: copy;
    }
  }
  .ghost {
    position: absolute;
    left: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    padding: 0 0.5rem;
    font-size: 0.75rem;
    border: 1px dashed var(--theme-dark-color);
    border-radius: 0.25rem;
    color: var(--theme-dark-color);
    opacity: 0;
    pointer-events: none;
  }
  .item-row:hover .ghost {
    opacity: 1;
  }

  .item-shape {
    position: absolute;
    top: 50%;
    z-index: 4;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    height: 1.5rem;
    transform: translateY(-50%);
    background: var(--item-color);
    color: #fff;
    cursor: pointer;
    user-select: none;
    touch-action: none;

    &.bar {
      border-radius: 0.375rem;
      overflow: hidden;
    }
    &.marker {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 0.125rem;
      transform: translateY(-50%) rotate(45deg);
    }
    &.draggable.bar {
      cursor: grab;
    }
    &.inverted {
      background-image: repeating-linear-gradient(
        135deg,
        transparent 0,
        transparent 4px,
        rgba(255, 255, 255, 0.25) 4px,
        rgba(255, 255, 255, 0.25) 8px
      );
    }
    &:focus-visible {
      outline: 2px solid var(--primary-button-focused-border, var(--theme-caption-color));
      outline-offset: 1px;
    }
  }
  .dragging .item-shape {
    opacity: 0.85;
    cursor: grabbing;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  .inside-label {
    flex-grow: 1;
    min-width: 0;
    padding: 0 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    pointer-events: none;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0.5rem;
    cursor: ew-resize;
    background: rgba(255, 255, 255, 0);

    &:hover {
      background: rgba(255, 255, 255, 0.35);
    }
    &.start {
      left: 0;
    }
    &.end {
      right: 0;
    }
  }
  .outside-label {
    position: absolute;
    top: 50%;
    z-index: 4;
    transform: translateY(-50%);
    max-width: 24rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    color: var(--theme-caption-color);
    pointer-events: none;
  }

  .group-row {
    background: var(--theme-bg-accent-color, rgba(128, 128, 128, 0.08));
    z-index: 3;
  }
  .group-toggle {
    position: sticky;
    left: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    height: 100%;
    padding: 0 0.75rem;
    border: none;
    background: var(--theme-bg-accent-color, rgba(128, 128, 128, 0.08));
    color: var(--theme-caption-color);
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    box-sizing: border-box;
  }
  .group-label {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    flex-shrink: 0;
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--theme-dark-color);
  }
  .group-sums {
    flex-shrink: 1;
    min-width: 0;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--theme-dark-color);
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
