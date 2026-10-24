<!-- SPDX-License-Identifier: EPL-2.0 -->
<script context="module" lang="ts">
  function countH1 (pages: string[]): number {
    return pages.reduce((sum, html) => sum + (html.match(/<h1[\s>]/g)?.length ?? 0), 0)
  }
</script>

<script lang="ts">
  import {
    type FieldValues,
    type HeadingLevel,
    type RenderContext,
    type TemplateDesign,
    contentMargins,
    describePages,
    getPageDimensions,
    renderTypographyCss
  } from '@hcengineering/branding'
  import { createEventDispatcher } from 'svelte'

  import { MM_TO_PX, styleTag } from '../../editor/utils'
  import { SAMPLE_CONTENT_PAGES } from '../../sample'
  import DecorationLayer from '../preview/DecorationLayer.svelte'

  export let design: TemplateDesign
  export let zoom: number = 1
  export let resolveFile: (file: string) => string | undefined
  export let values: FieldValues = {}
  export let keepPlaceholders: boolean = false
  export let pages: string[] = SAMPLE_CONTENT_PAGES
  // Clicking a heading or paragraph selects its style for editing
  export let interactive: boolean = true
  // Numbering of the first sample page, after template pages placed before the content
  // Template pages around the content, for page numbers and page rules
  export let beforeCount: number = 0
  export let afterCount: number = 0

  const dispatch = createEventDispatcher<{ pick: HeadingLevel | 'body' }>()
  // Unique per instance, the stylesheet must not leak into the application or other previews
  const scopeClass = `branding-sample-${Math.random().toString(36).slice(2, 10)}`

  $: dims = getPageDimensions(design.page)
  $: margins = design.page.margins
  $: content = contentMargins(design)
  $: top = content.top
  $: bottom = content.bottom
  $: positions = describePages(beforeCount, pages.length, afterCount)
  $: css = renderTypographyCss(design.typography, `.${scopeClass}`)

  function pageCtx (index: number): RenderContext {
    return {
      values,
      mode: 'preview',
      keepPlaceholders,
      resolveFile
    }
  }

  // Section numbers continue across sample pages
  function contentStyle (index: number): string {
    const base = `top:${top}mm;bottom:${bottom}mm;left:${margins.left}mm;right:${margins.right}mm`
    return index > 0 && design.typography.numberHeadings
      ? `${base};counter-reset:bh1 ${countH1(pages.slice(0, index))}`
      : base
  }

  function onClick (e: MouseEvent): void {
    if (!interactive) return
    const target = (e.target as HTMLElement).closest('h1,h2,h3,h4,h5,h6')
    dispatch('pick', target !== null ? (target.tagName.toLowerCase() as HeadingLevel) : 'body')
  }
</script>

<svelte:head>
  {@html styleTag(css)}
</svelte:head>

{#each pages as html, index}
  {@const ctx = pageCtx(index)}
  <div class="canvas" style:width={`${dims.width * MM_TO_PX * zoom}px`} style:height={`${dims.height * MM_TO_PX * zoom}px`}>
    <div class="page" style={`width:${dims.width}mm;height:${dims.height}mm;transform:scale(${zoom})`}>
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <div class="content {scopeClass}" class:interactive style={contentStyle(index)} on:click={onClick}>
        {@html html}
      </div>
      <DecorationLayer {design} {ctx} pos={positions[beforeCount + index]} />
      <slot name="overlay" {index} />
    </div>
  </div>
{/each}

<style lang="scss">
  .canvas {
    position: relative;
    flex-shrink: 0;
    box-shadow: 0 0.25rem 1.25rem rgba(0, 0, 0, 0.18);
  }
  .page {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    background: #fff;
    overflow: hidden;
    color: #000;
  }
  .content {
    position: absolute;
    overflow: hidden;

    &.interactive {
      cursor: pointer;

      :global(:is(h1, h2, h3, h4, h5, h6):hover) {
        outline: 1px dashed #3b82f6;
      }
    }
  }
</style>
