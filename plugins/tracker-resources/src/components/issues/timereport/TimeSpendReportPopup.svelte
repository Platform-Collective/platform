<!--
// Copyright © 2022-2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import contact, { Employee, getCurrentEmployee } from '@hcengineering/contact'
  import { AttachedData, Class, Ref, Space } from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import type { IntlString } from '@hcengineering/platform'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import { UserBox } from '@hcengineering/contact-resources'
  import { Issue, TimeReportDayType, TimeSpendReport } from '@hcengineering/tracker'
  import { addNotification, Button, DatePresenter, EditBox, Label, NotificationSeverity } from '@hcengineering/ui'
  import tracker from '../../../plugin'
  import { getTimeReportDate, getTimeReportDayType } from '../../../utils'
  import TitlePresenter from '../TitlePresenter.svelte'
  import TimeReportDayDropdown from './TimeReportDayDropdown.svelte'
  import { saveTimeSpendReport } from './create-time-spend-report'
  import type { IssueTimerWarning } from './issue-timer'

  export let issue: Issue | undefined = undefined
  export let issueId: Ref<Issue> | undefined = issue?._id
  export let issueClass: Ref<Class<Issue>> = issue?._class ?? tracker.class.Issue
  export let space: Ref<Space> | undefined = issue?.space
  export let assignee: Ref<Employee> | null | undefined = issue?.assignee as Ref<Employee>

  export let value: TimeSpendReport | undefined
  export let placeholder: IntlString = tracker.string.TimeSpendReportValue
  export let defaultTimeReportDay: TimeReportDayType = TimeReportDayType.PreviousWorkDay
  // Prefill a new report, e.g. with the time measured by an issue timer, and reuse its ID so retries cannot duplicate it.
  export let initialValue: Partial<Pick<TimeSpendReport, 'date' | 'value' | 'description'>> | undefined = undefined
  export let reportId: Ref<TimeSpendReport> | undefined = undefined
  export let timerWarnings: IssueTimerWarning[] = []

  const data = {
    date: value?.date ?? initialValue?.date ?? getTimeReportDate(defaultTimeReportDay),
    description: value?.description ?? initialValue?.description ?? '',
    value: value?.value ?? initialValue?.value,
    employee: value?.employee ?? getCurrentEmployee() ?? assignee ?? null
  }

  let selectedTimeReportDay = getTimeReportDayType(data.date)

  export function canClose(): boolean {
    return true
  }

  const client = getClient()

  async function notify(label: IntlString, severity: NotificationSeverity): Promise<void> {
    addNotification(await translate(label, {}), '', undefined as any, undefined, severity)
  }

  async function save(): Promise<void> {
    const target =
      space !== undefined && issueId !== undefined
        ? { _id: issueId, _class: issueClass, space, identifier: issue?.identifier ?? issueId }
        : undefined
    await saveTimeSpendReport(client, {
      target,
      value,
      data: data as AttachedData<TimeSpendReport>,
      reportId,
      onAlreadySaved: async () => await notify(tracker.string.TimeReportAlreadySaved, NotificationSeverity.Info),
      onSaveFailed: async () => await notify(tracker.string.TimeReportSaveFailed, NotificationSeverity.Error)
    })
  }

  $: canSave = Number.isFinite(data.value) && data.value !== 0 && space !== undefined && issueId !== undefined
</script>

<Card
  label={value === undefined ? tracker.string.TimeSpendReportAdd : tracker.string.TimeSpendReportValue}
  {canSave}
  okAction={save}
  retryOnError={value === undefined && reportId !== undefined}
  gap={'gapV-4'}
  on:close
  okLabel={value === undefined ? presentation.string.Create : presentation.string.Save}
  on:changeContent
>
  <svelte:fragment slot="header">
    {#if issue}
      <TitlePresenter showParent={false} value={issue} />
    {/if}
  </svelte:fragment>
  {#if timerWarnings.includes('long')}
    <div class="timer-warning">
      <Label label={tracker.string.TimerLongDuration} />
    </div>
  {/if}
  {#if timerWarnings.includes('pastMidnight')}
    <div class="timer-warning">
      <Label label={tracker.string.TimerPastMidnight} />
    </div>
  {/if}
  <div class="flex-row-center gap-2">
    <EditBox
      autoFocus
      bind:value={data.value}
      {placeholder}
      maxWidth={'9rem'}
      format={'number'}
      maxDigitsAfterPoint={3}
      kind={'editbox'}
    />
    <Button kind={'link-bordered'} on:click={() => (data.value = 0.25)}>
      <span slot="content">15<Label label={tracker.string.MinuteLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 0.5)}>
      <span slot="content">30<Label label={tracker.string.MinuteLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 1)}>
      <span slot="content">1<Label label={tracker.string.HourLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 2)}>
      <span slot="content">2<Label label={tracker.string.HourLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 4)}>
      <span slot="content">4<Label label={tracker.string.HourLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 6)}>
      <span slot="content">6<Label label={tracker.string.HourLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 7)}>
      <span slot="content">7<Label label={tracker.string.HourLabel} /></span>
    </Button>
    <Button kind={'link-bordered'} on:click={() => (data.value = 8)}>
      <span slot="content">8<Label label={tracker.string.HourLabel} /></span>
    </Button>
  </div>
  <EditBox bind:value={data.description} placeholder={tracker.string.TimeSpendReportDescription} kind={'editbox'} />
  <svelte:fragment slot="pool">
    <UserBox
      _class={contact.mixin.Employee}
      label={contact.string.Employee}
      kind={'regular'}
      size={'large'}
      bind:value={data.employee}
      showNavigate={false}
    />
    <TimeReportDayDropdown
      kind={'regular'}
      size={'large'}
      bind:selected={selectedTimeReportDay}
      on:selected={({ detail }) => (data.date = getTimeReportDate(detail))}
    />
    <DatePresenter
      bind:value={data.date}
      editable
      kind={'regular'}
      size={'large'}
      on:change={({ detail }) => (selectedTimeReportDay = getTimeReportDayType(detail))}
    />
  </svelte:fragment>
</Card>

<style>
  .timer-warning {
    color: var(--theme-warning-color);
  }
</style>
