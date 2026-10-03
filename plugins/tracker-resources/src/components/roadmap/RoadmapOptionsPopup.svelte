<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Icon, IconCheck } from '@hcengineering/ui'
  import type { OptionItem, OptionSection } from './types'

  export let sections: OptionSection[]
  // Explanation shown at the end, already translated
  export let hint: string | undefined = undefined
  // Called after an item was clicked; the popup updates its own state, the host stores the choice
  export let onToggle: (sectionId: string, itemId: string) => void

  // The popup shows what the user chose without waiting for the host
  let state = sections.map((s) => ({ ...s, items: s.items.map((it) => ({ ...it })) }))

  function toggle (section: OptionSection, item: OptionItem): void {
    state = state.map((s) => {
      if (s.id !== section.id) return s
      return {
        ...s,
        items: s.items.map((it) => {
          if (s.mode === 'single') return { ...it, checked: it.id === item.id }
          return it.id === item.id ? { ...it, checked: !it.checked } : it
        })
      }
    })
    onToggle(section.id, item.id)
  }
</script>

<div class="antiPopup roadmap-popup" data-id="roadmap-popup">
  <div class="ap-scroll">
    <div class="ap-box">
      {#each state as section (section.id)}
        {#if section.title !== undefined}
          <div class="section-title">{section.title}</div>
        {/if}
        {#each section.items as item (item.id)}
          <button
            class="item"
            type="button"
            role={section.mode === 'single' ? 'radio' : 'checkbox'}
            aria-checked={item.checked}
            on:click={() => {
              toggle(section, item)
            }}
          >
            <span class="check">
              {#if item.checked}
                <Icon icon={IconCheck} size={'small'} />
              {/if}
            </span>
            <span class="label">{item.label}</span>
            {#if item.note !== undefined}
              <span class="note">{item.note}</span>
            {/if}
          </button>
        {/each}
      {/each}
      {#if hint !== undefined}
        <div class="hint">{hint}</div>
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  .roadmap-popup {
    min-width: 15rem;
    max-width: 22rem;
    max-height: 26rem;
    padding: 0.25rem 0;
  }
  .section-title {
    padding: 0.5rem 0.75rem 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--theme-dark-color);
    text-transform: uppercase;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0.25rem;
    padding: 0.375rem 0.5rem;
    border: none;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--theme-caption-color);
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: var(--theme-popup-hover);
    }
  }
  .check {
    display: flex;
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
    color: var(--theme-dark-color);
  }
  .label {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .hint {
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    border-top: 1px solid var(--theme-popup-divider);
    margin-top: 0.25rem;
  }
</style>
