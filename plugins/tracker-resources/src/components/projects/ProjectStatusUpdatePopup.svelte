<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import type { IntlString } from '@hcengineering/platform'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import { EmptyMarkup, isEmptyMarkup } from '@hcengineering/text'
  import { StyledTextArea } from '@hcengineering/text-editor-resources'
  import {
    PROJECT_STATUSES,
    ProjectStatus,
    validateStatusUpdate,
    type Project,
    type ProjectStatusUpdate,
    type ProjectStatusUpdateError
  } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'
  import ProjectStatusPill from './ProjectStatusPill.svelte'

  // A status update of a project (GitHub "Project status updates"): the status, the period it is about and a
  // Markdown text. Without `update` a new one is written, with it that update is edited.
  export let project: Project
  export let update: ProjectStatusUpdate | undefined = undefined
  // Status the form starts with (the one of the latest update)
  export let initialStatus: ProjectStatus = ProjectStatus.OnTrack

  const client = getClient()
  const dispatch = createEventDispatcher()

  let status: ProjectStatus = update?.status ?? initialStatus
  let startDate: number | null = update?.startDate ?? null
  let targetDate: number | null = update?.targetDate ?? null
  let body: string = update?.body ?? EmptyMarkup
  let saving = false
  let showErrors = false

  const errorLabels: Record<ProjectStatusUpdateError, IntlString> = {
    invalidStatus: tracker.string.ProjectStatusNone,
    invalidDates: tracker.string.ProjectStatusDatesInvalid,
    bodyTooLong: tracker.string.ProjectStatusBodyTooLong
  }

  $: error = validateStatusUpdate({ status, startDate, targetDate, body })

  function pad (n: number): string {
    return String(n).padStart(2, '0')
  }

  function toInput (ts: number | null): string {
    if (ts === null) return ''
    const d = new Date(ts)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  // Local midnight of the chosen day; an empty input clears the date
  function fromInput (raw: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
    return m === null ? null : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  }

  async function save (): Promise<void> {
    showErrors = true
    if (error !== undefined || saving) return
    saving = true
    try {
      const data = { status, startDate, targetDate, body: isEmptyMarkup(body) ? EmptyMarkup : body }
      if (update === undefined) {
        await client.createDoc(tracker.class.ProjectStatusUpdate, project._id, data)
      } else {
        await client.updateDoc(tracker.class.ProjectStatusUpdate, project._id, update._id, data)
      }
      dispatch('close', true)
    } catch (err: any) {
      Analytics.handleError(err)
    } finally {
      saving = false
    }
  }
</script>

<Card
  label={update === undefined ? tracker.string.NewProjectStatusUpdate : tracker.string.EditProjectStatusUpdate}
  okLabel={presentation.string.Save}
  okAction={save}
  canSave={error === undefined && !saving}
  accentHeader
  width={'medium'}
  gap={'gapV-4'}
  onCancel={() => dispatch('close')}
  on:close
  on:changeContent
>
  <div class="statuses" data-id="status-update-statuses">
    {#each PROJECT_STATUSES as item (item)}
      <button
        type="button"
        class="status-choice"
        class:selected={status === item}
        data-id={`status-choice-${item}`}
        on:click={() => {
          status = item
        }}
      >
        <ProjectStatusPill status={item} clickable />
      </button>
    {/each}
  </div>
  <div class="dates">
    <label>
      <span class="content-dark-color"><Label label={tracker.string.StartDate} /></span>
      <input
        type="date"
        data-id="status-update-start"
        value={toInput(startDate)}
        on:change={(e) => {
          startDate = fromInput(e.currentTarget.value)
        }}
      />
    </label>
    <label>
      <span class="content-dark-color"><Label label={tracker.string.TargetDate} /></span>
      <input
        type="date"
        data-id="status-update-target"
        value={toInput(targetDate)}
        on:change={(e) => {
          targetDate = fromInput(e.currentTarget.value)
        }}
      />
    </label>
  </div>
  <StyledTextArea
    bind:content={body}
    placeholder={tracker.string.ProjectStatusBodyPlaceholder}
    kind={'emphasized'}
    showButtons={false}
    maxHeight={'20rem'}
  />
  {#if showErrors && error !== undefined}
    <div class="error-color"><Label label={errorLabels[error]} /></div>
  {/if}
</Card>

<style lang="scss">
  .statuses {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .status-choice {
    padding: 0.125rem;
    background: none;
    border: 2px solid transparent;
    border-radius: 1.25rem;
    cursor: pointer;
  }
  .status-choice.selected {
    border-color: var(--theme-caption-color);
  }
  .dates {
    display: flex;
    gap: 1rem;
  }
  .dates label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  input[type='date'] {
    padding: 0.25rem 0.5rem;
    color: var(--theme-caption-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
  }
</style>
