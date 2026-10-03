<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { ProjectFieldType, type ProjectField, type ProjectFieldValue } from '@hcengineering/tracker'
  import { createEventDispatcher } from 'svelte'
  import { getFieldValue } from '@hcengineering/tracker'

  import DateFieldEditor from './DateFieldEditor.svelte'
  import MultiSelectFieldEditor from './MultiSelectFieldEditor.svelte'
  import NumberFieldEditor from './NumberFieldEditor.svelte'
  import SingleSelectFieldEditor from './SingleSelectFieldEditor.svelte'
  import TextFieldEditor from './TextFieldEditor.svelte'

  export let field: ProjectField
  export let customFields: Record<string, unknown> | undefined = undefined
  export let readonly = false

  const dispatch = createEventDispatcher<{ change: ProjectFieldValue }>()

  $: value = getFieldValue(customFields, field)

  function forward (e: CustomEvent<ProjectFieldValue>): void {
    dispatch('change', e.detail)
  }
</script>

{#if field.type === ProjectFieldType.Text}
  <TextFieldEditor value={typeof value === 'string' ? value : null} {readonly} on:change={forward} />
{:else if field.type === ProjectFieldType.Number}
  <NumberFieldEditor value={typeof value === 'number' ? value : null} {readonly} on:change={forward} />
{:else if field.type === ProjectFieldType.Date}
  <DateFieldEditor value={typeof value === 'number' ? value : null} {readonly} on:change={forward} />
{:else if field.type === ProjectFieldType.SingleSelect}
  <SingleSelectFieldEditor
    options={field.options ?? []}
    value={typeof value === 'string' ? value : null}
    {readonly}
    on:change={forward}
  />
{:else if field.type === ProjectFieldType.MultiSelect}
  <MultiSelectFieldEditor
    options={field.options ?? []}
    value={Array.isArray(value) ? value : null}
    {readonly}
    on:change={forward}
  />
{/if}
