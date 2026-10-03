<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import type { Project } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'

  import type { DraftValues } from '../../draft/create'
  import tracker from '../../plugin'
  import AddItemRow from '../draft/AddItemRow.svelte'

  // The popup of a click on an empty day: the "Add item" row of the project (a draft item, or `#` to bring in an issue)
  // whose draft starts with the day in the date fields of the view. The row guards the item limit and read-only viewers.
  export let project: Ref<Project>
  export let values: DraftValues
  // Long date of the day, already formatted
  export let dateLabel: string
</script>

<div class="antiPopup add-popup" data-id="calendar-add-popup">
  <div class="header"><Label label={tracker.string.CalendarAddItemOn} params={{ date: dateLabel }} /></div>
  <div class="body">
    <AddItemRow {project} {values} compact placement={'below'} autofocus />
  </div>
</div>

<style lang="scss">
  .add-popup {
    width: 20rem;
    max-width: 90vw;
    padding: 0.5rem 0.75rem 0.75rem;
  }
  .header {
    padding: 0.25rem 0.25rem 0.5rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
</style>
