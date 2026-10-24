<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { BrandAsset, TemplateElement, TextStyle } from '@hcengineering/branding'
  import { fieldPlaceholder } from '@hcengineering/branding'
  import { Button, IconCopy, IconDelete, Label, SelectPopup, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import type { SelectPopupValueType } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import type { FieldInfo } from '../../fields'
  import branding from '../../plugin'
  import AssetPicker from './AssetPicker.svelte'
  import CheckField from './controls/CheckField.svelte'
  import ColorField from './controls/ColorField.svelte'
  import NumberField from './controls/NumberField.svelte'
  import PanelSection from './controls/PanelSection.svelte'
  import RuleEditor from './controls/RuleEditor.svelte'
  import SelectField from './controls/SelectField.svelte'
  import TextStyleFields from './TextStyleFields.svelte'

  export let element: TemplateElement
  export let fields: FieldInfo[]
  export let attributeFields: FieldInfo[] = []
  export let customFonts: string[] = []
  // Header and footer bands can show page numbers
  export let pageFields: boolean = false
  // Elements of headers, footers and overlays can be limited to some pages
  export let pageRules: boolean = false

  const dispatch = createEventDispatcher<{
    change: Partial<TemplateElement>
    remove: undefined
    duplicate: undefined
  }>()

  let textArea: HTMLTextAreaElement | undefined

  function change (patch: Record<string, unknown>): void {
    dispatch('change', patch as unknown as Partial<TemplateElement>)
  }

  function changeStyle (patch: Partial<TextStyle>): void {
    if (element.kind !== 'text') return
    change({ style: { ...element.style, ...patch } })
  }

  /**
   * Pick a field or format and insert it at the caret; typedBraces removes the "{{" that opened the picker.
   */
  function insertField (target: MouseEvent | HTMLElement, typedBraces = false): void {
    if (element.kind !== 'text') return
    const formats = (pageFields ? PAGE_FORMATS : []).concat(TEXT_FORMATS)
    const items: SelectPopupValueType[] = [
      ...formats.map((text, index) => ({
        id: `${FORMAT_PREFIX}${index}`,
        text,
        category: { label: branding.string.Formats }
      })),
      ...fields.map((f) => ({ id: f.key, label: f.label })),
      ...attributeFields.map((f) => ({
        id: f.key,
        label: f.label,
        category: { label: branding.string.DocumentAttribute }
      }))
    ]
    const anchor = target instanceof HTMLElement ? target : eventToHTMLElement(target)
    showPopup(SelectPopup, { value: items, searchable: true }, anchor, (key: string | undefined) => {
      if (key === undefined || element.kind !== 'text') {
        textArea?.focus()
        return
      }
      const placeholder = key.startsWith(FORMAT_PREFIX)
        ? formats[parseInt(key.slice(FORMAT_PREFIX.length), 10)] ?? ''
        : fieldPlaceholder(key)
      const text = element.text
      const end = textArea?.selectionEnd ?? text.length
      const start = Math.max(0, (textArea?.selectionStart ?? text.length) - (typedBraces ? 2 : 0))
      change({ text: text.slice(0, start) + placeholder + text.slice(end) })
      const caret = start + placeholder.length
      requestAnimationFrame(() => {
        textArea?.focus()
        textArea?.setSelectionRange(caret, caret)
      })
    })
  }

  function onTextInput (e: Event & { currentTarget: HTMLTextAreaElement }): void {
    const area = e.currentTarget
    change({ text: area.value })
    const caret = area.selectionStart
    if (caret >= 2 && area.value.slice(caret - 2, caret) === '{{' && area.value[caret - 3] !== '{') {
      insertField(area, true)
    }
  }

  function chooseImage (e: MouseEvent): void {
    showPopup(AssetPicker, { kind: 'image' }, eventToHTMLElement(e), (asset: BrandAsset | undefined) => {
      if (asset !== undefined) {
        change({ file: asset.file })
      }
    })
  }

  const FORMAT_PREFIX = 'format:'
  // Ready-made wordings, freely editable after inserting
  const PAGE_FORMATS = [
    'Page {{pageNumber}}',
    'Page {{pageNumber}} of {{totalPages}}',
    '{{pageNumber}} / {{totalPages}}',
    '{{pageNumber}}',
    '— {{pageNumber}} —'
  ]
  const TEXT_FORMATS = [
    'Version {{version}}',
    'v{{version}}',
    'Author: {{author}}',
    'Prepared by {{author}}',
    '{{author}} · {{printDate}}',
    'Status: {{status}}',
    'Ref: {{identifier}}',
    '© {{workspace}}',
    'Printed {{printDate}} by {{printedBy}}'
  ]

  const fits = [
    { id: 'contain', label: branding.string.Contain, intl: true },
    { id: 'cover', label: branding.string.Cover, intl: true },
    { id: 'fill', label: branding.string.Stretch, intl: true }
  ]
  const verticalAligns = [
    { id: 'top', label: branding.string.Top, intl: true },
    { id: 'middle', label: branding.string.Middle, intl: true },
    { id: 'bottom', label: branding.string.Bottom, intl: true }
  ]
  const dashes = [
    { id: 'solid', label: branding.string.Solid, intl: true },
    { id: 'dashed', label: branding.string.Dashed, intl: true },
    { id: 'dotted', label: branding.string.Dotted, intl: true }
  ]
  const shapes = [
    { id: 'rect', label: branding.string.Rectangle, intl: true },
    { id: 'ellipse', label: branding.string.Ellipse, intl: true }
  ]
</script>

<div class="props">
  <div class="actions">
    <input
      class="name"
      type="text"
      value={element.name ?? ''}
      placeholder={element.kind}
      on:change={(e) => {
        change({ name: e.currentTarget.value })
      }}
    />
    <Button icon={IconCopy} kind={'ghost'} size={'small'} showTooltip={{ label: branding.string.Duplicate }} on:click={() => dispatch('duplicate')} />
    <Button icon={IconDelete} kind={'ghost'} size={'small'} showTooltip={{ label: branding.string.Delete }} on:click={() => dispatch('remove')} />
  </div>

  {#if element.kind === 'text'}
    <PanelSection label={branding.string.Text} columns={1}>
      <textarea
        bind:this={textArea}
        rows="4"
        value={element.text}
        on:input={onTextInput}
      />
      <div class="tip"><Label label={branding.string.FieldTip} /></div>
      <div class="row">
        <Button icon={branding.icon.Field} label={branding.string.Field} size={'small'} on:click={insertField} />
      </div>
      <CheckField
        label={branding.string.Editable}
        hint={branding.string.EditableHint}
        checked={element.editable}
        on:change={(e) => {
          change({ editable: e.detail })
        }}
      />
    </PanelSection>
    <PanelSection label={branding.string.Font}>
      <TextStyleFields style={element.style} {customFonts} on:change={(e) => changeStyle(e.detail)} />
      <SelectField
        label={branding.string.VerticalAlign}
        value={element.verticalAlign}
        options={verticalAligns}
        on:change={(e) => {
          change({ verticalAlign: e.detail })
        }}
      />
      <NumberField label={branding.string.Padding} value={element.padding} min={0} unit="mm" on:change={(e) => change({ padding: e.detail })} />
      <div class="full">
        <ColorField label={branding.string.Background} value={element.background ?? ''} optional on:change={(e) => change({ background: e.detail })} />
      </div>
    </PanelSection>
  {:else if element.kind === 'image'}
    <PanelSection label={branding.string.Image}>
      <div class="full row">
        <Button label={branding.string.ChooseImage} kind={'primary'} size={'small'} on:click={chooseImage} />
        {#if element.file !== undefined}
          <Button label={branding.string.RemoveImage} size={'small'} on:click={() => change({ file: undefined })} />
        {/if}
      </div>
      <SelectField label={branding.string.Fit} value={element.fit} options={fits} on:change={(e) => change({ fit: e.detail })} />
      <NumberField label={branding.string.BorderRadius} value={element.borderRadius} min={0} unit="mm" on:change={(e) => change({ borderRadius: e.detail })} />
    </PanelSection>
  {:else if element.kind === 'shape'}
    <PanelSection label={branding.string.Rectangle}>
      <div class="full">
        <SelectField value={element.shape} options={shapes} on:change={(e) => change({ shape: e.detail })} />
      </div>
      <ColorField label={branding.string.Fill} value={element.fill} optional on:change={(e) => change({ fill: e.detail })} />
      <ColorField
        label={branding.string.SecondColor}
        value={element.fill2 ?? ''}
        optional
        on:change={(e) => change({ fill2: e.detail !== '' ? e.detail : undefined })}
      />
      {#if element.fill2 !== undefined && element.fill2 !== ''}
        <NumberField
          label={branding.string.GradientAngle}
          value={element.gradientAngle ?? 180}
          step={15}
          min={0}
          max={360}
          unit="°"
          on:change={(e) => change({ gradientAngle: e.detail })}
        />
      {/if}
      <ColorField label={branding.string.Stroke} value={element.stroke} on:change={(e) => change({ stroke: e.detail })} />
      <NumberField label={branding.string.StrokeWidth} value={element.strokeWidth} min={0} step={0.1} unit="mm" on:change={(e) => change({ strokeWidth: e.detail })} />
      <SelectField label={branding.string.Dash} value={element.strokeDash ?? 'solid'} options={dashes} on:change={(e) => change({ strokeDash: e.detail })} />
      {#if element.shape === 'rect'}
        <NumberField label={branding.string.BorderRadius} value={element.borderRadius} min={0} unit="mm" on:change={(e) => change({ borderRadius: e.detail })} />
      {/if}
    </PanelSection>
  {:else if element.kind === 'line'}
    <PanelSection label={branding.string.Line}>
      <ColorField label={branding.string.Stroke} value={element.stroke} on:change={(e) => change({ stroke: e.detail })} />
      <NumberField label={branding.string.StrokeWidth} value={element.strokeWidth} min={0.05} step={0.1} unit="mm" on:change={(e) => change({ strokeWidth: e.detail })} />
      <SelectField label={branding.string.Dash} value={element.dash} options={dashes} on:change={(e) => change({ dash: e.detail })} />
    </PanelSection>
  {/if}

  {#if pageRules}
    <PanelSection label={branding.string.ShowOn} columns={1}>
      <CheckField
        label={branding.string.OnlySomePages}
        checked={element.showOn !== undefined}
        on:change={(e) => change({ showOn: e.detail ? { scope: 'all', pages: 'first' } : undefined })}
      />
      {#if element.showOn !== undefined}
        <RuleEditor rule={element.showOn} showScope={false} on:change={(e) => change({ showOn: { ...e.detail, scope: 'all' } })} />
      {/if}
    </PanelSection>
  {/if}

  <PanelSection label={branding.string.Position}>
    <NumberField short="x" value={element.x} unit="mm" on:change={(e) => change({ x: e.detail })} />
    <NumberField short="y" value={element.y} unit="mm" on:change={(e) => change({ y: e.detail })} />
    <NumberField short="w" value={element.width} min={0} unit="mm" on:change={(e) => change({ width: e.detail })} />
    {#if element.kind !== 'line'}
      <NumberField short="h" value={element.height} min={0} unit="mm" on:change={(e) => change({ height: e.detail })} />
    {/if}
    <NumberField label={branding.string.Rotation} value={element.rotation} step={1} min={-360} max={360} unit="°" on:change={(e) => change({ rotation: e.detail })} />
    <NumberField
      label={branding.string.Opacity}
      value={Math.round(element.opacity * 100)}
      step={5}
      min={0}
      max={100}
      unit="%"
      on:change={(e) => change({ opacity: e.detail / 100 })}
    />
    <CheckField label={branding.string.Locked} checked={element.locked === true} on:change={(e) => change({ locked: e.detail })} />
    <CheckField label={branding.string.Hidden} checked={element.hidden === true} on:change={(e) => change({ hidden: e.detail })} />
  </PanelSection>
</div>

<style lang="scss">
  .props {
    display: flex;
    flex-direction: column;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .name {
    flex-grow: 1;
    min-width: 0;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--theme-caption-color);
    font-weight: 600;
    padding: 0.25rem 0.375rem;
    outline: none;

    &:hover,
    &:focus {
      border-color: var(--theme-button-border);
    }
  }
  textarea {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
    background: var(--theme-button-default);
    color: var(--theme-caption-color);
    padding: 0.375rem;
    font-family: monospace;
    font-size: 0.8125rem;
    outline: none;

    &:focus {
      border-color: var(--primary-button-default);
    }
  }
  .tip {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
</style>
