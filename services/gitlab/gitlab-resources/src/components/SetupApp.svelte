<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import { Button, Label, Spinner } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'
  import { appConfigArgs, appStatusOf, setupFormOf, type AppStatus } from '../app-status'
  import { isAppInUseError, reportError } from '../errors'
  import { GITLAB_COM } from '../gitlab-host'
  import gitlab from '../plugin'
  import { confirmDangerous, sendGLServiceRequest } from '../utils'
  import ErrorText from './ErrorText.svelte'
  import SetupAppForm from './SetupAppForm.svelte'
  import SetupAppSteps from './SetupAppSteps.svelte'

  const dispatch = createEventDispatcher<{ configured: boolean }>()
  const isOwner = hasAccountRole(getCurrentAccount(), AccountRole.Owner)

  let status: AppStatus | undefined
  let loading = true
  let loadError: unknown
  let actionError: unknown
  let saving = false
  let removing = false
  // Set when save/remove was refused because members are still connected.
  let blockedByConnections = false
  let disconnectingAll = false
  let editing = false

  // Form state; unchecked "self-managed" means gitlab.com and no host is sent.
  let selfManaged = false
  let host = ''
  let clientId = ''
  let clientSecret = ''

  function reportActionError(err: unknown): void {
    blockedByConnections = isAppInUseError(err)
    actionError = err
    reportError(err)
  }

  function clearActionError(): void {
    actionError = undefined
    blockedByConnections = false
  }

  async function loadStatus(): Promise<void> {
    loadError = undefined
    try {
      status = appStatusOf(await sendGLServiceRequest('app-status', { origin: window.location.origin }))
      dispatch('configured', status.configured)
    } catch (err) {
      loadError = err
      reportError(err)
    } finally {
      loading = false
    }
  }

  function resetForm(current: AppStatus | undefined): void {
    ;({ selfManaged, host, clientId, clientSecret } = setupFormOf(current))
    clearActionError()
  }

  function startChange(): void {
    resetForm(status)
    editing = true
  }

  function cancelChange(): void {
    editing = false
    clearActionError()
  }

  async function save(): Promise<void> {
    clearActionError()
    saving = true
    try {
      await sendGLServiceRequest('app-config', appConfigArgs({ selfManaged, host, clientId, clientSecret }))
      clientSecret = ''
      editing = false
      await loadStatus()
    } catch (err) {
      reportActionError(err)
    } finally {
      saving = false
    }
  }

  async function remove(): Promise<void> {
    clearActionError()
    removing = true
    try {
      await sendGLServiceRequest('app-remove', {})
      editing = false
      await loadStatus()
      resetForm(undefined)
    } catch (err) {
      // e.g. the pod refuses with code 'app-in-use' while members are connected
      reportActionError(err)
    } finally {
      removing = false
    }
  }

  async function disconnectEveryone(): Promise<void> {
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

  function confirmDisconnectEveryone(): void {
    confirmDangerous(gitlab.string.DisconnectEveryone, gitlab.string.DisconnectEveryoneConfirm, disconnectEveryone)
  }

  function confirmRemove(): void {
    confirmDangerous(gitlab.string.Remove, gitlab.string.RemoveAppConfirm, remove)
  }

  onMount(() => {
    void loadStatus()
  })

  $: isChange = status?.configured === true
  $: showForm = isOwner && status !== undefined && (!status.configured || editing)
</script>

<div class="flex-col flex-gap-2">
  <div class="fs-title"><Label label={gitlab.string.SetupTitle} /></div>
  {#if loading}
    <Spinner size={'small'} />
  {:else if loadError !== undefined}
    <ErrorText error={loadError} />
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
          <Button label={gitlab.string.Remove} kind={'dangerous'} loading={removing} on:click={confirmRemove} />
        {/if}
      </div>
    {:else if !status.configured && !isOwner}
      <span><Label label={gitlab.string.OwnerMustConfigure} /></span>
    {/if}

    {#if showForm}
      <SetupAppSteps
        redirectUri={status.redirectUri}
        scopes={status.scopes}
        {selfManaged}
        {host}
        on:error={(ev) => {
          reportActionError(ev.detail)
        }}
      />
      <SetupAppForm
        bind:selfManaged
        bind:host
        bind:clientId
        bind:clientSecret
        {isChange}
        {editing}
        {saving}
        {removing}
        on:save={save}
        on:remove={confirmRemove}
        on:cancel={cancelChange}
      />
    {/if}

    {#if actionError !== undefined}
      <ErrorText error={actionError} />
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
