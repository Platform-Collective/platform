<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  export let alt: string | undefined = undefined
</script>

<span class="broken-image" role="img" aria-label={alt} title={alt}
  >⚠{#if alt}
    {alt}{/if}</span
>

<style>
  .broken-image {
    display: inline-block;
    padding: 0.125rem 0.25rem;
    border: 1px solid currentColor;
  }
</style>
