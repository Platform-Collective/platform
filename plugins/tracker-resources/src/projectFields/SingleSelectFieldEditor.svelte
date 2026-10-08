<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { ProjectFieldOption } from '@hcengineering/tracker'
  import { DropdownLabels } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import tracker from '../plugin'

  export let options: ProjectFieldOption[] = []
  export let value: string | null = null
  export let readonly = false

  const dispatch = createEventDispatcher()

  $: items = options.map((o) => ({ id: o.value, label: o.label }))

  function select (e: CustomEvent<string | undefined>): void {
    const next = e.detail ?? null
    if (next === value) return
    dispatch('change', next)
  }
</script>

<DropdownLabels
  {items}
  selected={value ?? undefined}
  disabled={readonly}
  allowDeselect
  autoSelect={false}
  placeholder={tracker.string.FieldEmptyValue}
  label={tracker.string.FieldEmptyValue}
  kind={'link'}
  size={'medium'}
  width={'100%'}
  justify={'left'}
  on:selected={select}
/>
