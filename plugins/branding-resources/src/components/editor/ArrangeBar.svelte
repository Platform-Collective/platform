<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { tooltip } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import type { AlignKind, OrderKind } from '../../editor/utils'
  import branding from '../../plugin'
  import PanelSection from './controls/PanelSection.svelte'

  export let count: number
  export let canPaste: boolean = false

  const dispatch = createEventDispatcher<{
    align: AlignKind
    distribute: 'horizontal' | 'vertical'
    order: OrderKind
    copy: undefined
    paste: undefined
  }>()

  // Small inline glyphs, 16x16 viewBox
  const ALIGN: Array<{ kind: AlignKind, label: IntlString, path: string }> = [
    { kind: 'left', label: branding.string.AlignLeftEdges, path: 'M2 1v14M4 4h9v3H4zM4 9h6v3H4z' },
    { kind: 'hcenter', label: branding.string.AlignHorizontalCenters, path: 'M8 1v14M3 4h10v3H3zM5 9h6v3H5z' },
    { kind: 'right', label: branding.string.AlignRightEdges, path: 'M14 1v14M3 4h9v3H3zM6 9h6v3H6z' },
    { kind: 'top', label: branding.string.AlignTopEdges, path: 'M1 2h14M4 4h3v9H4zM9 4h3v6H9z' },
    { kind: 'vmiddle', label: branding.string.AlignVerticalCenters, path: 'M1 8h14M4 3h3v10H4zM9 5h3v6H9z' },
    { kind: 'bottom', label: branding.string.AlignBottomEdges, path: 'M1 14h14M4 3h3v9H4zM9 6h3v6H9z' }
  ]
  const ORDER: Array<{ kind: OrderKind, label: IntlString, path: string }> = [
    { kind: 'front', label: branding.string.BringToFront, path: 'M5 5h9v9H5zM2 2h7v2M2 2v7h2' },
    { kind: 'forward', label: branding.string.BringForward, path: 'M8 13V3M4 7l4-4 4 4' },
    { kind: 'backward', label: branding.string.SendBackward, path: 'M8 3v10M4 9l4 4 4-4' },
    { kind: 'back', label: branding.string.SendToBack, path: 'M2 2h9v9H2zM14 7v7H7M14 14h-2' }
  ]
</script>

<PanelSection label={count > 1 ? branding.string.Arrange : branding.string.AlignToPage} columns={1}>
  <div class="tools">
    {#each ALIGN as item}
      <button type="button" use:tooltip={{ label: item.label }} on:click={() => dispatch('align', item.kind)}>
        <svg viewBox="0 0 16 16"><path d={item.path} /></svg>
      </button>
    {/each}
  </div>
  <div class="tools">
    <button
      type="button"
      disabled={count < 3}
      use:tooltip={{ label: branding.string.DistributeHorizontally }}
      on:click={() => dispatch('distribute', 'horizontal')}
    >
      <svg viewBox="0 0 16 16"><path d="M1 1v14M15 1v14M5 4h2v8H5zM9 4h2v8H9z" /></svg>
    </button>
    <button
      type="button"
      disabled={count < 3}
      use:tooltip={{ label: branding.string.DistributeVertically }}
      on:click={() => dispatch('distribute', 'vertical')}
    >
      <svg viewBox="0 0 16 16"><path d="M1 1h14M1 15h14M4 5h8v2H4zM4 9h8v2H4z" /></svg>
    </button>
    <span class="divider" />
    {#each ORDER as item}
      <button type="button" use:tooltip={{ label: item.label }} on:click={() => dispatch('order', item.kind)}>
        <svg viewBox="0 0 16 16"><path d={item.path} /></svg>
      </button>
    {/each}
    <span class="divider" />
    <button type="button" use:tooltip={{ label: branding.string.CopyElements }} on:click={() => dispatch('copy')}>
      <svg viewBox="0 0 16 16"><path d="M5 5h9v9H5zM2 11V2h9" /></svg>
    </button>
    <button
      type="button"
      disabled={!canPaste}
      use:tooltip={{ label: branding.string.PasteElements }}
      on:click={() => dispatch('paste')}
    >
      <svg viewBox="0 0 16 16"><path d="M4 3H2v12h12V3h-2M5 1h6v4H5z" /></svg>
    </button>
  </div>
</PanelSection>

<style lang="scss">
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
    background: var(--theme-button-default);
    color: var(--theme-content-color);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--theme-button-hovered);
      color: var(--theme-caption-color);
    }
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
    svg {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.3;
      stroke-linejoin: round;
    }
  }
  .divider {
    width: 1px;
    height: 1.25rem;
    margin: 0 0.125rem;
    background: var(--theme-divider-color);
  }
</style>
