<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import {
    HEADING_LEVELS,
    type HeadingLevel,
    type HeadingStyle,
    type TemplateTypography,
    type TextStyle
  } from '@hcengineering/branding'
  import { createEventDispatcher } from 'svelte'

  import branding from '../../plugin'
  import CheckField from './controls/CheckField.svelte'
  import ColorField from './controls/ColorField.svelte'
  import NumberField from './controls/NumberField.svelte'
  import PanelSection from './controls/PanelSection.svelte'
  import SelectField from './controls/SelectField.svelte'
  import TextStyleFields from './TextStyleFields.svelte'
  import { fontOptions } from '../../editor/fonts'

  export let typography: TemplateTypography
  export let customFonts: string[] = []
  export let level: HeadingLevel | 'body' = 'h1'

  const dispatch = createEventDispatcher<{ change: TemplateTypography }>()

  $: heading = level !== 'body' ? typography.headings[level] : undefined

  function changeBody (patch: Partial<TextStyle>): void {
    dispatch('change', { ...typography, body: { ...typography.body, ...patch } })
  }

  function changeHeading (patch: Partial<HeadingStyle>): void {
    if (level === 'body') return
    dispatch('change', {
      ...typography,
      headings: { ...typography.headings, [level]: { ...typography.headings[level], ...patch } }
    })
  }
</script>

<div class="levels">
  <button type="button" class:selected={level === 'body'} on:click={() => (level = 'body')}>¶</button>
  {#each HEADING_LEVELS as l}
    <button type="button" class:selected={level === l} on:click={() => (level = l)}>{l.toUpperCase()}</button>
  {/each}
</div>

<div class="numbering">
  <CheckField
    label={branding.string.NumberHeadings}
    checked={typography.numberHeadings}
    on:change={(e) => dispatch('change', { ...typography, numberHeadings: e.detail })}
  />
</div>

{#if heading !== undefined}
  <PanelSection label={branding.string.Font}>
    <TextStyleFields style={heading} {customFonts} on:change={(e) => changeHeading(e.detail)} />
  </PanelSection>
  <PanelSection label={branding.string.Position}>
    <NumberField label={branding.string.SpaceBefore} value={heading.spaceBefore} min={0} unit="pt" on:change={(e) => changeHeading({ spaceBefore: e.detail })} />
    <NumberField label={branding.string.SpaceAfter} value={heading.spaceAfter} min={0} unit="pt" on:change={(e) => changeHeading({ spaceAfter: e.detail })} />
    <div class="full">
      <CheckField label={branding.string.BorderBottom} checked={heading.borderBottom} on:change={(e) => changeHeading({ borderBottom: e.detail })} />
    </div>
    {#if heading.borderBottom}
      <div class="full">
        <ColorField label={branding.string.Color} value={heading.borderColor} on:change={(e) => changeHeading({ borderColor: e.detail })} />
      </div>
    {/if}
    <div class="full">
      <CheckField
        label={branding.string.PageBreakBefore}
        checked={heading.pageBreakBefore}
        on:change={(e) => changeHeading({ pageBreakBefore: e.detail })}
      />
    </div>
  </PanelSection>
{:else}
  <PanelSection label={branding.string.Body}>
    <TextStyleFields style={typography.body} {customFonts} on:change={(e) => changeBody(e.detail)} />
  </PanelSection>
  <PanelSection label={branding.string.BodyFormatting}>
    <NumberField
      label={branding.string.ParagraphSpacing}
      value={typography.paragraphSpacing}
      min={0}
      max={48}
      unit="pt"
      on:change={(e) => dispatch('change', { ...typography, paragraphSpacing: e.detail })}
    />
    <ColorField
      label={branding.string.RuleColor}
      value={typography.ruleColor}
      on:change={(e) => dispatch('change', { ...typography, ruleColor: e.detail })}
    />
  </PanelSection>
  <PanelSection label={branding.string.Quote}>
    <ColorField
      label={branding.string.Stroke}
      value={typography.quoteBorderColor}
      on:change={(e) => dispatch('change', { ...typography, quoteBorderColor: e.detail })}
    />
    <ColorField
      label={branding.string.Color}
      value={typography.quoteTextColor}
      on:change={(e) => dispatch('change', { ...typography, quoteTextColor: e.detail })}
    />
  </PanelSection>
  <PanelSection label={branding.string.CodeFont}>
    <div class="full">
      <SelectField
        value={typography.codeFontFamily}
        options={fontOptions(customFonts)}
        on:change={(e) => dispatch('change', { ...typography, codeFontFamily: e.detail })}
      />
    </div>
    <div class="full">
      <ColorField
        label={branding.string.CodeBackground}
        value={typography.codeBackground}
        optional
        on:change={(e) => dispatch('change', { ...typography, codeBackground: e.detail })}
      />
    </div>
  </PanelSection>
  <PanelSection label={branding.string.Color} columns={1}>
    <ColorField label={branding.string.LinkColor} value={typography.linkColor} on:change={(e) => dispatch('change', { ...typography, linkColor: e.detail })} />
    <ColorField
      label={branding.string.TableHeaderBackground}
      value={typography.tableHeaderBackground}
      optional
      on:change={(e) => dispatch('change', { ...typography, tableHeaderBackground: e.detail })}
    />
    <ColorField
      label={branding.string.TableBorderColor}
      value={typography.tableBorderColor}
      on:change={(e) => dispatch('change', { ...typography, tableBorderColor: e.detail })}
    />
  </PanelSection>
{/if}

<style lang="scss">
  .numbering {
    padding: 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .levels {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding: 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);

    button {
      min-width: 2rem;
      padding: 0.25rem 0.375rem;
      border: 1px solid var(--theme-button-border);
      border-radius: 0.25rem;
      background: var(--theme-button-default);
      color: var(--theme-content-color);
      font-weight: 600;
      font-size: 0.75rem;
      cursor: pointer;

      &.selected {
        background: var(--primary-button-default);
        border-color: var(--primary-button-default);
        color: var(--primary-button-color);
      }
    }
  }
</style>
