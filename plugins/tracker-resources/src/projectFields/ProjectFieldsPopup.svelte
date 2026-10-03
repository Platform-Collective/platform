<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { generateId, type Ref } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import presentation, { Card, getClient, MessageBox } from '@hcengineering/presentation'
  import {
    generateFieldKey,
    MAX_PROJECT_FIELD_OPTIONS,
    MAX_PROJECT_FIELDS,
    ProjectFieldType,
    validateProjectField,
    type Project,
    type ProjectField,
    type ProjectFieldOption,
    type ProjectFieldValidationError
  } from '@hcengineering/tracker'
  import {
    Button,
    ButtonIcon,
    DropdownLabels,
    DropdownLabelsIntl,
    EditBox,
    eventToHTMLElement,
    getPlatformColorDef,
    IconAdd,
    IconCalendar,
    IconCheckAll,
    IconCheckCircle,
    IconDelete,
    IconDescription,
    IconDown,
    IconScale,
    IconUp,
    Label,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import { ColorsPopup } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../plugin'
  import { projectFieldsStore } from './projectFieldsStore'
  import { computeMove, nextFieldPosition } from './registry'

  export let project: Project

  interface Draft {
    id?: Ref<ProjectField>
    label: string
    type: ProjectFieldType
    description: string
    options: ProjectFieldOption[]
    defaultValue: string | number | null
  }

  const client = getClient()
  const dispatch = createEventDispatcher()

  // Iteration fields are introduced in a later phase
  const typeItems: Array<{ id: ProjectFieldType, label: IntlString }> = [
    { id: ProjectFieldType.Text, label: tracker.string.ProjectFieldTypeText },
    { id: ProjectFieldType.Number, label: tracker.string.ProjectFieldTypeNumber },
    { id: ProjectFieldType.Date, label: tracker.string.ProjectFieldTypeDate },
    { id: ProjectFieldType.SingleSelect, label: tracker.string.ProjectFieldTypeSingleSelect },
    { id: ProjectFieldType.MultiSelect, label: tracker.string.ProjectFieldTypeMultiSelect }
  ]

  const errorLabels: Record<ProjectFieldValidationError, IntlString> = {
    emptyLabel: tracker.string.ProjectFieldErrorEmptyLabel,
    duplicateLabel: tracker.string.ProjectFieldErrorDuplicateLabel,
    tooManyFields: tracker.string.ProjectFieldErrorTooManyFields,
    tooManyOptions: tracker.string.ProjectFieldErrorTooManyOptions,
    duplicateOption: tracker.string.ProjectFieldErrorDuplicateOption,
    emptyOption: tracker.string.ProjectFieldErrorEmptyOption,
    optionsRequired: tracker.string.ProjectFieldErrorOptionsRequired,
    defaultNotAllowed: tracker.string.ProjectFieldErrorDefaultNotAllowed,
    invalidDefault: tracker.string.ProjectFieldErrorInvalidDefault
  }

  let draft: Draft | undefined
  let showErrors = false

  $: registry = projectFieldsStore(project._id)
  $: fields = $registry.fields

  function isSelect (type: ProjectFieldType): boolean {
    return type === ProjectFieldType.SingleSelect || type === ProjectFieldType.MultiSelect
  }

  function supportsDefault (type: ProjectFieldType): boolean {
    return type === ProjectFieldType.Text || type === ProjectFieldType.Number || type === ProjectFieldType.SingleSelect
  }

  function typeIcon (type: ProjectFieldType): any {
    switch (type) {
      case ProjectFieldType.Number:
        return IconScale
      case ProjectFieldType.Date:
        return IconCalendar
      case ProjectFieldType.SingleSelect:
        return IconCheckCircle
      case ProjectFieldType.MultiSelect:
        return IconCheckAll
      default:
        return IconDescription
    }
  }

  function typeLabel (type: ProjectFieldType): IntlString {
    return typeItems.find((t) => t.id === type)?.label ?? tracker.string.ProjectFieldTypeText
  }

  function startCreate (): void {
    showErrors = false
    draft = { label: '', type: ProjectFieldType.Text, description: '', options: [], defaultValue: null }
  }

  function startEdit (field: ProjectField): void {
    showErrors = false
    draft = {
      id: field._id,
      label: field.label,
      type: field.type,
      description: field.description ?? '',
      options: (field.options ?? []).map((o) => ({ ...o })),
      defaultValue: field.defaultValue ?? null
    }
  }

  function cancelEdit (): void {
    draft = undefined
  }

  function buildCandidate (d: Draft): Pick<ProjectField, 'label' | 'type' | 'options' | 'defaultValue'> {
    return {
      label: d.label,
      type: d.type,
      options: isSelect(d.type) ? d.options : undefined,
      defaultValue: supportsDefault(d.type) ? d.defaultValue : null
    }
  }

  $: error =
    draft !== undefined
      ? validateProjectField(
        buildCandidate(draft),
        fields.filter((f) => f._id !== draft?.id)
      )
      : undefined
  $: canCreateMore = fields.length < MAX_PROJECT_FIELDS

  function changeType (e: CustomEvent<ProjectFieldType | undefined>): void {
    if (draft === undefined || e.detail === undefined) return
    draft = { ...draft, type: e.detail, defaultValue: null, options: isSelect(e.detail) ? draft.options : [] }
  }

  function addOption (): void {
    if (draft === undefined || draft.options.length >= MAX_PROJECT_FIELD_OPTIONS) return
    draft.options = [...draft.options, { value: generateId(), label: '', color: draft.options.length % 10 }]
  }

  function removeOption (value: string): void {
    if (draft === undefined) return
    draft.options = draft.options.filter((o) => o.value !== value)
    if (draft.defaultValue === value) draft.defaultValue = null
  }

  function pickColor (evt: MouseEvent, option: ProjectFieldOption): void {
    showPopup(
      ColorsPopup,
      { selected: getPlatformColorDef(option.color ?? 0, $themeStore.dark).name },
      eventToHTMLElement(evt),
      (color) => {
        if (color != null && draft !== undefined) {
          draft.options = draft.options.map((o) => (o.value === option.value ? { ...o, color } : o))
        }
      }
    )
  }

  function setDefaultText (e: CustomEvent<string>): void {
    if (draft === undefined) return
    draft.defaultValue = e.detail.trim() === '' ? null : e.detail
  }

  function setDefaultNumber (e: CustomEvent<string | number>): void {
    if (draft === undefined) return
    const raw = String(e.detail).trim()
    const parsed = raw === '' ? null : Number(raw)
    draft.defaultValue = parsed !== null && Number.isFinite(parsed) ? parsed : null
  }

  function setDefaultSelect (e: CustomEvent<string | undefined>): void {
    if (draft === undefined) return
    draft.defaultValue = e.detail ?? null
  }

  async function save (): Promise<void> {
    if (draft === undefined) return
    showErrors = true
    if (error !== undefined) return
    const d = draft
    const options = isSelect(d.type)
      ? d.options.map((o) => ({ ...o, label: o.label.trim(), description: o.description?.trim() ?? '' }))
      : undefined
    const common = {
      label: d.label.trim(),
      description: d.description.trim(),
      options,
      defaultValue: supportsDefault(d.type) ? d.defaultValue : null
    }
    if (d.id === undefined) {
      const key = generateFieldKey(
        d.label,
        fields.map((f) => f.key)
      )
      if (key === '') {
        return
      }
      await client.createDoc(tracker.class.ProjectField, project._id, {
        ...common,
        key,
        type: d.type,
        position: nextFieldPosition(fields)
      })
    } else {
      // Key and type are immutable after creation
      await client.updateDoc(tracker.class.ProjectField, project._id, d.id, common)
    }
    draft = undefined
  }

  async function move (field: ProjectField, direction: -1 | 1): Promise<void> {
    for (const update of computeMove(fields, field._id, direction)) {
      await client.updateDoc(tracker.class.ProjectField, project._id, update.id, { position: update.position })
    }
  }

  function remove (field: ProjectField): void {
    showPopup(MessageBox, {
      label: tracker.string.DeleteProjectField,
      labelProps: { name: field.label },
      message: tracker.string.DeleteProjectFieldConfirm,
      action: async () => {
        await client.removeDoc(tracker.class.ProjectField, project._id, field._id)
      }
    })
  }

  $: optionItems = (draft?.options ?? []).map((o) => ({ id: o.value, label: o.label }))
</script>

<Card
  label={draft === undefined ? tracker.string.ProjectFields : draft.id === undefined ? tracker.string.NewProjectField : tracker.string.EditProjectField}
  okLabel={presentation.string.Save}
  okAction={save}
  canSave={draft !== undefined}
  hideFooter={draft === undefined}
  isBack={draft !== undefined}
  backAction={cancelEdit}
  accentHeader
  width={'medium'}
  gap={'gapV-4'}
  onCancel={() => dispatch('close')}
  on:close
  on:changeContent
>
  {#if draft === undefined}
    {#if fields.length === 0}
      <div class="flex-center p-4 content-dark-color">
        <Label label={tracker.string.NoProjectFields} />
      </div>
    {/if}
    {#each fields as field, i (field._id)}
      <div class="flex-row-center flex-gap-2">
        <svelte:component this={typeIcon(field.type)} size={'small'} />
        <div class="flex-grow overflow-label">{field.label}</div>
        <span class="content-dark-color"><Label label={typeLabel(field.type)} /></span>
        <ButtonIcon icon={IconUp} size={'small'} kind={'tertiary'} disabled={i === 0} on:click={() => move(field, -1)} />
        <ButtonIcon
          icon={IconDown}
          size={'small'}
          kind={'tertiary'}
          disabled={i === fields.length - 1}
          on:click={() => move(field, 1)}
        />
        <Button label={presentation.string.Edit} kind={'ghost'} size={'small'} on:click={() => startEdit(field)} />
        <ButtonIcon icon={IconDelete} size={'small'} kind={'tertiary'} on:click={() => remove(field)} />
      </div>
    {/each}
    <div class="flex-row-center">
      <Button
        icon={IconAdd}
        label={tracker.string.NewProjectField}
        disabled={!canCreateMore}
        kind={'ghost'}
        on:click={startCreate}
      />
      {#if !canCreateMore}
        <span class="ml-2 error-color"><Label label={tracker.string.ProjectFieldErrorTooManyFields} /></span>
      {/if}
    </div>
  {:else}
    <EditBox
      label={tracker.string.ProjectField}
      placeholder={tracker.string.ProjectFieldNamePlaceholder}
      bind:value={draft.label}
      autoFocus
    />
    <EditBox
      placeholder={tracker.string.ProjectFieldDescriptionPlaceholder}
      bind:value={draft.description}
    />
    <div class="flex-row-center flex-gap-2">
      <Label label={tracker.string.FieldType} />
      <DropdownLabelsIntl
        items={typeItems}
        selected={draft.type}
        disabled={draft.id !== undefined}
        size={'medium'}
        on:selected={changeType}
      />
    </div>

    {#if isSelect(draft.type)}
      <div class="fs-bold"><Label label={tracker.string.FieldOptions} /> ({draft.options.length}/{MAX_PROJECT_FIELD_OPTIONS})</div>
      {#each draft.options as option (option.value)}
        <div class="flex-row-center flex-gap-2">
          <button
            class="option-color"
            style:background-color={getPlatformColorDef(option.color ?? 0, $themeStore.dark).color}
            on:click={(evt) => pickColor(evt, option)}
          />
          <EditBox placeholder={tracker.string.ProjectFieldOptionLabel} bind:value={option.label} />
          <EditBox placeholder={tracker.string.ProjectFieldOptionDescription} bind:value={option.description} />
          <ButtonIcon icon={IconDelete} size={'small'} kind={'tertiary'} on:click={() => removeOption(option.value)} />
        </div>
      {/each}
      <div>
        <Button
          icon={IconAdd}
          label={tracker.string.AddProjectFieldOption}
          kind={'ghost'}
          disabled={draft.options.length >= MAX_PROJECT_FIELD_OPTIONS}
          on:click={addOption}
        />
      </div>
    {/if}

    {#if supportsDefault(draft.type)}
      <div class="flex-row-center flex-gap-2">
        <Label label={tracker.string.FieldDefaultValue} />
        {#if draft.type === ProjectFieldType.Text}
          <EditBox
            placeholder={tracker.string.FieldEmptyValue}
            value={typeof draft.defaultValue === 'string' ? draft.defaultValue : ''}
            on:blur={setDefaultText}
          />
        {:else if draft.type === ProjectFieldType.Number}
          <EditBox
            format={'number'}
            placeholder={tracker.string.FieldEmptyValue}
            value={typeof draft.defaultValue === 'number' ? draft.defaultValue : undefined}
            on:blur={setDefaultNumber}
          />
        {:else}
          <DropdownLabels
            items={optionItems.filter((o) => o.label.trim() !== '')}
            selected={typeof draft.defaultValue === 'string' ? draft.defaultValue : undefined}
            allowDeselect
            autoSelect={false}
            label={tracker.string.FieldEmptyValue}
            kind={'regular'}
            size={'medium'}
            on:selected={setDefaultSelect}
          />
        {/if}
      </div>
    {/if}

    {#if showErrors && error !== undefined}
      <div class="error-color"><Label label={errorLabels[error]} /></div>
    {/if}
  {/if}
</Card>

<style lang="scss">
  .option-color {
    flex-shrink: 0;
    width: 1.25rem;
    height: 1.25rem;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
</style>
