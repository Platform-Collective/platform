<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { Blob, Ref } from '@hcengineering/core'
  import { getBlobRef } from '../../preview'
  import BrokenImage from './BrokenImage.svelte'

  export let file: Ref<Blob>
  export let alt: string | undefined = undefined
  export let width: string | undefined = undefined
  export let height: string | undefined = undefined

  let failed = false
  let image: ReturnType<typeof getBlobRef>
  $: {
    image = getBlobRef(file)
    failed = false
  }
</script>

{#await image then blobSrc}
  {#if failed}
    <BrokenImage {alt} />
  {:else}
    <img src={blobSrc.src} srcset={blobSrc.srcset} {alt} {width} {height} on:error={() => (failed = true)} />
  {/if}
{:catch}
  <BrokenImage {alt} />
{/await}
