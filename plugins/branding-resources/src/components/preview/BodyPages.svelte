<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import {
    DOC_TITLE_CLASS,
    type RenderContext,
    type TemplateDesign,
    contentMargins,
    describePages,
    escapeHtml,
    getPageDimensions,
    renderTypographyCss
  } from '@hcengineering/branding'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy, tick } from 'svelte'

  import { MM_TO_PX, styleTag } from '../../editor/utils'
  import branding from '../../plugin'
  import DecorationLayer from './DecorationLayer.svelte'

  export let design: TemplateDesign
  export let blocks: string[]
  // Indices of blocks that start a new page
  export let breaks: Set<number>
  export let title: string = ''
  export let zoom: number = 1
  export let ctx: RenderContext
  // Template pages around the content, for page numbers and page rules
  export let beforeCount: number = 0
  export let afterCount: number = 0

  const dispatch = createEventDispatcher<{ layout: { pages: number }, toggleBreak: { index: number } }>()
  // Unique per instance, the stylesheet must not leak into the application
  const scopeClass = `branding-body-${Math.random().toString(36).slice(2, 10)}`

  interface PageLayout {
    indices: number[]
    // Section counters at the start of the page, numbering continues across pages
    counters: [number, number, number]
  }

  let measure: HTMLDivElement | undefined
  let pages: PageLayout[] = [{ indices: [], counters: [0, 0, 0] }]
  let layoutRequest = 0

  $: dims = getPageDimensions(design.page)
  $: margins = design.page.margins
  $: content = contentMargins(design)
  $: top = content.top
  $: bottom = content.bottom
  $: positions = describePages(beforeCount, pages.length, afterCount)
  $: contentWidth = dims.width - margins.left - margins.right
  $: contentHeight = dims.height - top - bottom
  $: css = renderTypographyCss(design.typography, `.${scopeClass}`)
  $: titleHtml = title !== '' ? `<div class="${DOC_TITLE_CLASS}">${escapeHtml(title)}</div>` : ''

  $: void relayout(blocks, breaks, css, contentHeight, contentWidth, titleHtml)

  function headingLevel (html: string): number | undefined {
    const match = /^\s*<h([1-6])[\s>]/i.exec(html)
    return match !== null ? parseInt(match[1], 10) : undefined
  }

  function countersAfter (counters: [number, number, number], html: string): [number, number, number] {
    const level = headingLevel(html)
    const [c1, c2, c3] = counters
    if (level === 1) return [c1 + 1, 0, 0]
    if (level === 2) return [c1, c2 + 1, 0]
    if (level === 3) return [c1, c2, c3 + 1]
    return counters
  }

  /**
   * Distribute blocks over pages the way the PDF renderer does: forced breaks, then whole blocks while they fit,
   * keeping a heading together with the block that follows it.
   */
  async function relayout (..._deps: unknown[]): Promise<void> {
    const request = ++layoutRequest
    await tick()
    if (measure === undefined || request !== layoutRequest) return
    const available = contentHeight * MM_TO_PX
    const wrappers = Array.from(measure.querySelectorAll<HTMLElement>(':scope > .block'))
    const titleEl = measure.querySelector<HTMLElement>(`:scope > .${DOC_TITLE_CLASS}`)
    const end = measure.scrollHeight
    const heights = wrappers.map((el, i) => (wrappers[i + 1]?.offsetTop ?? end) - el.offsetTop)
    const cssBreak = wrappers.map((el) => {
      const child = el.firstElementChild
      return child !== null && ['page', 'always'].includes(getComputedStyle(child).breakBefore)
    })

    const layout: number[][] = []
    let current: number[] = []
    let used = titleEl !== null ? (wrappers[0]?.offsetTop ?? end) - titleEl.offsetTop : 0
    const newPage = (carry: number[] = []): void => {
      layout.push(current)
      current = carry
      used = carry.reduce((sum, i) => sum + heights[i], 0)
    }
    heights.forEach((height, index) => {
      const forced = breaks.has(index) || cssBreak[index]
      if (forced && (current.length > 0 || used > 0)) {
        newPage()
      } else if (used + height > available && current.length > 0) {
        // Do not leave a heading alone at the bottom of a page
        const last = current[current.length - 1]
        if (current.length > 1 && headingLevel(blocks[last]) !== undefined && !breaks.has(last)) {
          current.pop()
          newPage([last])
        } else {
          newPage()
        }
      }
      current.push(index)
      used += height
    })
    layout.push(current)

    let counters: [number, number, number] = [0, 0, 0]
    pages = layout.map((indices) => {
      const page: PageLayout = { indices, counters }
      counters = indices.reduce((c, i) => countersAfter(c, blocks[i]), counters)
      return page
    })
    dispatch('layout', { pages: pages.length })
  }

  function onAssetLoaded (): void {
    void relayout()
  }

  // Fonts and images change block heights once loaded
  void document.fonts?.ready.then(onAssetLoaded)
  onDestroy(() => {
    layoutRequest++
  })


  function contentStyle (page: PageLayout): string {
    const [c1, c2, c3] = page.counters
    const base = `top:${top}mm;bottom:${bottom}mm;left:${margins.left}mm;right:${margins.right}mm`
    return design.typography.numberHeadings ? `${base};counter-reset:bh1 ${c1} bh2 ${c2} bh3 ${c3}` : base
  }
