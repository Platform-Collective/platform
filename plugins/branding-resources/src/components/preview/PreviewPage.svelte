<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import {
    type PagePosition,
    type RenderContext,
    type TemplateDesign,
    type TemplatePage,
    type TextElement,
    backgroundCss,
    elementBoxCss,
    getPageDimensions,
    renderElementHtml,
    resolveElementText,
    textContainerCss,
    textInnerCss
  } from '@hcengineering/branding'
  import { createEventDispatcher } from 'svelte'

  import { MM_TO_PX } from '../../editor/utils'
  import DecorationLayer from './DecorationLayer.svelte'

  export let design: TemplateDesign
  export let page: TemplatePage
  export let ctx: RenderContext
  export let zoom: number = 1
  // Position in the printed document, for headers, footers and overlays shown on template pages
  export let pos: PagePosition | undefined = undefined

  const dispatch = createEventDispatcher<{ edit: { id: string, text: string } }>()

  $: dims = getPageDimensions(design.page)

  function isEditable (el: TemplatePage['elements'][number]): el is TextElement {
    return el.kind === 'text' && el.editable && el.hidden !== true
  }

  // Text is not bound reactively while focused, so typing does not reset the caret position
  function editableText (node: HTMLElement, text: string): { update: (text: string) => void } {
    node.innerText = text
    return {
      update: (next: string) => {
        if (document.activeElement !== node && node.innerText !== next) {
          node.innerText = next
        }
      }
    }
  }
</script>

<div class="canvas" style:width={`${dims.width * MM_TO_PX * zoom}px`} style:height={`${dims.height * MM_TO_PX * zoom}px`}>
  <div
    class="page"
    style={`width:${dims.width}mm;height:${dims.height}mm;transform:scale(${zoom});${backgroundCss(page.background, ctx.resolveFile)}`}
  >
    {#each page.elements as el (el.id)}
      {#if isEditable(el)}
        <div style={elementBoxCss(el)}>
          <div style={textContainerCss(el)}>
            <div
              class="editable"
              style={textInnerCss(el)}
              contenteditable="true"
              spellcheck="true"
              use:editableText={resolveElementText(el, ctx)}
              on:input={(e) => {
                dispatch('edit', { id: el.id, text: e.currentTarget.innerText })
              }}
            />
          </div>
        </div>
      {:else}
        {@html renderElementHtml(el, ctx)}
      {/if}
    {/each}
    {#if pos !== undefined}
      <DecorationLayer {design} {ctx} {pos} />
    {/if}
  </div>
</div>

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
    overflow: hidden;
    color: #000;
  }
  .editable {
    outline: 1px dashed rgba(59, 130, 246, 0.5);
    outline-offset: 1px;
    cursor: text;

    &:hover {
      outline-color: #3b82f6;
    }
    &:focus {
      outline: 1.5px solid #3b82f6;
      background: rgba(59, 130, 246, 0.05);
    }
  }
</style>
