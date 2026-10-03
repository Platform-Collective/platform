<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { getFieldValue, ProjectFieldType, type ProjectField } from '@hcengineering/tracker'
  import { DatePresenter } from '@hcengineering/ui'

  import IterationPresenter from '../iterations/IterationPresenter.svelte'
  import { sharedIterationsStore } from '../iterations/iterationsStore'

  export let field: ProjectField
  export let customFields: Record<string, unknown> | undefined = undefined

  $: value = getFieldValue(customFields, field)
  $: iterations = sharedIterationsStore(field.space)
  $: iteration = field.type === ProjectFieldType.Iteration ? $iterations.find((it) => it._id === value) : undefined
  $: labels = (field.options ?? [])
    .filter((o) => (Array.isArray(value) ? value.includes(o.value) : o.value === value))
    .map((o) => o.label)
</script>

{#if value === null}
  <span class="content-dark-color">—</span>
{:else if field.type === ProjectFieldType.Date && typeof value === 'number'}
  <DatePresenter {value} />
{:else if field.type === ProjectFieldType.Iteration}
  {#if iteration !== undefined}
    <IterationPresenter {iteration} />
  {:else}
    <span class="content-dark-color">—</span>
  {/if}
{:else if field.type === ProjectFieldType.SingleSelect || field.type === ProjectFieldType.MultiSelect}
  <span class="overflow-label">{labels.join(', ')}</span>
{:else}
  <span class="overflow-label">{value}</span>
{/if}
