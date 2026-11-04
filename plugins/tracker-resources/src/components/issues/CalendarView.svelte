<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { mergeQueries, SortingOrder, type DocumentQuery, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import type { Issue, Project } from '@hcengineering/tracker'
  import ui, { Button, IconBack, IconForward, Label, MonthCalendar, showPanel, themeStore } from '@hcengineering/ui'
  import {
    claimResultCountOwner,
    releaseResultCountOwner,
    restrictionStore,
    setResultCount
  } from '@hcengineering/view-resources'
  import { onDestroy } from 'svelte'
  import tracker from '../../plugin'
  import { canEditIssue, canEditIssuesBatch } from '../../utils'
  import {
    getCalendarDayKey,
    getCalendarQueryWindow,
    groupIssuesByCalendarDay,
    moveCalendarMonth,
    moveIssueToCalendarDay
  } from './calendar-dates'

  export let space: Ref<Project> | undefined = undefined
  export let query: DocumentQuery<Issue> = {}

  const client = getClient()
  const issueQuery = createQuery()
  const spanningQuery = createQuery()
  const withoutDueDateQuery = createQuery()
  const totalQuery = createQuery()
  const resultCountOwner = claimResultCountOwner()
  let currentDate = new Date()
  let windowIssues: Issue[] = []
  let spanningIssues: Issue[] = []
  let issues: Issue[] = []
  let withoutDueDate = 0
  let editable = new Map<Ref<Issue>, boolean>()
  let permissionGeneration = 0
  let draggedIssue: Ref<Issue> | undefined
  let dropTargetDay: number | undefined
  let saving = false
  let updateFailed = false

  onDestroy(() => {
    permissionGeneration++
    releaseResultCountOwner(resultCountOwner)
  })

  // Load only the visible grid: issues due inside it, plus ranges that start in or before it and end after it.
  $: baseQuery = mergeQueries(query, space === undefined ? {} : { space })
  $: calendarWindow = getCalendarQueryWindow(currentDate)
  $: issueQuery.query(
    tracker.class.Issue,
    mergeQueries(baseQuery, { dueDate: { $gte: calendarWindow.start, $lt: calendarWindow.end } }),
    (result) => {
      windowIssues = result
    },
    { sort: { dueDate: SortingOrder.Ascending, rank: SortingOrder.Ascending } }
  )
  $: spanningQuery.query(
    tracker.class.Issue,
    mergeQueries(baseQuery, { dueDate: { $gte: calendarWindow.end }, startDate: { $lt: calendarWindow.end } }),
    (result) => {
      spanningIssues = result
    },
    { sort: { dueDate: SortingOrder.Ascending, rank: SortingOrder.Ascending } }
  )
  $: withoutDueDateQuery.query(
    tracker.class.Issue,
    mergeQueries(baseQuery, { dueDate: null }),
    (result) => {
      withoutDueDate = result.total
    },
    { limit: 1, total: true }
  )
  // The search empty state must reflect every matching issue, not only those in the visible grid: a match
  // in another month or without a due date is still a result, and the grid itself always renders.
  $: totalQuery.query(
    tracker.class.Issue,
    baseQuery,
    (result) => {
      // Report on every answer, not via a reactive copy: a second search with no hits keeps the total at 0,
      // and the view resets the count to "not measured" on each search change. Until the first answer the
      // count stays unmeasured, so the empty state cannot flash while loading.
      setResultCount(resultCountOwner, result.total)
    },
    { limit: 1, total: true }
  )
  $: issues = [...windowIssues, ...spanningIssues]
  $: issuesByDay = groupIssuesByCalendarDay(issues, calendarWindow)
  $: void updatePermissions(issues)
  $: monthLabel = currentDate.toLocaleDateString($themeStore.language, { month: 'long', year: 'numeric' })

  function navigate(date: Date): void {
    currentDate = date
    updateFailed = false
  }

  function openIssue(issue: Issue): void {
    if ($restrictionStore.disableNavigation) return
    showPanel(tracker.component.EditIssue, issue._id, issue._class, 'content')
  }

  function dragLeave(event: DragEvent, date: Date): void {
    const target = event.currentTarget as HTMLElement
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return
    if (dropTargetDay === getCalendarDayKey(date)) dropTargetDay = undefined
  }

  function endDrag(): void {
    draggedIssue = undefined
    dropTargetDay = undefined
  }

  async function updatePermissions(values: Issue[]): Promise<void> {
    const generation = ++permissionGeneration
    editable = new Map()
    try {
      const result = await canEditIssuesBatch(values)
      if (generation === permissionGeneration) editable = result
    } catch (error) {
      Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  function startDrag(event: DragEvent, issue: Issue): void {
    if (saving || $restrictionStore.readonly || !editable.get(issue._id) || event.dataTransfer === null) {
      event.preventDefault()
      return
    }
    draggedIssue = issue._id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', issue._id)
  }

  function dragOver(event: DragEvent, date: Date): void {
    if (draggedIssue === undefined || saving || $restrictionStore.readonly) return
    event.preventDefault()
    dropTargetDay = getCalendarDayKey(date)
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
  }

  async function dropIssue(event: DragEvent, date: Date): Promise<void> {
    event.preventDefault()
    const id = draggedIssue
    endDrag()
    if (id === undefined || saving || $restrictionStore.readonly) return
    const issue = issues.find((value) => value._id === id)
    if (issue === undefined) return
    saving = true
    updateFailed = false
    try {
      // Read current dates before applying the move rather than overwriting an edit made during the drag.
      const current = await client.findOne(tracker.class.Issue, { _id: issue._id })
      if (current === undefined || !(await canEditIssue(current)) || $restrictionStore.readonly) return
      const update = moveIssueToCalendarDay(current, date)
      if (update === undefined) return
      await client.updateCollection(
        current._class,
        current.space,
        current._id,
        current.attachedTo,
        current.attachedToClass,
        current.collection,
        { ...update }
      )
    } catch (error) {
      updateFailed = true
      Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      saving = false
    }
  }
</script>

<div class="issue-calendar">
  <div class="calendar-header flex-row-center gap-2">
    <Button
      icon={IconBack}
      kind="ghost"
      label={ui.string.Back}
      on:click={() => {
        navigate(moveCalendarMonth(currentDate, -1))
      }}
    />
    <span class="month-label">{monthLabel}</span>
    <Button
      icon={IconForward}
      kind="ghost"
      label={ui.string.Next}
      on:click={() => {
        navigate(moveCalendarMonth(currentDate, 1))
      }}
    />
    <Button
      label={ui.string.Today}
      on:click={() => {
        navigate(new Date())
      }}
    />
    {#if withoutDueDate > 0}
      <span class="without-dates">
        <Label label={tracker.string.CalendarWithoutDueDate} params={{ count: withoutDueDate }} />
      </span>
    {/if}
  </div>
  {#if updateFailed}
    <div class="calendar-error" role="alert"><Label label={tracker.string.CalendarUpdateFailed} /></div>
  {/if}
  <MonthCalendar {currentDate} cellHeight="9rem">
    <svelte:fragment slot="cell" let:date let:today let:wrongMonth>
      <div
        class="calendar-day"
        class:wrong-month={wrongMonth}
        class:drop-target={draggedIssue !== undefined && dropTargetDay === getCalendarDayKey(date)}
        role="region"
        aria-label={date.toLocaleDateString($themeStore.language)}
        on:dragover={(event) => {
          dragOver(event, date)
        }}
        on:dragleave={(event) => {
          dragLeave(event, date)
        }}
        on:drop={(event) => void dropIssue(event, date)}
      >
        <span class="day-number" class:today>{date.getDate()}</span>
        <div class="day-issues">
          {#each issuesByDay.get(getCalendarDayKey(date)) ?? [] as issue (issue._id)}
            <button
              class="calendar-issue"
              type="button"
              title={`${issue.identifier} ${issue.title}`}
              draggable={!saving && !$restrictionStore.readonly && editable.get(issue._id) === true}
              aria-disabled={$restrictionStore.disableNavigation}
              on:dragstart={(event) => {
                startDrag(event, issue)
              }}
              on:dragend={endDrag}
              on:click|stopPropagation={() => {
                openIssue(issue)
              }}
            >
              <span class="issue-code">{issue.identifier}</span>
              {issue.title}
            </button>
          {/each}
        </div>
      </div>
    </svelte:fragment>
  </MonthCalendar>
</div>

<style lang="scss">
  .issue-calendar {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .calendar-header {
    flex-wrap: wrap;
    padding: 0.5rem;
  }

  .month-label {
    font-weight: 500;
  }

  .without-dates {
    margin-left: auto;
    color: var(--theme-halfcontent-color);
    font-size: 0.75rem;
  }

  .calendar-error {
    padding: 0.5rem;
  }

  .calendar-day {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    padding: 0.25rem;
    overflow: hidden;
    color: var(--theme-content-color);
  }

  .wrong-month {
    opacity: 0.6;
  }

  .drop-target {
    outline: 2px dashed var(--primary-button-outline);
    outline-offset: -2px;
    background: var(--theme-button-hovered);
  }

  .day-number {
    align-self: flex-end;
    padding: 0.125rem 0.375rem;
    border-radius: 50%;
  }

  .today {
    background: var(--theme-button-default);
    font-weight: 700;
  }

  .day-issues {
    min-height: 0;
    overflow-y: auto;
  }

  .calendar-issue {
    display: block;
    width: 100%;
    margin-top: 0.125rem;
    padding: 0.25rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    background: var(--theme-button-default);
    color: inherit;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;

    &[aria-disabled='true'] {
      cursor: default;
    }

    &:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: -2px;
    }
  }

  .issue-code {
    color: var(--theme-halfcontent-color);
    font-size: 0.75rem;
  }
</style>
