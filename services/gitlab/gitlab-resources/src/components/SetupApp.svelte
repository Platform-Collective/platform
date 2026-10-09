<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import { getEmbeddedLabel, getMetadata } from '@hcengineering/platform'
  import presentation, { MessageBox, copyTextToClipboard } from '@hcengineering/presentation'
  import ui, { Button, CheckBox, EditBox, Label, Spinner, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'
  import { errorText, isAppInUseError } from '../errors'
  import gitlab from '../plugin'
  import { GITLAB_COM, applicationLinks, isValidHostInput } from '../state'
  import { sendGLServiceRequest } from '../utils'

  interface AppStatus {
    configured: boolean
    host?: string
    clientId?: string
    redirectUri: string
    // Space-separated, as the pod sends it (e.g. 'api read_user')
    scopes: string
  }

  const dispatch = createEventDispatcher<{ configured: boolean }>()
  const isOwner = hasAccountRole(getCurrentAccount(), AccountRole.Owner)
  const title = getMetadata(ui.metadata.PlatformTitle) ?? ''

  let status: AppStatus | undefined
  let loading = true
  let loadError: string | undefined
  let actionError: string | undefined
  let saving = false
  let removing = false
  // Set when save/remove was refused because members are still connected.
  let blockedByConnections = false
  let disconnectingAll = false
  let editing = false
  let copied = false
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  // Form state; unchecked "self-managed" means gitlab.com and no host is sent.
  let selfManaged = false
  let host = ''
  let clientId = ''
  let clientSecret = ''

  function reportError (err: unknown): string {
    Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    return errorText(err)
  }

  function reportActionError (err: unknown): void {
    blockedByConnections = isAppInUseError(err)
    actionError = reportError(err)
  }

  function clearActionError (): void {
    actionError = undefined
    blockedByConnections = false
  }

  function toStatus (body: Record<string, unknown>): AppStatus {
    return {
      configured: body.configured === true,
      host: typeof body.host === 'string' ? body.host : undefined,
      clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
      redirectUri: typeof body.redirectUri === 'string' ? body.redirectUri : '',
      scopes: typeof body.scopes === 'string' ? body.scopes : ''
    }
  }

  async function loadStatus (): Promise<void> {
    loadError = undefined
    try {
      status = toStatus(await sendGLServiceRequest('app-status', { origin: window.location.origin }))
      dispatch('configured', status.configured)
    } catch (err) {
      loadError = reportError(err)
    } finally {
      loading = false
    }
  }

  function resetForm (current: AppStatus | undefined): void {
    const currentHost = current?.host ?? ''
    selfManaged = currentHost !== '' && currentHost !== GITLAB_COM
    host = selfManaged ? currentHost : ''
    clientId = current?.clientId ?? ''
    clientSecret = ''
    clearActionError()
  }

  function startChange (): void {
    resetForm(status)
    editing = true
  }

  function cancelChange (): void {
    editing = false
    clearActionError()
  }

  async function save (): Promise<void> {
    clearActionError()
    saving = true
    try {
      const args: Record<string, unknown> = { clientId: clientId.trim() }
      if (selfManaged) args.host = host.trim()
      if (clientSecret.trim() !== '') args.clientSecret = clientSecret.trim()
      await sendGLServiceRequest('app-config', args)
      clientSecret = ''
      editing = false
      await loadStatus()
    } catch (err) {
      reportActionError(err)
    } finally {
      saving = false
    }
  }

  async function remove (): Promise<void> {
    clearActionError()
    removing = true
    try {
      await sendGLServiceRequest('app-remove', {})
      editing = false
      await loadStatus()
      resetForm(undefined)
    } catch (err) {
      // e.g. the pod refuses with "Disconnect GitLab before changing the application (connected: …)"
      reportActionError(err)
    } finally {
      removing = false
    }
  }

  async function disconnectEveryone (): Promise<void> {
    clearActionError()
    disconnectingAll = true
    try {
      // Nothing is retried automatically: the owner clicks Save or Remove again.
      await sendGLServiceRequest('disconnect-all', {})
    } catch (err) {
      reportActionError(err)
    } finally {
      disconnectingAll = false
    }
  }

  function confirmDisconnectEveryone (): void {
    showPopup(
      MessageBox,
      {
        label: gitlab.string.DisconnectEveryone,
        message: gitlab.string.DisconnectEveryoneConfirm,
        okLabel: gitlab.string.DisconnectEveryone,
        dangerous: true
      },
      undefined,
      (confirmed) => {
        if (confirmed === true) void disconnectEveryone()
      }
    )
  }

  async function copyRedirect (): Promise<void> {
    if (status === undefined) return
    try {
      await copyTextToClipboard(status.redirectUri)
      copied = true
      if (copiedTimer !== undefined) clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => {
        copied = false
      }, 2000)
    } catch (err) {
      reportActionError(err)
    }
  }

  onMount(() => {
    void loadStatus()
  })
  onDestroy(() => {
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
  })

  $: hostValid = !selfManaged || isValidHostInput(host)
  $: showHostError = selfManaged && host.trim() !== '' && !hostValid
  // No links for a self-managed instance until its URL is valid (gitlab.com links would mislead).
  $: showLinks = !selfManaged || isValidHostInput(host)
  $: links = applicationLinks(selfManaged ? host : GITLAB_COM)
  $: isChange = status?.configured === true
  // A new app needs a secret; a change may keep the stored one.
  $: canSave = clientId.trim() !== '' && hostValid && (isChange || clientSecret.trim() !== '') && !saving
  $: showForm = isOwner && status !== undefined && (!status.configured || editing)
