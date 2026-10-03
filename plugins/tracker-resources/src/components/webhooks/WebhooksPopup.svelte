<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import contact from '@hcengineering/contact'
  import { generateId, getCurrentAccount, type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import presentation, { Card, createQuery, getClient, MessageBox } from '@hcengineering/presentation'
  import {
    MAX_PROJECT_WEBHOOKS,
    MAX_WEBHOOK_SECRET_LENGTH,
    WEBHOOK_EVENTS,
    type Project,
    type ProjectWebhook,
    type WebhookEvent
  } from '@hcengineering/tracker'
  import { Button, ButtonIcon, CheckBox, EditBox, IconAdd, IconDelete, Label, showPopup, Toggle } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'
  import {
    editWebhookDraft,
    generateWebhookSecret,
    newWebhookDraft,
    toggleDraftEvent,
    validateWebhookDraft,
    webhookData,
    type WebhookDraft,
    type WebhookDraftError
  } from '../../webhooks/draft'

  // The webhooks of a project: a signed JSON message is sent to a URL when an item changes. The secret is write-only:
  // it is stored in the personal space of the person who typed it (no other member can read it), and this form never
  // shows it again.
  export let project: Project

  const client = getClient()
  const dispatch = createEventDispatcher()
  const query = createQuery()

  let webhooks: ProjectWebhook[] = []
  let draft: WebhookDraft | undefined
  let editing: ProjectWebhook | undefined
  let showErrors = false
  let revealSecret = false
  let saving = false

  $: query.query(tracker.class.ProjectWebhook, { space: project._id }, (res) => {
    webhooks = res
  })

  const eventLabels: Record<WebhookEvent, IntlString> = {
    created: tracker.string.WebhookEventCreated,
    edited: tracker.string.WebhookEventEdited,
    archived: tracker.string.WebhookEventArchived,
    restored: tracker.string.WebhookEventRestored,
    deleted: tracker.string.WebhookEventDeleted
  }

  const errorLabels: Record<WebhookDraftError, IntlString> = {
    empty: tracker.string.WebhookUrlRequired,
    tooLong: tracker.string.WebhookUrlInvalid,
    invalid: tracker.string.WebhookUrlInvalid,
    credentials: tracker.string.WebhookUrlInvalid,
    protocol: tracker.string.WebhookUrlNotHttps,
    host: tracker.string.WebhookUrlNotPublic,
    address: tracker.string.WebhookUrlNotPublic,
    noEvents: tracker.string.WebhookNoEvents,
    secretTooLong: tracker.string.WebhookSecretTooLong,
    tooMany: tracker.string.WebhookLimit
  }

  $: error = draft !== undefined ? validateWebhookDraft(draft, webhooks.length, editing === undefined) : undefined

  function startCreate (): void {
    showErrors = false
    revealSecret = false
    editing = undefined
    draft = newWebhookDraft()
  }

  function startEdit (webhook: ProjectWebhook): void {
    showErrors = false
    revealSecret = false
    editing = webhook
    draft = editWebhookDraft(webhook)
  }

  function cancel (): void {
    draft = undefined
    editing = undefined
  }

  function generate (): void {
    if (draft === undefined) return
    draft.secret = generateWebhookSecret((bytes) => crypto.getRandomValues(bytes))
    revealSecret = true
  }

  // The secret goes to the personal space of the author; the newest one of a webhook is what the server signs with
  async function storeSecret (webhook: Ref<ProjectWebhook>, secret: string): Promise<void> {
    const space = await client.findOne(contact.class.PersonSpace, { members: getCurrentAccount().uuid })
    if (space === undefined) throw new Error('Personal space not found')
    await client.createDoc(tracker.class.ProjectWebhookSecret, space._id, { webhook, secret })
  }

  async function save (): Promise<void> {
    if (draft === undefined || saving) return
    showErrors = true
    if (error !== undefined) return
    saving = true
    try {
      const data = webhookData(draft, editing)
      const secret = draft.secret
      if (editing === undefined) {
        const id = generateId<ProjectWebhook>()
        // The secret first: a webhook that says it has a secret always has one
        if (secret !== '') await storeSecret(id, secret)
        await client.createDoc(tracker.class.ProjectWebhook, project._id, data, id)
      } else {
        if (secret !== '') await storeSecret(editing._id, secret)
        await client.updateDoc(tracker.class.ProjectWebhook, project._id, editing._id, data)
      }
      cancel()
    } catch (err: any) {
      Analytics.handleError(err)
    } finally {
      saving = false
    }
  }

  async function setEnabled (webhook: ProjectWebhook, enabled: boolean): Promise<void> {
    try {
      await client.updateDoc(tracker.class.ProjectWebhook, project._id, webhook._id, { enabled })
    } catch (err: any) {
      Analytics.handleError(err)
    }
  }

  function remove (webhook: ProjectWebhook): void {
    showPopup(MessageBox, {
      label: tracker.string.ProjectWebhook,
      message: tracker.string.WebhookDeleteConfirm,
      action: async () => {
        await client.removeDoc(tracker.class.ProjectWebhook, project._id, webhook._id)
      }
    })
  }

  function setEvent (event: WebhookEvent, on: boolean): void {
    if (draft === undefined) return
    draft.events = toggleDraftEvent(draft.events, event, on)
  }

  $: canCreateMore = webhooks.length < MAX_PROJECT_WEBHOOKS
</script>

<Card
  label={draft === undefined ? tracker.string.ProjectWebhooks : tracker.string.ProjectWebhook}
  okLabel={presentation.string.Save}
  okAction={save}
  canSave={draft !== undefined && !saving}
  hideFooter={draft === undefined}
  isBack={draft !== undefined}
  backAction={cancel}
  accentHeader
  width={'medium'}
  gap={'gapV-4'}
  onCancel={() => dispatch('close')}
  on:close
  on:changeContent
>
  {#if draft === undefined}
    <div class="content-dark-color"><Label label={tracker.string.WebhooksHint} /></div>
    {#if webhooks.length === 0}
      <div class="flex-center p-4 content-dark-color" data-id="webhooks-empty">
        <Label label={tracker.string.WebhooksEmpty} />
      </div>
    {/if}
    {#each webhooks as webhook (webhook._id)}
      <div class="flex-row-center flex-gap-2" data-id="webhook-row">
        <Toggle
          on={webhook.enabled}
          on:change={(e) => {
            void setEnabled(webhook, e.detail)
          }}
        />
        <div class="flex-grow overflow-label" title={webhook.url}>{webhook.url}</div>
        {#if webhook.hasSecret}
          <span class="content-dark-color"><Label label={tracker.string.WebhookSecretSet} /></span>
        {/if}
        <Button label={presentation.string.Edit} kind={'ghost'} size={'small'} on:click={() => startEdit(webhook)} />
        <ButtonIcon icon={IconDelete} size={'small'} kind={'tertiary'} on:click={() => remove(webhook)} />
      </div>
    {/each}
    <div class="flex-row-center">
      <Button icon={IconAdd} label={tracker.string.WebhookAdd} kind={'ghost'} disabled={!canCreateMore} on:click={startCreate} />
      {#if !canCreateMore}
        <span class="ml-2 error-color">
          <Label label={tracker.string.WebhookLimit} params={{ max: MAX_PROJECT_WEBHOOKS }} />
        </span>
      {/if}
    </div>
  {:else}
    <EditBox label={tracker.string.WebhookUrl} placeholder={tracker.string.WebhookUrl} bind:value={draft.url} autoFocus />
    <div class="flex-row-center flex-gap-2">
      <Toggle bind:on={draft.enabled} />
      <Label label={tracker.string.WorkflowEnabled} />
    </div>
    <div class="fs-bold"><Label label={tracker.string.WebhookEvents} /></div>
    {#each WEBHOOK_EVENTS as event}
      <div class="flex-row-center flex-gap-2">
        <CheckBox
          checked={draft.events.includes(event)}
          on:value={(e) => {
            setEvent(event, e.detail)
          }}
        />
        <Label label={eventLabels[event]} />
      </div>
    {/each}
    <div class="fs-bold">
      <Label label={tracker.string.WebhookSecret} />
      {#if editing?.hasSecret === true}
        <span class="content-dark-color ml-2"><Label label={tracker.string.WebhookSecretSet} /></span>
      {/if}
    </div>
    <div class="flex-row-center flex-gap-2">
      <EditBox
        placeholder={editing?.hasSecret === true ? tracker.string.WebhookSecretKeepPlaceholder : tracker.string.WebhookSecretNew}
        format={revealSecret ? 'text' : 'password'}
        bind:value={draft.secret}
      />
      <Button label={tracker.string.WebhookSecretGenerate} kind={'regular'} on:click={generate} />
    </div>
    <div class="content-dark-color"><Label label={tracker.string.WebhookSecretNote} /></div>
    {#if showErrors && error !== undefined}
      <div class="error-color">
        <Label label={errorLabels[error]} params={{ max: MAX_PROJECT_WEBHOOKS, limit: MAX_WEBHOOK_SECRET_LENGTH }} />
      </div>
    {/if}
  {/if}
</Card>
