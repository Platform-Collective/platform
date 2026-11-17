<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { DateRangeMode } from '@hcengineering/core'
  import { EventReminders } from '@hcengineering/calendar-resources'
  import type { Doc } from '@hcengineering/core'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { Card } from '@hcengineering/presentation'
  import ui, { DateRangePresenter } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { createMessageToDo } from '../message-reminder'
  import time from '../plugin'

  export let object: Doc

  let dueDate: number | null | undefined = Date.now() + 60 * 60 * 1000
  let saving = false
  let reminders: number[] = []
  const dispatch = createEventDispatcher()

  async function save(): Promise<void> {
    if (saving || dueDate == null || !Number.isFinite(dueDate)) return
    saving = true
    try {
      await createMessageToDo(object, dueDate, reminders)
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
    <EventReminders bind:reminders />
  </div>
</Card>
