<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { EditBox } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import tracker from '../plugin'

  export let value: number | null = null
  export let readonly = false

  const dispatch = createEventDispatcher()

  function commit (e: CustomEvent<string | number>): void {
    const raw = String(e.detail).trim()
    const parsed = raw === '' ? null : Number(raw)
    const next = parsed !== null && Number.isFinite(parsed) ? parsed : null
    if (next === value) return
    dispatch('change', next)
  }
</script>

<EditBox
  kind={'default'}
  format={'number'}
  disabled={readonly}
  value={value ?? undefined}
  placeholder={tracker.string.FieldEmptyValue}
  on:blur={commit}
/>
