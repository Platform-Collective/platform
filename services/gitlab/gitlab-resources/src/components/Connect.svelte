<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { Integration as AccountIntegration } from '@hcengineering/account-client'
  import { Analytics } from '@hcengineering/analytics'
  import { getCurrentAccount } from '@hcengineering/core'
  import { type GitlabAuthentication, type GitlabIntegration } from '@hcengineering/gitlab'
  import { getMetadata } from '@hcengineering/platform'
  import presentation, { Card, createQuery } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import ui, { Button, Label } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'
  import { errorText } from '../errors'
  import gitlab from '../plugin'
  import {
    OAUTH_CHANNEL,
    OAuthCallbackTracker,
    isOAuthCallbackMessage,
    isOAuthErrorMessage,
    oauthResultMessage,
    type OAuthCallbackMessage
  } from '../state'
  import { onAuthorize, sendGLServiceRequest } from '../utils'
  import GitlabRepositories from './GitlabRepositories.svelte'
  import SetupApp from './SetupApp.svelte'

  // Passed by IntegrationCard (showPopup(component, { integration })); kept so Svelte does not warn about an unknown prop.
  export let integration: AccountIntegration | undefined = undefined

  const dispatch = createEventDispatcher()
  const me = getCurrentAccount()

  let auth: GitlabAuthentication | undefined
  let integrations: GitlabIntegration[] = []
  let projects: Project[] = []
  let refreshing = false
  let error: string | undefined
  // Set by SetupApp once the workspace GitLab application status has loaded.
  let appConfigured = false

  createQuery().query(gitlab.class.GitlabAuthentication, { attachedTo: me.primarySocialId }, (res) => {
    auth = res[0]
  })
  createQuery().query(gitlab.class.GitlabIntegration, {}, (res) => {
    integrations = res
  })
  createQuery().query(tracker.class.Project, { archived: false }, (res) => {
    projects = res
  })

  function reportError (err: unknown): void {
    error = errorText(err)
    Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
  }

  async function refresh (): Promise<void> {
    error = undefined
    refreshing = true
    try {
      await sendGLServiceRequest('refresh', {})
    } catch (err) {
      reportError(err)
    } finally {
      refreshing = false
    }
  }

  // The OAuth landing tab has no session; it relays the callback here and this dialog completes it.
  const callbacks = new OAuthCallbackTracker()
  let channel: BroadcastChannel | undefined
  let awaitingCallback = false

  async function completeAuth (msg: OAuthCallbackMessage): Promise<void> {
    awaitingCallback = false
    error = undefined
    try {
      await sendGLServiceRequest('auth', { code: msg.code, state: msg.state })
      channel?.postMessage(oauthResultMessage(msg.state, true))
    } catch (err) {
      channel?.postMessage(oauthResultMessage(msg.state, false, errorText(err)))
      reportError(err)
    }
  }

  function onChannelMessage (ev: MessageEvent): void {
    const msg: unknown = ev.data
    if (isOAuthCallbackMessage(msg)) {
      // Only states this dialog requested, each once.
      if (callbacks.accept(msg)) void completeAuth(msg)
    } else if (isOAuthErrorMessage(msg) && awaitingCallback) {
      awaitingCallback = false
      reportError(new Error(msg.description ?? msg.error))
    }
  }

  onMount(() => {
    if (typeof BroadcastChannel === 'undefined') return
    channel = new BroadcastChannel(OAUTH_CHANNEL)
    channel.onmessage = onChannelMessage
  })
  onDestroy(() => {
    channel?.close()
    channel = undefined
  })

  async function authorize (): Promise<void> {
    error = undefined
    try {
      callbacks.expect(await onAuthorize())
      awaitingCallback = true
    } catch (err) {
      reportError(err)
    }
  }

  $: title = getMetadata(ui.metadata.PlatformTitle)
</script>

<Card
  label={gitlab.string.GitlabDesc}
  labelProps={{ title }}
  okAction={() => {
    dispatch('close')
  }}
  canSave={true}
  okLabel={presentation.string.Ok}
  on:close={() => dispatch('close')}
  on:changeContent
>
  <div class="flex-col flex-gap-4 p-3">
    <SetupApp
      on:configured={(ev) => {
        appConfigured = ev.detail
      }}
    />
    {#if auth !== undefined && auth.login !== ''}
      <Label label={gitlab.string.Authorized} params={{ login: auth.login }} />
    {:else}
      <Label label={gitlab.string.NotAuthorized} params={{ title }} />
    {/if}
    {#if auth?.error != null}
      <span class="error-color">{auth.error}</span>
    {/if}
    {#if error !== undefined}
      <span class="error-color">{error}</span>
    {/if}
    {#if appConfigured}
      {#each integrations as gl (gl._id)}
        <div class="fs-title"><Label label={gitlab.string.Repositories} /> — {gl.host} / {gl.login}</div>
        <GitlabRepositories integration={gl} {projects} {integrations} />
      {/each}
    {/if}
  </div>
  <svelte:fragment slot="footer">
    {#if integrations.length > 0}
      <Button
        label={gitlab.string.RefreshRepositories}
        loading={refreshing}
        disabled={!appConfigured}
        on:click={refresh}
      />
    {/if}
    <Button
      label={auth !== undefined ? gitlab.string.ReAuthorize : gitlab.string.Authorize}
      labelParams={{ title }}
      kind={'primary'}
      size={'large'}
      disabled={!appConfigured}
      on:click={authorize}
    />
  </svelte:fragment>
</Card>
