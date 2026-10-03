<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { getClient } from '@hcengineering/presentation'
  import type { Issue, ProjectFieldValue } from '@hcengineering/tracker'
  import { ProjectFieldType } from '@hcengineering/tracker'

  import FieldValueEditor from './FieldValueEditor.svelte'
  import { mergeCustomFieldValue } from './registry'
  import { projectFieldsStore } from './projectFieldsStore'

  export let issue: Issue
  export let readonly = false

  const client = getClient()

  $: registry = projectFieldsStore(issue.space)
  // Iteration fields get their own UI in a later phase
  $: fields = $registry.fields.filter((f) => f.type !== ProjectFieldType.Iteration)

  async function setValue (key: string, value: ProjectFieldValue): Promise<void> {
    const customFields = mergeCustomFieldValue(issue.customFields, key, value)
    await client.updateCollection(
      issue._class,
      issue.space,
      issue._id,
      issue.attachedTo,
      issue.attachedToClass,
      issue.collection,
      { customFields }
    )
  }
</script>

{#if fields.length > 0}
  <div class="divider" />
  {#each fields as field (field._id)}
    <span class="labelOnPanel" title={field.description}>
      {field.label}
    </span>
    <FieldValueEditor
      {field}
      customFields={issue.customFields}
      {readonly}
      on:change={(e) => setValue(field.key, e.detail)}
    />
  {/each}
{/if}
