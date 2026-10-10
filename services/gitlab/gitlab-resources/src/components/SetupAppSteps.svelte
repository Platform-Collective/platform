<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { getMetadata } from '@hcengineering/platform'
  import { copyTextToClipboard } from '@hcengineering/presentation'
  import ui, { Button, Label } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy } from 'svelte'
  import gitlab from '../plugin'
  import { GITLAB_COM, applicationLinks, isValidHostInput } from '../gitlab-host'

  export let redirectUri: string
  // Space-separated, as the pod sends it (e.g. 'api read_user')
  export let scopes: string
  export let selfManaged: boolean
  export let host: string

  const dispatch = createEventDispatcher<{ error: unknown }>()
  const title = getMetadata(ui.metadata.PlatformTitle) ?? ''
  const COPIED_FEEDBACK_MS = 2000
  let copied = false
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  // No links for a self-managed instance until its URL is valid (gitlab.com links would mislead).
  $: showLinks = !selfManaged || isValidHostInput(host)
  $: links = applicationLinks(selfManaged ? host : GITLAB_COM)

  async function copyRedirect (): Promise<void> {
    try {
      await copyTextToClipboard(redirectUri)
      copied = true
      if (copiedTimer !== undefined) clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => {
        copied = false
      }, COPIED_FEEDBACK_MS)
    } catch (err) {
      dispatch('error', err)
    }
  }

  onDestroy(() => {
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
  })
</script>

<ol class="setup-steps">
  <li>
    <Label label={gitlab.string.SetupWhere} />
    {#if showLinks}
      <ul>
        <li>
          <a href={links.user} target="_blank" rel="noopener noreferrer"
            ><Label label={gitlab.string.SetupUserOwned} /></a
          >
        </li>
        <li>
          <Label label={gitlab.string.SetupGroupOwned} />
          <code class="setup-url">{links.groupHint}</code>
        </li>
        {#if selfManaged}
          <li>
            <a href={links.admin} target="_blank" rel="noopener noreferrer"
              ><Label label={gitlab.string.SetupInstanceWide} /></a
            >
            <span class="content-dark-color"><Label label={gitlab.string.SetupTrustedHint} /></span>
          </li>
        {/if}
      </ul>
    {:else}
      <div class="content-dark-color"><Label label={gitlab.string.SetupEnterUrlFirst} /></div>
    {/if}
  </li>
  <li>
    <div class="flex-row-center flex-gap-2">
      <Label label={gitlab.string.SetupNameAndRedirect} params={{ title }} />
      <code class="setup-url">{redirectUri}</code>
      <Button
        label={copied ? gitlab.string.Copied : gitlab.string.Copy}
        size={'small'}
        disabled={redirectUri === ''}
        on:click={copyRedirect}
      />
    </div>
  </li>
  <li><Label label={gitlab.string.SetupConfidentialScopes} params={{ scopes }} /></li>
  <li><Label label={gitlab.string.SetupCopyCredentials} /></li>
</ol>

<style lang="scss">
  .setup-steps {
    margin: 0;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    ul {
      margin: 0.25rem 0 0;
      padding-left: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
  }
  .setup-url {
    user-select: all;
    word-break: break-all;
  }
</style>
