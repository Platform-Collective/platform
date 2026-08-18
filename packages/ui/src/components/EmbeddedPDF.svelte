<!--
// Copyright © 2025 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->

<script lang="ts">
  import { onDestroy } from 'svelte'
  import { fetchAsObjectUrl } from '../file-embed-utils'
  import Loading from './Loading.svelte'

  export let src: string
  export let name: string
  export let fit: boolean = false
  export let css: string | undefined = undefined
  export let token: string | undefined = undefined

  let iframe: HTMLIFrameElement | undefined = undefined
  let iframeSrc: string | undefined
  let owned = false
  let failed = false
  let controller: AbortController | undefined

  function revokeOwned (): void {
    if (owned && iframeSrc !== undefined) {
      URL.revokeObjectURL(iframeSrc)
    }
    iframeSrc = undefined
    owned = false
  }

  async function loadFile (src: string, token?: string): Promise<void> {
    controller?.abort()
    controller = new AbortController()
    const { signal } = controller

    failed = false
    revokeOwned()

    try {
      const result = await fetchAsObjectUrl(src, token, signal)
      if (signal.aborted) {
        if (result.owned) {
          URL.revokeObjectURL(result.url)
        }
        return
      }
      iframeSrc = result.url
      owned = result.owned
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return
      }
      failed = true
      console.error('Failed to load embedded file', err)
    }
  }

  $: void loadFile(src, token)

  onDestroy(() => {
    controller?.abort()
    revokeOwned()
  })

  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
  $: if (css !== undefined && iframe !== undefined && iframe !== null) {
    iframe.onload = () => {
      const head = iframe?.contentDocument?.querySelector('head')

      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
      if (css !== undefined && head !== undefined && head !== null) {
        head.appendChild(document.createElement('style')).textContent = css
      }
    }

    if (iframe.contentDocument !== undefined) {
      const style = iframe.contentDocument?.querySelector('head style')

      if (style != null) {
        style.textContent = css
      }
    }
  }
</script>

{#if iframeSrc}
  <iframe bind:this={iframe} class:fit src={iframeSrc + '#view=FitH&navpanes=0'} title={name} on:load />
{:else if !failed}
  <Loading />
{/if}

<style lang="scss">
  iframe {
    width: 100%;
    border: none;

    &.fit {
      min-height: 100%;
    }
    &:not(.fit) {
      height: 80vh;
      min-height: 20rem;
    }
  }
</style>
