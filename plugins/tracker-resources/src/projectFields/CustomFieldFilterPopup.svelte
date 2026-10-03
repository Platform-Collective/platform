<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { generateId, type Ref } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import type { Project, ProjectField } from '@hcengineering/tracker'
  import { ProjectFieldType } from '@hcengineering/tracker'
  import { Button, ButtonIcon, DropdownLabels, DropdownLabelsIntl, EditBox, IconAdd, IconDelete, Label } from '@hcengineering/ui'

  import tracker from '../plugin'
  import { customFieldFilterStore } from './customFieldView'
  import { sharedProjectFieldsStore } from './projectFieldsStore'
  import {
    isFilterableType,
    operatorsFor,
    type CustomFieldFilter,
    type FieldFilterOperator,
    type FieldRange
  } from './query'

  export let space: Ref<Project>

  const filtersStore = customFieldFilterStore(space)
  const registry = sharedProjectFieldsStore(space)

  $: fields = $registry.fields.filter((f) => isFilterableType(f.type))
  $: filters = $filtersStore

  const operatorLabels: Record<FieldFilterOperator, IntlString> = {
    contains: tracker.string.FieldFilterOpContains,
    eq: tracker.string.FieldFilterOpEq,
    gt: tracker.string.FieldFilterOpGt,
    gte: tracker.string.FieldFilterOpGte,
    lt: tracker.string.FieldFilterOpLt,
    lte: tracker.string.FieldFilterOpLte,
    between: tracker.string.FieldFilterOpBetween,
    before: tracker.string.FieldFilterOpBefore,
    after: tracker.string.FieldFilterOpAfter,
    anyOf: tracker.string.FieldFilterOpAnyOf,
    isEmpty: tracker.string.FieldFilterOpIsEmpty,
    isNotEmpty: tracker.string.FieldFilterOpIsNotEmpty
  }

  function fieldOf (filter: CustomFieldFilter): ProjectField | undefined {
    return $registry.byKey.get(filter.fieldKey)
  }

  function patch (id: string, changes: Partial<CustomFieldFilter>): void {
    filtersStore.update((list) => list.map((f) => (f.id === id ? { ...f, ...changes } : f)))
  }

  function add (): void {
    const field = fields[0]
    if (field === undefined) return
    filtersStore.update((list) => [
      ...list,
      { id: generateId(), fieldKey: field.key, operator: operatorsFor(field.type)[0], value: undefined }
    ])
  }

  function remove (id: string): void {
    filtersStore.update((list) => list.filter((f) => f.id !== id))
  }

  function selectField (filter: CustomFieldFilter, key: string): void {
    const field = $registry.byKey.get(key)
    if (field === undefined) return
    patch(filter.id, { fieldKey: key, operator: operatorsFor(field.type)[0], value: undefined })
  }

  function selectOperator (filter: CustomFieldFilter, operator: FieldFilterOperator): void {
    patch(filter.id, { operator, value: undefined })
  }

  function toNumber (raw: string | number): number | undefined {
    const text = String(raw).trim()
    if (text === '') return undefined
    const n = Number(text)
    return Number.isFinite(n) ? n : undefined
  }

  function rangeOf (filter: CustomFieldFilter): FieldRange {
    const v = filter.value
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}
  }

  function setRange (filter: CustomFieldFilter, part: 'from' | 'to', value: number | undefined): void {
    patch(filter.id, { value: { ...rangeOf(filter), [part]: value } })
  }

  function dateToInput (ts: number | undefined): string {
    if (ts === undefined) return ''
    const d = new Date(ts)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  function inputToDate (raw: string): number | undefined {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
    return m === null ? undefined : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  }

  function toggleOption (filter: CustomFieldFilter, option: string, on: boolean): void {
    const current = Array.isArray(filter.value) ? filter.value : []
    const next = on ? [...current.filter((v) => v !== option), option] : current.filter((v) => v !== option)
    patch(filter.id, { value: next })
  }
</script>

<div class="antiCard dialog menu cf-filter">
  <div class="antiCard-menu__spacer" />
  {#if filters.length === 0}
    <div class="antiCard-menu__item content-dark-color">
      <Label label={tracker.string.NoFieldFilters} />
    </div>
  {/if}
  {#each filters as filter (filter.id)}
    {@const field = fieldOf(filter)}
    <div class="row">
      {#if field === undefined}
        <span class="content-dark-color"><Label label={tracker.string.FieldFilterUnknownField} /></span>
      {:else}
        <div class="line">
          <DropdownLabels
            kind={'regular'}
            size={'medium'}
            width={'9rem'}
            justify={'left'}
            items={fields.map((f) => ({ id: f.key, label: f.label }))}
            selected={filter.fieldKey}
            on:selected={(e) => selectField(filter, e.detail)}
          />
          <DropdownLabelsIntl
            kind={'regular'}
            size={'medium'}
            width={'9rem'}
            justify={'left'}
            items={operatorsFor(field.type).map((op) => ({ id: op, label: operatorLabels[op] }))}
            selected={filter.operator}
            on:selected={(e) => selectOperator(filter, e.detail)}
          />
          <ButtonIcon
            icon={IconDelete}
            kind={'tertiary'}
            size={'small'}
            tooltip={{ label: tracker.string.RemoveFieldFilter }}
            on:click={() => remove(filter.id)}
          />
        </div>
        {#if filter.operator === 'contains'}
          <EditBox
            kind={'default'}
            placeholder={tracker.string.FieldFilterValue}
            value={typeof filter.value === 'string' ? filter.value : ''}
            on:value={(e) => patch(filter.id, { value: String(e.detail) })}
          />
        {:else if filter.operator === 'between'}
          <div class="line">
            {#if field.type === ProjectFieldType.Date}
              <input
                type="date"
                aria-label="from"
                value={dateToInput(rangeOf(filter).from)}
                on:change={(e) => setRange(filter, 'from', inputToDate(e.currentTarget.value))}
              />
              <input
                type="date"
                aria-label="to"
                value={dateToInput(rangeOf(filter).to)}
                on:change={(e) => setRange(filter, 'to', inputToDate(e.currentTarget.value))}
              />
            {:else}
              <EditBox
                kind={'default'}
                format={'number'}
                placeholder={tracker.string.FieldFilterFrom}
                value={rangeOf(filter).from}
                on:value={(e) => setRange(filter, 'from', toNumber(e.detail))}
              />
              <EditBox
                kind={'default'}
                format={'number'}
                placeholder={tracker.string.FieldFilterTo}
                value={rangeOf(filter).to}
                on:value={(e) => setRange(filter, 'to', toNumber(e.detail))}
              />
            {/if}
          </div>
        {:else if field.type === ProjectFieldType.Date && (filter.operator === 'before' || filter.operator === 'after')}
          <input
            type="date"
            aria-label="date"
            value={dateToInput(typeof filter.value === 'number' ? filter.value : undefined)}
            on:change={(e) => patch(filter.id, { value: inputToDate(e.currentTarget.value) })}
          />
        {:else if filter.operator === 'anyOf'}
          <div class="options">
            {#each field.options ?? [] as option (option.value)}
              <label class="option">
                <input
                  type="checkbox"
                  checked={Array.isArray(filter.value) && filter.value.includes(option.value)}
                  on:change={(e) => toggleOption(filter, option.value, e.currentTarget.checked)}
                />
                <span class="overflow-label">{option.label}</span>
              </label>
            {/each}
          </div>
        {:else if ['eq', 'gt', 'gte', 'lt', 'lte'].includes(filter.operator)}
          <EditBox
            kind={'default'}
            format={'number'}
            placeholder={tracker.string.FieldFilterValue}
            value={typeof filter.value === 'number' ? filter.value : undefined}
            on:value={(e) => patch(filter.id, { value: toNumber(e.detail) })}
          />
        {/if}
      {/if}
    </div>
  {/each}
  <div class="footer">
    <Button
      icon={IconAdd}
      kind={'ghost'}
      label={tracker.string.AddFieldFilter}
      disabled={fields.length === 0}
      on:click={add}
    />
    {#if filters.length > 0}
      <Button kind={'link'} label={tracker.string.ClearFieldFilters} on:click={() => filtersStore.set([])} />
    {/if}
  </div>
  <div class="antiCard-menu__spacer" />
</div>

<style lang="scss">
  .cf-filter {
    min-width: 24rem;
    max-width: 30rem;
    padding: 0.25rem 0.5rem;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 12rem;
    overflow: auto;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 0.5rem;
  }
  input[type='date'] {
    padding: 0.25rem 0.5rem;
    color: var(--theme-caption-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
  }
</style>
