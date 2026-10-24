<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import {
    type RenderContext,
    type TemplateDesign,
    backgroundCss,
    contentMargins,
    cssColor,
    describePages,
    getPageDimensions,
    normalizeDesign,
    renderElementHtml
  } from '@hcengineering/branding'
  import { getFileUrl } from '@hcengineering/presentation'

  import { MM_TO_PX } from '../editor/utils'
  import DecorationLayer from './preview/DecorationLayer.svelte'

  export let design: TemplateDesign
  export let width: number = 160
  export let values: Record<string, string> = {}

  $: normalized = normalizeDesign(design)
  // The cover when there is one, otherwise the first content page with header, footer and overlay
  $: page = normalized.pages.find((p) => p.enabled)
  $: dims = getPageDimensions(normalized.page)
  $: zoom = width / (dims.width * MM_TO_PX)
  $: margins = contentMargins(normalized)
  $: headingColor = cssColor(normalized.typography.headings.h1.color, '#98a2b3')
  $: firstContentPage = describePages(0, 1, 0)[0]
  $: ctx = {
    values,
    mode: 'preview',
    keepPlaceholders: Object.keys(values).length === 0,
    resolveFile: (file: string) => getFileUrl(file)
  } satisfies RenderContext

  // Stand-in text: a heading followed by paragraphs of varying line lengths
  const LINES = [62, 0, 96, 92, 98, 70, 0, 95, 97, 88, 94, 60, 0, 40, 93, 97, 91, 76, 0, 96, 89, 94, 65]
</script>

<div class="thumb" style:width={`${width}px`} style:height={`${dims.height * MM_TO_PX * zoom}px`}>
  {#if page !== undefined}
    <div
      class="page"
      style={`width:${dims.width}mm;height:${dims.height}mm;transform:scale(${zoom});${backgroundCss(page.background, ctx.resolveFile)}`}
    >
      {#each page.elements as el (el.id)}{@html renderElementHtml(el, ctx)}{/each}
    </div>
  {:else}
    <div class="page" style={`width:${dims.width}mm;height:${dims.height}mm;transform:scale(${zoom});background:#fff`}>
      <div
        class="content"
        style={`top:${margins.top}mm;bottom:${margins.bottom}mm;left:${margins.left}mm;right:${margins.right}mm`}
      >
        <div class="title" style:background={headingColor} />
        {#each LINES as length, i}
          {#if length === 0}
            <div class="gap" />
          {:else if i > 0 && LINES[i - 1] === 0 && length < 70}
            <div class="heading" style:width={`${length}%`} style:background={headingColor} />
          {:else}
            <div class="line" style:width={`${length}%`} />
          {/if}
        {/each}
      </div>
      <DecorationLayer design={normalized} {ctx} pos={firstContentPage} />
    </div>
  {/if}
</div>

<style lang="scss">
  .thumb {
    position: relative;
    overflow: hidden;
    background: #fff;
    border-radius: 0.25rem;
    box-shadow: 0 0.125rem 0.5rem rgba(0, 0, 0, 0.15);
    flex-shrink: 0;
  }
  .page {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    pointer-events: none;
    color: #000;
  }
  .content {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 2.4mm;
    padding-top: 4mm;
    overflow: hidden;
  }
  .title {
    width: 70%;
    height: 7mm;
    margin-bottom: 4mm;
    border-radius: 1mm;
    opacity: 0.85;
  }
  .heading {
    height: 4.5mm;
    border-radius: 1mm;
    opacity: 0.7;
  }
  .line {
    height: 2mm;
    border-radius: 1mm;
    background: #e4e7ec;
  }
  .gap {
    height: 2mm;
  }
</style>
