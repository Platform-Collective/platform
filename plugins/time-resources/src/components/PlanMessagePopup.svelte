<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { DateRangeMode } from '@hcengineering/core'
  import type { Doc } from '@hcengineering/core'
  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { Card } from '@hcengineering/presentation'
  import ui, { DateRangePresenter } from '@hcengineering/ui'
  import { createMessageToDo } from '../message-reminder'
  import time from '../plugin'

  export let object: Doc

  let dueDate: number | null | undefined = Date.now() + 60 * 60 * 1000
  let saving = false

  async function save(): Promise<void> {
    if (saving || dueDate == null || !Number.isFinite(dueDate)) return
    saving = true
    try {
      await createMessageToDo(object, dueDate)
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
  <DateRangePresenter bind:value={dueDate} mode={DateRangeMode.DATETIME} editable noShift kind="regular" size="large" />
</Card>
