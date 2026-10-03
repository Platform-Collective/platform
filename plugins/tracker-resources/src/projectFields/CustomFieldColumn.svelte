<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { getClient } from '@hcengineering/presentation'
  import type { Issue, ProjectFieldValue } from '@hcengineering/tracker'
  import { getFieldValue, ProjectFieldType } from '@hcengineering/tracker'
  import { EditBox } from '@hcengineering/ui'

  import tracker from '../plugin'
  import { setIssueCustomFieldValue } from './actions'
  import CustomFieldPresenter from './CustomFieldPresenter.svelte'
  import FieldValueEditor from './FieldValueEditor.svelte'
  import { sharedProjectFieldsStore } from './projectFieldsStore'

  // Optional list column of a custom field. The model key carries `fieldKey` in its props.
  export let value: Issue
  export let fieldKey: string
  export let readonly: boolean = false

  const client = getClient()

  $: registry = sharedProjectFieldsStore(value.space)
  $: field = $registry.byKey.get(fieldKey)
  $: current = field !== undefined ? getFieldValue(value.customFields, field) : null
  $: isText = field?.type === ProjectFieldType.Text || field?.type === ProjectFieldType.Number

  let editing = false

  async function save (next: ProjectFieldValue): Promise<void> {
    if (field === undefined) return
    try {
      await setIssueCustomFieldValue(client, value, field.key, next)
    } catch (err) {
      console.error('Failed to update custom field', err)
    }
  }

  function commitText (e: CustomEvent<string | number>): void {
    editing = false
    if (field === undefined) return
    const raw = String(e.detail).trim()
    let next: ProjectFieldValue = null
    if (field.type === ProjectFieldType.Number) {
      const parsed = raw === '' ? null : Number(raw)
      next = parsed !== null && Number.isFinite(parsed) ? parsed : null
    } else {
      next = raw === '' ? null : raw
    }
    if (next !== current) void save(next)
  }
</script>

{#if field !== undefined}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="custom-field-cell" on:click|stopPropagation>
    {#if isText}
      {#if editing && !readonly}
        <EditBox
          kind={'default'}
          autoFocus
          format={field.type === ProjectFieldType.Number ? 'number' : 'text'}
          value={typeof current === 'string' || typeof current === 'number' ? current : undefined}
          placeholder={tracker.string.FieldEmptyValue}
          on:blur={commitText}
        />
      {:else}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="value"
          class:editable={!readonly}
          on:click={() => {
            if (!readonly) editing = true
          }}
        >
          <CustomFieldPresenter {field} customFields={value.customFields} />
        </div>
      {/if}
    {:else}
      <FieldValueEditor {field} customFields={value.customFields} {readonly} on:change={(e) => save(e.detail)} />
    {/if}
  </div>
{/if}

<style lang="scss">
  .custom-field-cell {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    width: 8rem;
    min-width: 0;
    padding: 0 0.25rem;
  }
  .value {
    width: 100%;
    min-height: 1.5rem;
    display: flex;
    align-items: center;
    overflow: hidden;
    &.editable {
      cursor: text;
    }
  }
</style>
