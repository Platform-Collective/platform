<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import { Button, CheckBox, EditBox, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import gitlab from '../plugin'
  import { isValidHostInput } from '../gitlab-host'

  // Unchecked "self-managed" means gitlab.com and no host is sent.
  export let selfManaged: boolean
  export let host: string
  export let clientId: string
  export let clientSecret: string
  // A configured application is being changed: the stored secret may be kept
  export let isChange: boolean
  export let editing: boolean
  export let saving: boolean
  export let removing: boolean

  const dispatch = createEventDispatcher<{ save: undefined, remove: undefined, cancel: undefined }>()

  $: hostValid = !selfManaged || isValidHostInput(host)
  $: showHostError = selfManaged && host.trim() !== '' && !hostValid
  // A new app needs a secret; a change may keep the stored one.
  $: canSave = clientId.trim() !== '' && hostValid && (isChange || clientSecret.trim() !== '') && !saving
</script>

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
    placeholder={gitlab.string.ApplicationSecret}
    format={'password'}
    kind={'default'}
    bind:value={clientSecret}
  />
  {#if isChange}
    <span class="content-dark-color"><Label label={gitlab.string.KeepSecretHint} /></span>
  {/if}
  <div class="flex-row-center flex-gap-2">
    <Button
      label={gitlab.string.Save}
      kind={'primary'}
      disabled={!canSave}
      loading={saving}
      on:click={() => dispatch('save')}
    />
    {#if editing}
      <Button label={gitlab.string.Remove} kind={'dangerous'} loading={removing} on:click={() => dispatch('remove')} />
      <Button label={presentation.string.Cancel} kind={'ghost'} on:click={() => dispatch('cancel')} />
    {/if}
  </div>
</div>
