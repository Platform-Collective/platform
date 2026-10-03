<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { getFieldValue, ProjectFieldType, type ProjectField } from '@hcengineering/tracker'
  import { DatePresenter } from '@hcengineering/ui'

  export let field: ProjectField
  export let customFields: Record<string, unknown> | undefined = undefined

  $: value = getFieldValue(customFields, field)
  $: labels = (field.options ?? [])
    .filter((o) => (Array.isArray(value) ? value.includes(o.value) : o.value === value))
    .map((o) => o.label)
</script>

{#if value === null}
  <span class="content-dark-color">—</span>
{:else if field.type === ProjectFieldType.Date && typeof value === 'number'}
  <DatePresenter {value} />
{:else if field.type === ProjectFieldType.SingleSelect || field.type === ProjectFieldType.MultiSelect}
  <span class="overflow-label">{labels.join(', ')}</span>
{:else}
  <span class="overflow-label">{value}</span>
{/if}
