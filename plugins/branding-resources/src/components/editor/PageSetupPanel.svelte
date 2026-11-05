<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import {
    PAGE_SIZES,
    type PageMargins,
    type PageNumbering,
    type PageSetup,
    type PageSizeName,
    defaultNumbering
  } from '@hcengineering/branding'
  import { createEventDispatcher } from 'svelte'

  import branding from '../../plugin'
  import CheckField from './controls/CheckField.svelte'
  import NumberField from './controls/NumberField.svelte'
  import PanelSection from './controls/PanelSection.svelte'
  import SelectField from './controls/SelectField.svelte'

  export let page: PageSetup
  export let numbering: PageNumbering | undefined = undefined

  const dispatch = createEventDispatcher<{ change: PageSetup, numbering: PageNumbering }>()

  $: numberingValue = numbering ?? defaultNumbering()

  const sizes = [
    ...Object.entries(PAGE_SIZES).map(([id, s]) => ({ id, label: `${id} (${s.width} × ${s.height} mm)` })),
    { id: 'Custom', label: branding.string.Custom, intl: true }
  ]
  const orientations = [
    { id: 'portrait', label: branding.string.Portrait, intl: true },
    { id: 'landscape', label: branding.string.Landscape, intl: true }
  ]

  function setSize (size: string): void {
    const name = size as PageSizeName
    if (name === 'Custom') {
      dispatch('change', { ...page, size: name })
      return
    }
    const preset = PAGE_SIZES[name]
    if (preset !== undefined) {
      dispatch('change', { ...page, size: name, ...preset })
    }
  }

  function setMargin (key: keyof PageMargins, value: number): void {
    dispatch('change', { ...page, margins: { ...page.margins, [key]: value } })
  }
</script>

<PanelSection label={branding.string.PageSize}>
  <div class="full">
    <SelectField value={page.size} options={sizes} on:change={(e) => setSize(e.detail)} />
  </div>
  {#if page.size === 'Custom'}
    <NumberField label={branding.string.Width} value={page.width} min={50} max={2000} unit="mm" on:change={(e) => dispatch('change', { ...page, width: e.detail })} />
    <NumberField label={branding.string.Height} value={page.height} min={50} max={2000} unit="mm" on:change={(e) => dispatch('change', { ...page, height: e.detail })} />
  {/if}
  <div class="full">
    <SelectField
      label={branding.string.Orientation}
      value={page.orientation}
      options={orientations}
      on:change={(e) => dispatch('change', { ...page, orientation: e.detail === 'landscape' ? 'landscape' : 'portrait' })}
    />
  </div>
</PanelSection>
<PanelSection label={branding.string.Margins}>
  <NumberField label={branding.string.Top} value={page.margins.top} min={0} unit="mm" on:change={(e) => setMargin('top', e.detail)} />
  <NumberField label={branding.string.Bottom} value={page.margins.bottom} min={0} unit="mm" on:change={(e) => setMargin('bottom', e.detail)} />
  <NumberField label={branding.string.Left} value={page.margins.left} min={0} unit="mm" on:change={(e) => setMargin('left', e.detail)} />
  <NumberField label={branding.string.Right} value={page.margins.right} min={0} unit="mm" on:change={(e) => setMargin('right', e.detail)} />
</PanelSection>

{#if numbering !== undefined}
  <PanelSection label={branding.string.PageNumbering}>
    <div class="full">
      <CheckField
        label={branding.string.CountTemplatePages}
        checked={numberingValue.countTemplatePages}
        on:change={(e) => dispatch('numbering', { ...numberingValue, countTemplatePages: e.detail })}
      />
    </div>
    <NumberField
      label={branding.string.StartAt}
      value={numberingValue.start}
      step={1}
      min={0}
      max={9999}
      on:change={(e) => dispatch('numbering', { ...numberingValue, start: Math.round(e.detail) })}
    />
  </PanelSection>
{/if}
