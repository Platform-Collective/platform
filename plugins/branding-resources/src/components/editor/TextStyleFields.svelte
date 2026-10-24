<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { TextStyle } from '@hcengineering/branding'
  import { createEventDispatcher } from 'svelte'

  import branding from '../../plugin'
  import { fontOptions } from '../../editor/fonts'
  import CheckField from './controls/CheckField.svelte'
  import ColorField from './controls/ColorField.svelte'
  import NumberField from './controls/NumberField.svelte'
  import SelectField from './controls/SelectField.svelte'

  export let style: TextStyle
  export let customFonts: string[] = []
  export let showAlign: boolean = true

  const dispatch = createEventDispatcher<{ change: Partial<TextStyle> }>()

  const weights = [300, 400, 500, 600, 700, 800].map((w) => ({ id: String(w), label: String(w) }))
  const aligns = [
    { id: 'left', label: branding.string.AlignLeft, intl: true },
    { id: 'center', label: branding.string.AlignCenter, intl: true },
    { id: 'right', label: branding.string.AlignRight, intl: true },
    { id: 'justify', label: branding.string.AlignJustify, intl: true }
  ]
  const transforms = [
    { id: 'none', label: 'Aa' },
    { id: 'uppercase', label: 'AA' },
    { id: 'lowercase', label: 'aa' },
    { id: 'capitalize', label: 'Aa Aa' }
  ]

  $: fonts = fontOptions(customFonts)

  function toAlign (value: string): TextStyle['align'] {
    return (aligns.find((a) => a.id === value)?.id ?? 'left') as TextStyle['align']
  }

  function toTransform (value: string): TextStyle['textTransform'] {
    return (transforms.find((t) => t.id === value)?.id ?? 'none') as TextStyle['textTransform']
  }
</script>

<div class="full">
  <SelectField
    label={branding.string.Font}
    value={style.fontFamily}
    options={fonts}
    on:change={(e) => dispatch('change', { fontFamily: e.detail })}
  />
</div>
<NumberField
  label={branding.string.FontSize}
  value={style.fontSize}
  step={0.5}
  min={4}
  max={200}
  unit="pt"
  on:change={(e) => dispatch('change', { fontSize: e.detail })}
/>
<SelectField
  label={branding.string.FontWeight}
  value={String(style.fontWeight)}
  options={weights}
  on:change={(e) => dispatch('change', { fontWeight: parseInt(e.detail, 10) })}
/>
<ColorField label={branding.string.Color} value={style.color} on:change={(e) => dispatch('change', { color: e.detail })} />
{#if showAlign}
  <SelectField
    label={branding.string.Align}
    value={style.align}
    options={aligns}
    on:change={(e) => dispatch('change', { align: toAlign(e.detail) })}
  />
{/if}
<NumberField
  label={branding.string.LineHeight}
  value={style.lineHeight}
  step={0.05}
  min={0.5}
  max={4}
  on:change={(e) => dispatch('change', { lineHeight: e.detail })}
/>
<NumberField
  label={branding.string.LetterSpacing}
  value={style.letterSpacing}
  step={0.1}
  min={-5}
  max={20}
  unit="pt"
  on:change={(e) => dispatch('change', { letterSpacing: e.detail })}
/>
<SelectField
  label={branding.string.TextTransform}
  value={style.textTransform}
  options={transforms}
  on:change={(e) => dispatch('change', { textTransform: toTransform(e.detail) })}
/>
<div class="checks">
  <CheckField label={branding.string.Italic} checked={style.italic} on:change={(e) => dispatch('change', { italic: e.detail })} />
  <CheckField
    label={branding.string.Underline}
    checked={style.underline}
    on:change={(e) => dispatch('change', { underline: e.detail })}
  />
</div>

<style lang="scss">
  .checks {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 0.25rem;
  }
</style>
