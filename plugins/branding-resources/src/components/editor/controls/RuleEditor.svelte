<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type PageRule, type PageScope, type PageSelection, PAGE_SELECTIONS, defaultPageRule } from '@hcengineering/branding'
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import branding from '../../../plugin'
  import SelectField from './SelectField.svelte'

  export let rule: PageRule | undefined
  // Element rules inherit the scope of their band and only pick pages
  export let showScope: boolean = true

  const dispatch = createEventDispatcher<{ change: PageRule }>()

  $: value = rule ?? defaultPageRule()

  const SCOPES: Array<{ id: PageScope, label: IntlString, intl: true }> = [
    { id: 'content', label: branding.string.ScopeContent, intl: true },
    { id: 'template', label: branding.string.ScopeTemplate, intl: true },
    { id: 'all', label: branding.string.ScopeAll, intl: true }
  ]
  const SELECTION_LABELS: Record<PageSelection, IntlString> = {
    all: branding.string.PagesAll,
    first: branding.string.PagesFirst,
    notFirst: branding.string.PagesNotFirst,
    last: branding.string.PagesLast,
    notLast: branding.string.PagesNotLast,
    odd: branding.string.PagesOdd,
    even: branding.string.PagesEven,
    custom: branding.string.PagesCustom
  }
  const SELECTIONS = PAGE_SELECTIONS.map((id) => ({ id, label: SELECTION_LABELS[id], intl: true }))

  function update (patch: Partial<PageRule>): void {
    dispatch('change', { ...value, ...patch })
  }
</script>

<div class="rule">
  {#if showScope}
    <SelectField
      label={branding.string.AppliesTo}
      value={value.scope}
      options={SCOPES}
      on:change={(e) => update({ scope: SCOPES.find((s) => s.id === e.detail)?.id ?? 'content' })}
    />
  {/if}
  <SelectField
    label={branding.string.ShowOn}
    value={value.pages}
    options={SELECTIONS}
    on:change={(e) => update({ pages: PAGE_SELECTIONS.find((s) => s === e.detail) ?? 'all' })}
  />
  {#if value.pages === 'custom'}
    <label class="custom">
      <input
        type="text"
        value={value.custom ?? ''}
        placeholder="1, 3-5, 8-"
        on:input={(e) => update({ custom: e.currentTarget.value })}
      />
      <span class="hint"><Label label={branding.string.CustomPagesHint} /></span>
    </label>
  {/if}
</div>

<style lang="scss">
  .rule {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .custom {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;

    input {
      border: 1px solid var(--theme-button-border);
      border-radius: 0.25rem;
      background: var(--theme-button-default);
      color: var(--theme-caption-color);
      padding: 0.3rem 0.4rem;
      font-size: 0.8125rem;
      font-family: monospace;
      outline: none;

      &:focus {
        border-color: var(--primary-button-default);
      }
    }
  }
  .hint {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
</style>
