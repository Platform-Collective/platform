<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import contact, { getCurrentEmployee, type PersonSpace } from '@hcengineering/contact'
  import { permissionsStore } from '@hcengineering/contact-resources'
  import { generateId, getCurrentAccount } from '@hcengineering/core'
  import type { Ref } from '@hcengineering/core'
  import { setPlatformStatus, translate, unknownError } from '@hcengineering/platform'
  import type { IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import type { Issue, IssueTimer, TimeSpendReport } from '@hcengineering/tracker'
  import { addNotification, Button, Label, navigate, NotificationSeverity, showPopup } from '@hcengineering/ui'
  import { canCreateObject } from '@hcengineering/view-resources'
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { generateIssueShortLink, issueLinkFragmentProvider } from '../../../issues'
  import tracker from '../../../plugin'
  import SelectIssuePopup from '../SelectIssuePopup.svelte'
  import TimeSpendReportPopup from './TimeSpendReportPopup.svelte'
  import {
    discardIssueTimer,
    formatElapsedTime,
    getElapsedTime,
    getIssueTimerWarnings,
    getStoppedTimerHours,
    startIssueTimer,
    stopIssueTimer
  } from './issue-timer'

  export let issue: Issue

  const client = getClient()
  const employee = getCurrentEmployee()
  const account = getCurrentAccount()
  const timerId = account.uuid as Ref<IssueTimer>
  const timerQuery = createQuery()
  let personalSpace: Ref<PersonSpace> | undefined
  let timer: IssueTimer | undefined
  let now = Date.now()
  let busy = false
  let reviewing = false
  let missingReportId: string | undefined
  let tick: ReturnType<typeof setInterval> | undefined

  async function initialize(): Promise<void> {
    const space = await client.findOne(contact.class.PersonSpace, { members: account.uuid })
    if (space === undefined) return
    personalSpace = space._id
    timerQuery.query(tracker.class.IssueTimer, { _id: timerId, space: space._id }, (result) => {
      timer = result[0]
      now = Date.now()
    })
  }

  async function notify(label: IntlString, params: Record<string, any> = {}): Promise<void> {
    addNotification(await translate(label, params), '', undefined as any, undefined, NotificationSeverity.Warning)
  }

  onMount(() => {
    void initialize().catch((err) => setPlatformStatus(unknownError(err)))
  })

  $: running = timer !== undefined && timer.stoppedAt === undefined
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
    if (personalSpace === undefined) return
    const started = await startIssueTimer(client, personalSpace, timerId, {
      issueId: issue._id,
      identifier: issue.identifier,
      reportId: generateId<TimeSpendReport>(),
      startedAt: Date.now()
    })
    if (!started) await notify(tracker.string.TimerAlreadyRunning)
  }

  async function reportExists(id: Ref<TimeSpendReport>): Promise<boolean> {
    return (await client.findOne(tracker.class.TimeSpendReport, { _id: id })) !== undefined
  }

  async function finishIfSaved(stopped: IssueTimer): Promise<boolean> {
    const saved = await reportExists(stopped.reportId)
    if (saved) await discardIssueTimer(client, stopped)
    return saved
  }

  async function stopTimer(reportId: string): Promise<void> {
    const stopped = await stopIssueTimer(client, timerId, reportId)
    if (stopped === undefined) return
    const hours = getStoppedTimerHours(stopped)
    if (hours === 0) {
      await discardIssueTimer(client, stopped)
      return
    }
    if (await finishIfSaved(stopped)) return
    const target = await client.findOne(tracker.class.Issue, { _id: stopped.issueId })
    if (target === undefined) {
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

  function openReportPopup(timed: IssueTimer, target: Issue, hours: number): void {
    reviewing = true
    const stoppedAt = timed.stoppedAt ?? timed.startedAt
    showPopup(
      TimeSpendReportPopup,
      {
        issue: target,
        issueId: target._id,
        issueClass: target._class,
        space: target.space,
        assignee: target.assignee,
        reportId: timed.reportId,
        initialValue: { value: hours, date: timed.startedAt },
        timerWarnings: getIssueTimerWarnings(timed.startedAt, stoppedAt)
      },
      'top',
      () => {
        void finishIfSaved(timed)
          .catch((err) => setPlatformStatus(unknownError(err)))
          .finally(() => {
            reviewing = false
          })
      }
    )
  }

  async function logToAnotherIssue(): Promise<void> {
    const timed = timer
    if (timed?.stoppedAt === undefined || busy || reviewing) return
    busy = true
    try {
      const projects = await client.findAll(tracker.class.Project, {})
      const permissions = get(permissionsStore)
      const spaces = projects
        .filter((project) => canCreateObject(tracker.class.TimeSpendReport, project._id, permissions))
        .map((project) => project._id)
      showPopup(
        SelectIssuePopup,
        { docQuery: { space: { $in: spaces } } },
        'top',
        (picked: Issue | undefined | null) => {
          if (picked === undefined || picked === null) return
          openReportPopup(timed, picked, getStoppedTimerHours(timed))
        }
      )
    } finally {
      busy = false
    }
  }

  async function updateTimer(discard = false): Promise<void> {
    if (busy || reviewing || personalSpace === undefined) return
    busy = true
    const displayedTimer = timer
    try {
      if (displayedTimer === undefined) {
        await startTimer()
      } else if (discard) {
        await discardIssueTimer(client, displayedTimer)
      } else {
        await stopTimer(displayedTimer.reportId)
      }
    } catch (err) {
      void setPlatformStatus(unknownError(err))
    } finally {
      busy = false
      now = Date.now()
    }
  }

  async function openTimedIssue(): Promise<void> {
    const timedIssueId = timer?.issueId
    if (timedIssueId === undefined) return
    const timedIssue = await client.findOne(tracker.class.Issue, { _id: timedIssueId })
    if (timedIssue === undefined) {
      await notify(tracker.string.TimerIssueUnavailable, {
        issue: timer?.identifier,
        time: timer === undefined ? '' : formatElapsedTime(getElapsedTime(timer.startedAt, timer.stoppedAt ?? now))
      })
      return
    }
    navigate(await issueLinkFragmentProvider(timedIssue))
  }

  $: otherIssue = timer !== undefined && timer.issueId !== issue._id
  $: label =
    timer === undefined
      ? tracker.string.StartTimer
      : timer.stoppedAt === undefined
        ? otherIssue
          ? tracker.string.StopTimerOnIssue
          : tracker.string.StopTimer
        : otherIssue
          ? tracker.string.SaveTimerOnIssue
          : tracker.string.SaveTimer
</script>

{#if employee != null}
  <div class="flex-row-center gap-2">
    {#if timer !== undefined}
      {#if otherIssue}
        <a
          class="nowrap"
          href={generateIssueShortLink(timer.identifier)}
          on:click|preventDefault={() => {
            void openTimedIssue().catch((err) => setPlatformStatus(unknownError(err)))
          }}
        >
          <Label label={tracker.string.TimerRunningOnIssue} params={{ issue: timer.identifier }} />
        </a>
      {/if}
      <span class="nowrap">{formatElapsedTime(getElapsedTime(timer.startedAt, timer.stoppedAt ?? now))}</span>
    {/if}
    <Button
      kind="ghost"
      size="medium"
      {label}
      labelParams={{ issue: timer?.identifier }}
      disabled={busy || reviewing || personalSpace === undefined}
      on:click={() => updateTimer()}
    />
    {#if timer !== undefined && timer.stoppedAt !== undefined && timer.reportId === missingReportId}
      <Button
        kind="ghost"
        size="medium"
        label={tracker.string.LogTimerToAnotherIssue}
        disabled={busy || reviewing}
        on:click={() => {
          void logToAnotherIssue().catch((err) => setPlatformStatus(unknownError(err)))
        }}
      />
    {/if}
    {#if timer !== undefined}
      <Button
        kind="ghost"
        size="medium"
        label={tracker.string.DiscardTimer}
        disabled={busy || reviewing}
        on:click={() => updateTimer(true)}
      />
    {/if}
  </div>
{/if}
