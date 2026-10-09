<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { getCurrentAccount, type Account } from '@hcengineering/core'
  import { getMetadata } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import { Button, IconClose, Label, Loading } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy } from 'svelte'
  import { imageNameOf, loadGitlabImage, type GitlabImageResult } from '../image-link'
  import gitlab from '../plugin'

  export let href: string

  const dispatch = createEventDispatcher()
  const name = imageNameOf(href)
  let result: GitlabImageResult | undefined
  let objectUrl: string | undefined
  let destroyed = false

  void loadGitlabImage(href, {
    base: getMetadata(gitlab.metadata.GitlabURL) ?? '',
    token: getMetadata(presentation.metadata.Token),
    accountId: (getCurrentAccount() as Account | undefined)?.primarySocialId,
    fetch: async (...args) => await fetch(...args)
  }).then((loaded) => {
    // The popup may close before the image arrives; then there is nothing to show or to revoke later
    if (destroyed) return
    result = loaded
    if (loaded.kind === 'image') objectUrl = URL.createObjectURL(loaded.blob)
  })

  onDestroy(() => {
    destroyed = true
    if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
  })
</script>

<div class="antiPopup gitlab-image-popup">
  <div class="header">
    <span class="overflow-label fs-title">{name}</span>
    <Button icon={IconClose} kind="ghost" size="small" on:click={() => dispatch('close')} />
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
    <a {href} target="_blank" rel="noopener noreferrer"><Label label={gitlab.string.OpenInGitlab} /></a>
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