</script>

<svelte:head>
  {@html styleTag(css)}
</svelte:head>

<!-- Off-screen copy at the real content width, used to measure block heights -->
<div class="measure {scopeClass}" bind:this={measure} style:width={`${contentWidth}mm`} aria-hidden="true">
  {@html titleHtml}
  {#each blocks as block, index (index)}
    <!-- svelte-ignore a11y-missing-attribute -->
    <div class="block" on:load|capture={onAssetLoaded}>{@html block}</div>
  {/each}
</div>

{#each pages as page, pageIndex}
  <div class="canvas" style:width={`${dims.width * MM_TO_PX * zoom}px`} style:height={`${dims.height * MM_TO_PX * zoom}px`}>
    <div class="page" style={`width:${dims.width}mm;height:${dims.height}mm;transform:scale(${zoom})`}>
      <div class="content {scopeClass}" style={contentStyle(page)}>
        {#if pageIndex === 0}{@html titleHtml}{/if}
        {#each page.indices as index, position (index)}
          <div class="block">
            {#if breaks.has(index)}
              <div class="break-marker">
                <span><Label label={branding.string.PageBreak} /></span>
                <button type="button" on:click={() => dispatch('toggleBreak', { index })}>
                  <Label label={branding.string.RemovePageBreak} />
                </button>
              </div>
            {:else if index > 0 && !(pageIndex > 0 && position === 0)}
              <button type="button" class="insert-break" on:click={() => dispatch('toggleBreak', { index })}>
                <span>✂</span><Label label={branding.string.InsertPageBreak} />
              </button>
            {/if}
            {@html blocks[index]}
          </div>
        {/each}
      </div>
      <DecorationLayer {design} {ctx} pos={positions[beforeCount + pageIndex]} />
    </div>
  </div>
{/each}

<style lang="scss">
  .measure {
    position: absolute;
    left: -100000px;
    top: 0;
    visibility: hidden;
    pointer-events: none;
  }
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
  }
  .block {
    position: relative;

    &:hover > .insert-break {
      opacity: 1;
    }
  }
  .insert-break {
    position: absolute;
    top: -2.5mm;
    left: 50%;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 1mm;
    transform: translateX(-50%);
    padding: 0.6mm 2mm;
    border: 0.3mm dashed #3b82f6;
    border-radius: 2mm;
    background: #eff6ff;
    color: #1d4ed8;
    font: 500 2.8mm sans-serif;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .break-marker {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2mm;
    padding: 1mm 2mm;
    border-top: 0.4mm dashed #ec4899;
    background: #fdf2f8;
    color: #be185d;
    font: 500 2.8mm sans-serif;

    button {
      border: none;
      background: none;
      color: #be185d;
      font: 600 2.8mm sans-serif;
      text-decoration: underline;
      cursor: pointer;
    }
  }
</style>
