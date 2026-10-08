<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { EditBox } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import tracker from '../plugin'

  export let value: string | null = null
  export let readonly = false

  const dispatch = createEventDispatcher()

  function commit (e: CustomEvent<string>): void {
    const next = e.detail.trim()
    if (next === (value ?? '')) return
    dispatch('change', next === '' ? null : next)
  }
</script>

<EditBox
  kind={'default'}
  disabled={readonly}
  value={value ?? ''}
  placeholder={tracker.string.FieldEmptyValue}
  on:blur={commit}
/>
