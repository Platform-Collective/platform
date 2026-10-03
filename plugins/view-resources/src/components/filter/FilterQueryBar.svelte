<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { IntlString } from '@hcengineering/platform'
  import { Button, IconClose, IconFilter, Icon, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import {
    applySuggestion,
    parseFilter,
    suggest,
    type FieldSpec,
    type ParseError,
    type ParseErrorCode,
    type SuggestionResult
  } from '../../filter/grammar'
  import viewPlugin from '../../plugin'

  // The applied filter string
  export let value: string = ''
  // Fields the filter can address
  export let schema: FieldSpec[] = []

  const dispatch = createEventDispatcher()

  let input: HTMLInputElement | undefined
  let draft = value
  let lastValue = value
  // An external change (switching a saved view, the clear action) replaces the draft
  $: if (value !== lastValue) {
    lastValue = value
    draft = value
  }

  let focused = false
  // The error is shown after an attempt to apply, not while the user is still typing
  let showError = false
  let suggestions: SuggestionResult = { from: 0, to: 0, items: [] }
  let selected = -1

  $: parsed = parseFilter(draft, schema)
  $: error = parsed.ok ? undefined : parsed.error
  $: open = focused && suggestions.items.length > 0

  const errorStrings: Record<ParseErrorCode, IntlString> = {
    unterminatedQuote: viewPlugin.string.FilterQueryErrorQuote,
    unbalancedParenthesis: viewPlugin.string.FilterQueryErrorParenthesis,
    unexpectedToken: viewPlugin.string.FilterQueryErrorUnexpected,
    unknownField: viewPlugin.string.FilterQueryErrorUnknownField,
    missingValue: viewPlugin.string.FilterQueryErrorMissingValue,
    invalidOperator: viewPlugin.string.FilterQueryErrorOperator,
    invalidValue: viewPlugin.string.FilterQueryErrorValue,
    invalidDate: viewPlugin.string.FilterQueryErrorDate,
    invalidNumber: viewPlugin.string.FilterQueryErrorNumber,
    invalidRange: viewPlugin.string.FilterQueryErrorRange,
    unknownKeyword: viewPlugin.string.FilterQueryErrorKeyword
  }

  function errorToken (e: ParseError): string {
    return draft.slice(e.pos, e.end)
  }

  function updateSuggestions (): void {
    const caret = input?.selectionStart ?? draft.length
    suggestions = suggest(draft, caret, schema)
    selected = -1
  }

  function onInput (): void {
    showError = false
    updateSuggestions()
  }

  function apply (): void {
    const text = draft.trim()
    if (!parsed.ok) {
      showError = true
      return
    }
    showError = false
    suggestions = { from: 0, to: 0, items: [] }
    lastValue = text
    draft = text
    dispatch('apply', text)
  }

  function clear (): void {
    draft = ''
    lastValue = ''
    showError = false
    suggestions = { from: 0, to: 0, items: [] }
    dispatch('apply', '')
    input?.focus()
  }

  function accept (index: number): void {
    const item = suggestions.items[index]
    if (item === undefined) return
    const res = applySuggestion(draft, suggestions, item)
    draft = res.text
    showError = false
    // Continue with the value of a field that was just completed
    requestAnimationFrame(() => {
      input?.setSelectionRange(res.caret, res.caret)
      updateSuggestions()
    })
  }

  function onKeydown (e: KeyboardEvent): void {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selected = (selected + 1) % suggestions.items.length
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        selected = selected <= 0 ? suggestions.items.length - 1 : selected - 1
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && selected >= 0)) {
        e.preventDefault()
        accept(selected >= 0 ? selected : 0)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        suggestions = { from: 0, to: 0, items: [] }
        return
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      apply()
    }
  }

  function onBlur (): void {
    focused = false
    if (!parsed.ok && draft.trim() !== '') showError = true
  }
</script>

<div class="filter-query" class:invalid={showError && error !== undefined} data-id="filter-query-bar">
  <div class="field">
    <span class="icon"><Icon icon={IconFilter} size={'small'} /></span>
    <input
      bind:this={input}
      bind:value={draft}
      type="text"
      class="input"
      spellcheck="false"
      autocomplete="off"
      aria-label="filter"
      data-id="filter-query-input"
      on:input={onInput}
      on:keydown={onKeydown}
      on:click={updateSuggestions}
      on:focus={() => {
        focused = true
        updateSuggestions()
      }}
      on:blur={onBlur}
    />
    {#if draft === ''}
      <span class="placeholder"><Label label={viewPlugin.string.FilterQueryPlaceholder} /></span>
    {/if}
    {#if draft !== ''}
      <Button
        icon={IconClose}
        kind={'ghost'}
        size={'small'}
        showTooltip={{ label: viewPlugin.string.FilterQueryClear }}
        on:click={clear}
      />
    {/if}
    {#if open}
      <div class="suggestions" role="listbox">
        {#each suggestions.items as item, i (item.kind + item.label)}
          <!-- mousedown keeps the focus in the input so that the list does not close before the click -->
          <div
            class="suggestion"
            class:selected={i === selected}
            role="option"
            aria-selected={i === selected}
            on:mousedown|preventDefault={() => {
              accept(i)
            }}
          >
            <span class="kind" class:value={item.kind === 'value'}>{item.kind === 'field' ? '#' : '='}</span>
            {item.label}
          </div>
        {/each}
      </div>
    {/if}
  </div>
  {#if showError && error !== undefined}
    <div class="error" role="alert" data-id="filter-query-error">
      <Label label={errorStrings[error.code]} params={{ token: errorToken(error) }} />
      {#if error.hints !== undefined && error.hints.length > 0}
        <span class="hints">
          <Label label={viewPlugin.string.FilterQueryDidYouMean} params={{ hints: error.hints.join(', ') }} />
        </span>
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  .filter-query {
    position: relative;
    padding: 0.375rem 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .field {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.5rem;
    min-height: 2rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background-color: var(--theme-bg-color);
    &:focus-within {
      border-color: var(--primary-button-default);
    }
  }
  .invalid .field {
    border-color: var(--system-error-color, #d73a49);
  }
  .icon {
    display: flex;
    color: var(--theme-dark-color);
  }
  .input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--theme-caption-color);
    font-size: 0.875rem;
    font-family: inherit;
  }
  .placeholder {
    position: absolute;
    left: 2.25rem;
    pointer-events: none;
    color: var(--theme-dark-color);
    font-size: 0.875rem;
  }
  .suggestions {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    min-width: 14rem;
    max-width: 100%;
    max-height: 16rem;
    overflow-y: auto;
    z-index: 460;
    padding: 0.25rem;
    border: 1px solid var(--theme-popup-divider);
    border-radius: 0.5rem;
    background-color: var(--theme-popup-color);
    box-shadow: var(--theme-popup-shadow);
  }
  .suggestion {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--theme-caption-color);
    &.selected,
    &:hover {
      background-color: var(--theme-popup-hover);
    }
  }
  .kind {
    width: 1rem;
    text-align: center;
    color: var(--theme-dark-color);
  }
  .error {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--system-error-color, #d73a49);
  }
  .hints {
    margin-left: 0.5rem;
    color: var(--theme-dark-color);
  }
</style>
