<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Button, IconArrowLeft, IconArrowRight, IconClose, Label, Loading } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy } from 'svelte'
  import { stepIndex } from '../image-gallery'
  import { imageNameOf, loadGitlabImage, type GitlabImageResult } from '../image-link'
  import gitlab from '../plugin'
  import { safeHttpUrl } from '../safe-url'
  import { gitlabImageRequest } from '../utils'

  // Absolute GitLab upload URLs, as the pod records them
  export let images: string[]
  export let index = 0

  const dispatch = createEventDispatcher()
  let result: GitlabImageResult | undefined
  let objectUrl: string | undefined
  let destroyed = false
  // Only the answer for the image on screen is shown; a slower earlier answer is dropped
  let requested = 0

  $: href = images[index] ?? ''
  $: name = imageNameOf(href)
  $: void load(href)

  function release (): void {
    if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    objectUrl = undefined
  }

  async function load (target: string): Promise<void> {
    const request = ++requested
    release()
    result = undefined
    const loaded = await loadGitlabImage(target, gitlabImageRequest())
    // The popup may close, or move on, before the image arrives; then there is nothing to show or to revoke later
    if (destroyed || request !== requested) return
    result = loaded
    if (loaded.kind === 'image') objectUrl = URL.createObjectURL(loaded.blob)
  }

  function step (delta: number): void {
    index = stepIndex(index, delta, images.length)
  }

  function onKeydown (event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') step(-1)
    else if (event.key === 'ArrowRight') step(1)
  }

  onDestroy(() => {
    destroyed = true
    release()
  })
</script>

<svelte:window on:keydown={onKeydown} />

<div class="antiPopup gitlab-image-popup">
  <div class="header">
    <span class="overflow-label fs-title">{name}</span>
    <div class="flex-row-center flex-gap-1">
      {#if images.length > 1}
        <Button
          icon={IconArrowLeft}
          kind="ghost"
          size="small"
          disabled={index === 0}
          on:click={() => {
            step(-1)
          }}
        />
        <span class="content-dark-color">{index + 1} / {images.length}</span>
        <Button
          icon={IconArrowRight}
          kind="ghost"
          size="small"
          disabled={index === images.length - 1}
          on:click={() => {
            step(1)
          }}
        />
      {/if}
      <Button icon={IconClose} kind="ghost" size="small" on:click={() => dispatch('close')} />
    </div>
  </div>
  <div class="body">
    {#if result === undefined}
      <Loading />
    {:else if result.kind === 'image' && objectUrl !== undefined}
      <img src={objectUrl} alt={name} />
    {:else}
      <div class="placeholder">
        <Label
          label={result.kind === 'not-connected'
            ? gitlab.string.ImageNotConnected
            : result.kind === 'no-access'
              ? gitlab.string.ImageNoAccess
              : gitlab.string.ImageUnavailable}
        />
      </div>
    {/if}
  </div>
  <div class="footer">
    <a href={safeHttpUrl(href)} target="_blank" rel="noopener noreferrer"
      ><Label label={gitlab.string.OpenInGitlab} /></a
    >
  </div>
</div>

<style lang="scss">
  // The shared .antiPopup:not(.embedded) caps popups at 30rem; an image viewer may use most of the window
  .antiPopup.gitlab-image-popup {
    max-width: 90vw;
    max-height: 90vh;
  }
  .header,
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
  }
  .body {
    display: flex;
    align-items: center;
    // 'safe' keeps an oversized child aligned to the start instead of clipping both sides
    justify-content: safe center;
    min-width: 20rem;
    min-height: 10rem;
    padding: 0 0.75rem;
    overflow: auto;
  }
  img {
    display: block;
    // Scaled down to the popup, never cropped
    max-width: 100%;
    max-height: calc(90vh - 7rem);
    width: auto;
    height: auto;
    object-fit: contain;
  }
  .placeholder {
    max-width: 24rem;
    padding: 2rem 1rem;
    text-align: center;
    color: var(--theme-dark-color);
  }
</style>
