<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { getCurrentEmployee } from '@hcengineering/contact'
  import { generateId, getCurrentAccount } from '@hcengineering/core'
  import type { Ref } from '@hcengineering/core'
  import { setPlatformStatus, translate, unknownError } from '@hcengineering/platform'
  import type { IntlString } from '@hcengineering/platform'
  import { getClient, getCurrentWorkspaceUuid } from '@hcengineering/presentation'
  import type { Issue, TimeSpendReport } from '@hcengineering/tracker'
  import { addNotification, Button, Label, navigate, NotificationSeverity, showPopup } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'
  import { writable } from 'svelte/store'
  import { generateIssueShortLink, issueLinkFragmentProvider } from '../../../issues'
  import tracker from '../../../plugin'
  import SelectDependencyIssuePopup from '../SelectDependencyIssuePopup.svelte'
  import TimeSpendReportPopup from './TimeSpendReportPopup.svelte'
  import {
    discardIssueTimer,
    formatElapsedTime,
    getElapsedTime,
    getStoppedTimerHours,
    readIssueTimer,
    startIssueTimer,
    stopIssueTimer,
    withIssueTimerLock
  } from './issue-timer'
  import type { RunningIssueTimer } from './issue-timer'

  export let issue: Issue

  // Other timer controls in this window; the storage event only reaches other tabs.
  const changedEvent = 'tracker:issue-timer-changed'

  const client = getClient()
  const employee = getCurrentEmployee()
  const key = `tracker:issue-timer:${getCurrentWorkspaceUuid()}:${getCurrentAccount().uuid}`
  const timer = writable<RunningIssueTimer | undefined>(undefined)
  let now = Date.now()
  let busy = false
  let reviewing = false
  let missingReportId: string | undefined
  let unavailable = false
  let tick: ReturnType<typeof setInterval> | undefined

  function refresh(): void {
    try {
      timer.set(readIssueTimer(localStorage, key))
      now = Date.now()
      unavailable = false
    } catch (err) {
      if (!unavailable) void setPlatformStatus(unknownError(err))
      unavailable = true
    }
  }

  function notifyChanged(): void {
    window.dispatchEvent(new Event(changedEvent))
  }

  async function notify(label: IntlString, params: Record<string, any> = {}): Promise<void> {
    addNotification(await translate(label, params), '', undefined as any, undefined, NotificationSeverity.Warning)
  }

  onMount(() => {
    refresh()
    window.addEventListener('storage', refresh)
    window.addEventListener(changedEvent, refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener(changedEvent, refresh)
    }
  })

  // Tick only while a timer runs; changes from other tabs arrive through the storage event.
  $: running = $timer !== undefined && $timer.stoppedAt === undefined
  $: if (running && tick === undefined) {
    tick = setInterval(() => (now = Date.now()), 1000)
  } else if (!running && tick !== undefined) {
    clearInterval(tick)
    tick = undefined
  }
  onDestroy(() => {
    if (tick !== undefined) clearInterval(tick)
  })

  async function startTimer(): Promise<void> {
    let started = false
    await withIssueTimerLock(key, async () => {
      started = startIssueTimer(localStorage, key, {
        issueId: issue._id,
        identifier: issue.identifier,
        reportId: generateId(),
        startedAt: Date.now()
      })
    })
    // Another tab may have started a timer after this control was rendered.
    if (!started) await notify(tracker.string.TimerAlreadyRunning)
  }

  async function reportExists(id: Ref<TimeSpendReport>): Promise<boolean> {
    return (await client.findOne(tracker.class.TimeSpendReport, { _id: id })) !== undefined
  }

  async function finishIfSaved(stopped: RunningIssueTimer): Promise<boolean> {
    const saved = await reportExists(stopped.reportId as Ref<TimeSpendReport>)
    if (saved) {
      await withIssueTimerLock(key, async () => {
        discardIssueTimer(localStorage, key, stopped.reportId)
      })
    }
    return saved
  }

  /** Stop the timer and let the user review the measured time, description and date before saving. */
  async function stopTimer(reportId: string): Promise<void> {
    let stopped: RunningIssueTimer | undefined
    await withIssueTimerLock(key, async () => {
      stopped = stopIssueTimer(localStorage, key, reportId)
    })
    if (stopped === undefined) return
    const hours = getStoppedTimerHours(stopped)
    if (hours === 0) {
      await withIssueTimerLock(key, async () => {
        discardIssueTimer(localStorage, key, reportId)
      })
      return
    }
    // A report saved earlier, e.g. from another tab, must not be created twice.
    if (await finishIfSaved(stopped)) return
    const target = await client.findOne(tracker.class.Issue, { _id: stopped.issueId as Ref<Issue> })
    if (target === undefined) {
      // Keep the stopped time; the user can retry, log it to an issue of their choice or discard it.
      missingReportId = stopped.reportId
      await notify(tracker.string.TimerIssueUnavailable, {
        issue: stopped.identifier,
        time: formatElapsedTime(getElapsedTime(stopped.startedAt, stopped.stoppedAt ?? stopped.startedAt))
      })
      return
    }
    missingReportId = undefined
    openReportPopup(stopped, target, hours)
  }

  function openReportPopup(timed: RunningIssueTimer, target: Issue, hours: number): void {
    reviewing = true
    showPopup(
      TimeSpendReportPopup,
      {
        issue: target,
        issueId: target._id,
        issueClass: target._class,
        space: target.space,
        assignee: target.assignee,
        reportId: timed.reportId,
        initialValue: { value: hours, date: timed.startedAt }
      },
      'top',
      () => {
        void finishIfSaved(timed)
          .catch((err) => setPlatformStatus(unknownError(err)))
          .finally(() => {
            reviewing = false
            refresh()
            notifyChanged()
          })
      }
    )
  }

  /** Let the user pick the issue to log a stopped timer to when its own issue is unavailable. */
  function logToAnotherIssue(): void {
    const timed = $timer
    if (timed?.stoppedAt === undefined || busy || reviewing) return
    showPopup(SelectDependencyIssuePopup, {}, 'top', (picked: Issue | undefined | null) => {
      if (picked === undefined || picked === null) return
      openReportPopup(timed, picked, getStoppedTimerHours(timed))
    })
  }

  async function updateTimer(discard = false): Promise<void> {
    if (busy || reviewing || unavailable) return
    busy = true
    const displayedTimer = $timer
    try {
      if (displayedTimer === undefined) {
        await startTimer()
      } else if (discard) {
        await withIssueTimerLock(key, async () => {
          discardIssueTimer(localStorage, key, displayedTimer.reportId)
        })
      } else {
        await stopTimer(displayedTimer.reportId)
      }
    } catch (err) {
      void setPlatformStatus(unknownError(err))
    } finally {
      busy = false
      refresh()
      notifyChanged()
    }
  }

  async function openTimedIssue(): Promise<void> {
    const timedIssueId = $timer?.issueId as Ref<Issue> | undefined
    if (timedIssueId === undefined) return
    const timedIssue = await client.findOne(tracker.class.Issue, { _id: timedIssueId })
    if (timedIssue === undefined) {
      await notify(tracker.string.TimerIssueUnavailable, {
        issue: $timer?.identifier,
        time: $timer === undefined ? '' : formatElapsedTime(getElapsedTime($timer.startedAt, $timer.stoppedAt ?? now))
      })
      return
    }
    navigate(await issueLinkFragmentProvider(timedIssue))
  }

  $: otherIssue = $timer !== undefined && $timer.issueId !== issue._id
  $: label =
    $timer === undefined
      ? tracker.string.StartTimer
      : $timer.stoppedAt === undefined
        ? otherIssue
          ? tracker.string.StopTimerOnIssue
          : tracker.string.StopTimer
        : otherIssue
          ? tracker.string.SaveTimerOnIssue
          : tracker.string.SaveTimer
