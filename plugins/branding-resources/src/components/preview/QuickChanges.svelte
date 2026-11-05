<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type TemplateDesign, type TextElement, HEADING_LEVELS, createWatermark } from '@hcengineering/branding'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import { clone } from '../../editor/utils'
  import branding from '../../plugin'
  import CheckField from '../editor/controls/CheckField.svelte'
  import ColorField from '../editor/controls/ColorField.svelte'
  import NumberField from '../editor/controls/NumberField.svelte'
  import PanelSection from '../editor/controls/PanelSection.svelte'
  import PageSetupPanel from '../editor/PageSetupPanel.svelte'

  export let design: TemplateDesign

  // Every change hands back a modified copy; the key groups consecutive changes into one undo step
  const dispatch = createEventDispatcher<{ change: { design: TemplateDesign, key: string } }>()

  function update (key: string, fn: (d: TemplateDesign) => void): void {
    const next = clone(design)
    fn(next)
    dispatch('change', { design: next, key })
  }

  $: watermark = design.overlay.elements.find((el): el is TextElement => el.kind === 'text' && el.name === 'Watermark')
  $: headingColor = design.typography.headings.h1.color
</script>

<div class="title"><Label label={branding.string.QuickChanges} /></div>
<div class="hint"><Label label={branding.string.QuickChangesHint} /></div>

<PanelSection label={branding.string.Pages} columns={1}>
  {#each design.pages as page (page.id)}
    <CheckField
      label={branding.string.PageLabel}
      labelParams={{ name: page.name !== '' ? page.name : '—' }}
      checked={page.enabled}
      on:change={(e) => {
        update('pages', (d) => {
          d.pages = d.pages.map((p) => (p.id === page.id ? { ...p, enabled: e.detail } : p))
        })
      }}
    />
  {/each}
  <CheckField
    label={branding.string.Header}
    checked={design.header.enabled}
    on:change={(e) => {
      update('header', (d) => {
        d.header.enabled = e.detail
      })
    }}
  />
  <CheckField
    label={branding.string.Footer}
    checked={design.footer.enabled}
    on:change={(e) => {
      update('footer', (d) => {
        d.footer.enabled = e.detail
      })
    }}
  />
</PanelSection>

<PanelSection label={branding.string.Overlay} columns={1}>
  {#if watermark !== undefined}
    <CheckField
      label={branding.string.Enabled}
      checked={design.overlay.enabled}
      on:change={(e) => {
        update('overlay', (d) => {
          d.overlay.enabled = e.detail
        })
      }}
    />
    <input
      class="text"
      type="text"
      value={watermark.text}
      on:input={(e) => {
        const text = e.currentTarget.value
        const id = watermark?.id
        update('watermark-text', (d) => {
          d.overlay.elements = d.overlay.elements.map((el) => (el.id === id && el.kind === 'text' ? { ...el, text } : el))
        })
      }}
    />
    <NumberField
      label={branding.string.Opacity}
      value={Math.round(watermark.opacity * 100)}
      step={5}
      min={0}
      max={100}
      unit="%"
      on:change={(e) => {
        const id = watermark?.id
        update('watermark-opacity', (d) => {
          d.overlay.elements = d.overlay.elements.map((el) => (el.id === id ? { ...el, opacity: e.detail / 100 } : el))
        })
      }}
    />
  {:else}
    <button
      type="button"
      class="add"
      on:click={() => {
        update('watermark-add', (d) => {
          d.overlay = { ...d.overlay, enabled: true, elements: [...d.overlay.elements, createWatermark(d.page)] }
        })
      }}
    >
      + <Label label={branding.string.AddTextWatermark} />
    </button>
  {/if}
</PanelSection>

<PanelSection label={branding.string.BodyFormatting}>
  <NumberField
    label={branding.string.FontSize}
    value={design.typography.body.fontSize}
    step={0.5}
    min={6}
    max={24}
    unit="pt"
    on:change={(e) => {
      update('body-size', (d) => {
        d.typography.body.fontSize = e.detail
      })
    }}
  />
  <NumberField
    label={branding.string.LineHeight}
    value={design.typography.body.lineHeight}
    step={0.05}
    min={0.8}
    max={3}
    on:change={(e) => {
      update('body-line', (d) => {
        d.typography.body.lineHeight = e.detail
      })
    }}
  />
  <NumberField
    label={branding.string.ParagraphSpacing}
    value={design.typography.paragraphSpacing}
    min={0}
    max={48}
    unit="pt"
    on:change={(e) => {
      update('paragraph', (d) => {
        d.typography.paragraphSpacing = e.detail
      })
    }}
  />
  <ColorField
    label={branding.string.HeadingColor}
    value={headingColor}
    on:change={(e) => {
      update('heading-color', (d) => {
        for (const level of HEADING_LEVELS.slice(0, 3)) d.typography.headings[level].color = e.detail
      })
    }}
  />
  <div class="full">
    <CheckField
      label={branding.string.NumberHeadings}
      checked={design.typography.numberHeadings}
      on:change={(e) => {
        update('numbering', (d) => {
          d.typography.numberHeadings = e.detail
        })
      }}
    />
  </div>
  <div class="full">
    <CheckField
      label={branding.string.SectionsOnNewPage}
      checked={design.typography.headings.h1.pageBreakBefore}
      on:change={(e) => {
        update('h1-break', (d) => {
          d.typography.headings.h1.pageBreakBefore = e.detail
        })
      }}
    />
  </div>
</PanelSection>

<PageSetupPanel
  page={design.page}
  numbering={design.numbering}
  on:change={(e) => {
    update('page', (d) => {
      d.page = e.detail
    })
  }}
  on:numbering={(e) => {
    update('numbering', (d) => {
      d.numbering = e.detail
    })
  }}
/>

<style lang="scss">
  .title {
    padding: 0.75rem 0.75rem 0.25rem;
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .hint {
    padding: 0 0.75rem 0.75rem;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--theme-dark-color);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .text {
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
    background: var(--theme-button-default);
    color: var(--theme-caption-color);
    padding: 0.3rem 0.4rem;
    font-size: 0.8125rem;
    outline: none;

    &:focus {
      border-color: var(--primary-button-default);
    }
  }
  .add {
    align-self: flex-start;
    border: none;
    background: none;
    padding: 0;
    color: var(--primary-button-default);
    font-size: 0.8125rem;
    cursor: pointer;
  }
</style>
