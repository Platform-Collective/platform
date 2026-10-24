<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { BrandAsset, TemplateBand, TemplateOverlay, TemplatePage } from '@hcengineering/branding'
  import { Button, Label, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import branding from '../../plugin'
  import AssetPicker from './AssetPicker.svelte'
  import CheckField from './controls/CheckField.svelte'
  import ColorField from './controls/ColorField.svelte'
  import NumberField from './controls/NumberField.svelte'
  import PanelSection from './controls/PanelSection.svelte'
  import RuleEditor from './controls/RuleEditor.svelte'
  import SelectField from './controls/SelectField.svelte'

  export let page: TemplatePage | undefined = undefined
  export let band: TemplateBand | undefined = undefined
  export let overlay: TemplateOverlay | undefined = undefined
  // Alternate header or footer: shown instead of the main one on its pages, can be deleted
  export let alternate: boolean = false
  // Maximum band height: the matching page margin
  export let maxBandHeight: number = 100

  const dispatchPage = createEventDispatcher<{
    page: Partial<TemplatePage>
    band: Partial<TemplateBand>
    overlay: Partial<TemplateOverlay>
    watermark: 'text' | 'image'
    remove: undefined
    removeAlternate: undefined
  }>()

  const placements = [
    { id: 'before', label: branding.string.BeforeContent, intl: true },
    { id: 'after', label: branding.string.AfterContent, intl: true }
  ]
  const fits = [
    { id: 'cover', label: branding.string.Cover, intl: true },
    { id: 'contain', label: branding.string.Contain, intl: true },
    { id: 'fill', label: branding.string.Stretch, intl: true }
  ]

  function chooseBackground (e: MouseEvent): void {
    if (page === undefined) return
    const current = page
    showPopup(AssetPicker, { kind: 'image' }, eventToHTMLElement(e), (asset: BrandAsset | undefined) => {
      if (asset !== undefined) {
        dispatchPage('page', { background: { ...current.background, file: asset.file } })
      }
    })
  }
</script>

{#if page !== undefined}
  <PanelSection label={branding.string.PageSetup}>
    <input
      class="full name"
      type="text"
      value={page.name}
      on:change={(e) => {
        dispatchPage('page', { name: e.currentTarget.value })
      }}
    />
    <SelectField
      value={page.placement}
      options={placements}
      on:change={(e) => {
        dispatchPage('page', { placement: e.detail === 'after' ? 'after' : 'before' })
      }}
    />
    <CheckField label={branding.string.Enabled} checked={page.enabled} on:change={(e) => dispatchPage('page', { enabled: e.detail })} />
  </PanelSection>
  <PanelSection label={branding.string.Background}>
    <div class="full">
      <ColorField
        label={branding.string.Color}
        value={page.background.color}
        on:change={(e) => {
          if (page !== undefined) dispatchPage('page', { background: { ...page.background, color: e.detail } })
        }}
      />
    </div>
    <ColorField
      label={branding.string.SecondColor}
      value={page.background.color2 ?? ''}
      optional
      on:change={(e) => {
        if (page !== undefined) {
          dispatchPage('page', { background: { ...page.background, color2: e.detail !== '' ? e.detail : undefined } })
        }
      }}
    />
    {#if page.background.color2 !== undefined && page.background.color2 !== ''}
      <NumberField
        label={branding.string.GradientAngle}
        value={page.background.gradientAngle ?? 180}
        step={15}
        min={0}
        max={360}
        unit="°"
        on:change={(e) => {
          if (page !== undefined) dispatchPage('page', { background: { ...page.background, gradientAngle: e.detail } })
        }}
      />
    {/if}
    <div class="full row">
      <Button label={branding.string.ChooseImage} size={'small'} on:click={chooseBackground} />
      {#if page.background.file !== undefined}
        <Button
          label={branding.string.RemoveImage}
          size={'small'}
          on:click={() => {
            if (page !== undefined) dispatchPage('page', { background: { ...page.background, file: undefined } })
          }}
        />
      {/if}
    </div>
    {#if page.background.file !== undefined}
      <SelectField
        label={branding.string.Fit}
        value={page.background.fit}
        options={fits}
        on:change={(e) => {
          if (page !== undefined) {
            dispatchPage('page', { background: { ...page.background, fit: e.detail === 'contain' ? 'contain' : e.detail === 'fill' ? 'fill' : 'cover' } })
          }
        }}
      />
    {/if}
  </PanelSection>
  <div class="danger">
    <Button label={branding.string.DeletePage} kind={'dangerous'} size={'small'} on:click={() => dispatchPage('remove')} />
  </div>
{:else if overlay !== undefined}
  <PanelSection label={branding.string.Overlay} columns={1}>
    <div class="hint"><Label label={branding.string.OverlayHint} /></div>
    <CheckField label={branding.string.Enabled} checked={overlay.enabled} on:change={(e) => dispatchPage('overlay', { enabled: e.detail })} />
    <RuleEditor rule={overlay.rule} on:change={(e) => dispatchPage('overlay', { rule: e.detail })} />
    <div class="row">
      <Button label={branding.string.AddTextWatermark} size={'small'} kind={'primary'} on:click={() => dispatchPage('watermark', 'text')} />
      <Button label={branding.string.AddImageWatermark} size={'small'} on:click={() => dispatchPage('watermark', 'image')} />
    </div>
  </PanelSection>
{:else if band !== undefined}
  <PanelSection label={branding.string.PageSetup}>
    <div class="full">
      <CheckField label={branding.string.Enabled} checked={band.enabled} on:change={(e) => dispatchPage('band', { enabled: e.detail })} />
    </div>
    <NumberField
      label={branding.string.Height}
      value={band.height}
      min={3}
      max={maxBandHeight}
      unit="mm"
      on:change={(e) => dispatchPage('band', { height: e.detail })}
    />
    <ColorField label={branding.string.Background} value={band.background} optional on:change={(e) => dispatchPage('band', { background: e.detail })} />
  </PanelSection>
  <PanelSection label={branding.string.ShowOn} columns={1}>
    {#if alternate}
      <input
        class="name"
        type="text"
        value={band.name ?? ''}
        on:change={(e) => {
          dispatchPage('band', { name: e.currentTarget.value })
        }}
      />
      <div class="hint"><Label label={branding.string.AlternateHint} /></div>
    {/if}
    <RuleEditor rule={band.rule} on:change={(e) => dispatchPage('band', { rule: e.detail })} />
  </PanelSection>
  {#if alternate}
    <div class="danger">
      <Button label={branding.string.DeleteAlternate} kind={'dangerous'} size={'small'} on:click={() => dispatchPage('removeAlternate')} />
    </div>
  {/if}
{/if}

<style lang="scss">
  .name {
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
    background: var(--theme-button-default);
    color: var(--theme-caption-color);
    padding: 0.25rem 0.375rem;
    outline: none;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .hint {
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--theme-dark-color);
  }
  .danger {
    padding: 0.75rem;
  }
</style>