</script>

{#if employee != null}
  <div class="flex-row-center gap-2">
    {#if $timer !== undefined}
      {#if otherIssue}
        <a
          class="nowrap"
          href={generateIssueShortLink($timer.identifier)}
          on:click|preventDefault={() => {
            void openTimedIssue().catch((err) => setPlatformStatus(unknownError(err)))
          }}
        >
          <Label label={tracker.string.TimerRunningOnIssue} params={{ issue: $timer.identifier }} />
        </a>
      {/if}
      <span class="nowrap">{formatElapsedTime(getElapsedTime($timer.startedAt, $timer.stoppedAt ?? now))}</span>
    {/if}
    <Button
      kind={'ghost'}
      size={'medium'}
      {label}
      labelParams={{ issue: $timer?.identifier }}
      disabled={busy || reviewing || unavailable}
      on:click={() => updateTimer()}
    />
    {#if $timer !== undefined && $timer.stoppedAt !== undefined && $timer.reportId === missingReportId}
      <Button
        kind={'ghost'}
        size={'medium'}
        label={tracker.string.LogTimerToAnotherIssue}
        disabled={busy || reviewing || unavailable}
        on:click={logToAnotherIssue}
      />
    {/if}
    {#if $timer !== undefined}
      <Button
        kind={'ghost'}
        size={'medium'}
        label={tracker.string.DiscardTimer}
        disabled={busy || reviewing || unavailable}
        on:click={() => updateTimer(true)}
      />
    {/if}
  </div>
{/if}
