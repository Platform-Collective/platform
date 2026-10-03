<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { DueDatePresenter } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let value: number | null = null
  export let readonly = false
  export let width: string | undefined = '100%'

  const dispatch = createEventDispatcher()

  function change (next: number | null | undefined): void {
    const normalized = next ?? null
    if (normalized === value) return
    dispatch('change', normalized)
  }
</script>

<DueDatePresenter
  kind={'link'}
  value={value ?? undefined}
  {width}
  editable={!readonly}
  shouldIgnoreOverdue={true}
  onChange={change}
/>
