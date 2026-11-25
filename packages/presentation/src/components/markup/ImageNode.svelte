<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type Attrs, isFileId } from '@hcengineering/text'
  import type { Blob, Ref } from '@hcengineering/core'
  import { getFileUrl, getPlatformFileId } from '../../file'
  import { getSrcSet } from '../../preview'
  import BrokenImage from './BrokenImage.svelte'

  export let attrs: Attrs
  export let compact = false

  function resolveImage(attrs: Attrs, compact: boolean): { src?: string, srcset?: string } {
    const source = attrs.src != null && attrs.src !== '' ? String(attrs.src) : undefined
    const fileId = isFileId(attrs['file-id']) ? attrs['file-id'] : getPlatformFileId(source ?? '')
    if (fileId === undefined) return { src: source }

    try {
      return {
        src: getFileUrl(fileId),
        srcset: compact ? getSrcSet(fileId as Ref<Blob>, 32, 32) : undefined
      }
    } catch {
      // Viewers also run before file storage is configured (e.g. standalone HTML previews).
      return { src: source }
    }
  }

  let failed = false
  let image: ReturnType<typeof resolveImage>
  $: {
    image = resolveImage(attrs, compact)
    failed = false
  }
  $: alt = attrs.alt != null ? String(attrs.alt) : undefined
  $: width = attrs.width != null ? String(attrs.width) : undefined
  $: height = attrs.height != null ? String(attrs.height) : undefined
</script>

{#if failed}
  <BrokenImage {alt} />
{:else}
  <img src={image.src} srcset={image.srcset} {alt} {width} {height} on:error={() => (failed = true)} />
{/if}