</script>

<div class="flex-col flex-gap-2">
  <div class="fs-title"><Label label={gitlab.string.SetupTitle} /></div>
  {#if loading}
    <Spinner size={'small'} />
  {:else if loadError !== undefined}
    <span class="error-color">{loadError}</span>
  {:else if status !== undefined}
    {#if status.configured && !editing}
      <div class="flex-row-center flex-gap-2">
        <span class="flex-grow">
          <Label
            label={gitlab.string.ConfiguredApp}
            params={{ clientId: status.clientId ?? '', host: status.host ?? GITLAB_COM }}
          />
        </span>
        {#if isOwner}
          <Button label={gitlab.string.Change} on:click={startChange} />
          <Button label={gitlab.string.Remove} kind={'dangerous'} loading={removing} on:click={remove} />
        {/if}
      </div>
    {:else if !status.configured && !isOwner}
      <span><Label label={gitlab.string.OwnerMustConfigure} /></span>
    {/if}

    {#if showForm}
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
            <code class="setup-url">{status.redirectUri}</code>
            <Button
              label={copied ? gitlab.string.Copied : gitlab.string.Copy}
              size={'small'}
              disabled={status.redirectUri === ''}
              on:click={copyRedirect}
            />
          </div>
        </li>
        <li><Label label={gitlab.string.SetupConfidentialScopes} params={{ scopes: status.scopes }} /></li>
        <li><Label label={gitlab.string.SetupCopyCredentials} /></li>
      </ol>

      <div class="flex-col flex-gap-2">
        <div class="flex-row-center flex-gap-2">
          <CheckBox bind:checked={selfManaged} />
          <Label label={gitlab.string.SelfManaged} />
        </div>
        {#if selfManaged}
          <EditBox
            label={gitlab.string.GitlabUrl}
            placeholder={getEmbeddedLabel('https://gitlab.example.com')}
            kind={'default'}
            bind:value={host}
          />
          {#if showHostError}
            <span class="error-color"><Label label={gitlab.string.InvalidGitlabUrl} /></span>
          {/if}
        {/if}
        <EditBox
          label={gitlab.string.ApplicationId}
          placeholder={gitlab.string.ApplicationId}
          kind={'default'}
          bind:value={clientId}
        />
        <EditBox
          label={gitlab.string.ApplicationSecret}
          placeholder={isChange ? gitlab.string.KeepSecretHint : gitlab.string.ApplicationSecret}
          format={'password'}
          kind={'default'}
          bind:value={clientSecret}
        />
        {#if isChange}
          <span class="content-dark-color"><Label label={gitlab.string.KeepSecretHint} /></span>
        {/if}
        <div class="flex-row-center flex-gap-2">
          <Button label={gitlab.string.Save} kind={'primary'} disabled={!canSave} loading={saving} on:click={save} />
          {#if editing}
            <Button label={gitlab.string.Remove} kind={'dangerous'} loading={removing} on:click={remove} />
            <Button label={presentation.string.Cancel} kind={'ghost'} on:click={cancelChange} />
          {/if}
        </div>
      </div>
    {/if}

    {#if actionError !== undefined}
      <span class="error-color">{actionError}</span>
      {#if blockedByConnections && isOwner}
        <div class="flex-row-center">
          <Button
            label={gitlab.string.DisconnectEveryone}
            kind={'dangerous'}
            loading={disconnectingAll}
            on:click={confirmDisconnectEveryone}
          />
        </div>
      {/if}
    {/if}
  {/if}
</div>

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
