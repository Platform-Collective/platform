<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import calendar from '@hcengineering/calendar'
  import { DateRangeMode } from '@hcengineering/core'
  import { EventReminders } from '@hcengineering/calendar-resources'
  import type { Doc } from '@hcengineering/core'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { Card } from '@hcengineering/presentation'
  import ui, { DateRangePresenter, DropdownLabelsIntl, type DropdownIntlItem, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { createMessageToDo } from '../message-reminder'
  import time from '../plugin'

  export let object: Doc

  let dueDate: number | null | undefined = Date.now() + 60 * 60 * 1000
  let duration = 30 * 60 * 1000
  let saving = false
  let reminders: number[] = []
  const durations: DropdownIntlItem[] = [15, 30, 45, 60, 90, 120].map((minutes) => ({
    id: minutes * 60 * 1000,
    label: ui.string.Minutes,
    params: { minutes }
  }))
  const dispatch = createEventDispatcher<{ close: boolean }>()

  async function save(): Promise<void> {
    if (saving || dueDate == null || !Number.isFinite(dueDate)) return
    saving = true
    try {
      await createMessageToDo(object, dueDate, reminders, duration)
      dispatch('close', true)
    } catch (err) {
      await setPlatformStatus(unknownError(err))
    } finally {
      saving = false
    }
  }
</script>

<Card
  label={time.string.AddToPlanner}
  width="x-small"
  okLabel={ui.string.Save}
  okAction={save}
  canSave={!saving && dueDate != null && Number.isFinite(dueDate)}
  on:close
>
  <div class="flex-col gap-4">
    <DateRangePresenter
      bind:value={dueDate}
      mode={DateRangeMode.DATETIME}
      editable
      noShift
      kind="regular"
      size="large"
    />
    <div class="flex-col gap-2">
      <Label label={calendar.string.MeetingDuration} />
      <DropdownLabelsIntl items={durations} bind:selected={duration} justify="left" width="100%" size="large" />
    </div>
    <EventReminders bind:reminders />
  </div>
</Card>
