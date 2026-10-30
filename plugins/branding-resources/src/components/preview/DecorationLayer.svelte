<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import {
    type PagePosition,
    type RenderContext,
    type TemplateDesign,
    buildDecorationLayers,
    renderLayersForPage
  } from '@hcengineering/branding'

  export let design: TemplateDesign
  export let ctx: RenderContext
  export let pos: PagePosition

  // Same layers and page rules as the print service, so the preview shows what is printed
  $: layers = buildDecorationLayers(design, { ...ctx, mode: 'print' })
  $: html = renderLayersForPage(layers, pos, design.numbering)
</script>

{#if html !== ''}
  <div class="decorations">{@html html}</div>
{/if}

<style lang="scss">
  .decorations {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }
</style>
