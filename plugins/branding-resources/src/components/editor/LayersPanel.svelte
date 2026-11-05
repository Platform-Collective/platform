<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { TemplateElement } from '@hcengineering/branding'
  import { Icon, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import branding from '../../plugin'

  export let elements: TemplateElement[]
  export let selected: string[]

  const dispatch = createEventDispatcher<{
    select: { ids: string[] }
    move: { id: string, delta: number }
    toggle: { id: string, key: 'hidden' | 'locked' }
  }>()

  const icons = {
    text: branding.icon.Text,
    image: branding.icon.Image,
    shape: branding.icon.Rectangle,
    line: branding.icon.Line
  }

  function title (el: TemplateElement): string {
    if (el.name !== undefined && el.name !== '') return el.name
    if (el.kind === 'text') return el.text.split('\n')[0].slice(0, 40)
    return el.kind
  }

  // Topmost element first, as in drawing tools
  $: ordered = [...elements].reverse()
</script>

<div class="layers">
  <div class="title"><Label label={branding.string.Layers} /></div>
  {#each ordered as el (el.id)}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div
      class="layer"
      class:selected={selected.includes(el.id)}
      class:hidden={el.hidden === true}
      on:click={(e) => {
        dispatch('select', { ids: e.shiftKey ? [...selected, el.id] : [el.id] })
      }}
    >
      <Icon icon={icons[el.kind]} size={'small'} />
      <span class="label overflow-label">{title(el)}</span>
      <button type="button" title="↑" on:click|stopPropagation={() => dispatch('move', { id: el.id, delta: 1 })}>↑</button>
      <button type="button" title="↓" on:click|stopPropagation={() => dispatch('move', { id: el.id, delta: -1 })}>↓</button>
      <button
        type="button"
        class:active={el.locked === true}
        on:click|stopPropagation={() => dispatch('toggle', { id: el.id, key: 'locked' })}>{el.locked === true ? '🔒' : '🔓'}</button
      >
      <button
        type="button"
        class:active={el.hidden === true}
        on:click|stopPropagation={() => dispatch('toggle', { id: el.id, key: 'hidden' })}>{el.hidden === true ? '◌' : '●'}</button
      >
    </div>
  {/each}
</div>

<style lang="scss">
  .layers {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    gap: 0.125rem;
  }
  .title {
    font-weight: 600;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--theme-dark-color);
    margin-bottom: 0.375rem;
  }
  .layer {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.375rem;
    border-radius: 0.25rem;
    cursor: pointer;
    color: var(--theme-content-color);

    &:hover {
      background: var(--theme-button-hovered);
    }
    &.selected {
      background: var(--theme-button-pressed);
      color: var(--theme-caption-color);
    }
    &.hidden .label {
      opacity: 0.5;
    }
    .label {
      flex-grow: 1;
      font-size: 0.8125rem;
    }
    button {
      border: none;
      background: none;
      padding: 0 0.125rem;
      font-size: 0.75rem;
      color: var(--theme-dark-color);
      cursor: pointer;
      opacity: 0;

      &.active {
        opacity: 1;
      }
    }
    &:hover button {
      opacity: 1;
    }
  }
</style>
