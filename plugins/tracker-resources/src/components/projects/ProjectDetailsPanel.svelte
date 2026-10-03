<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { PersonPresenter, employeeByPersonIdStore } from '@hcengineering/contact-resources'
  import { getCurrentAccount, SortingOrder, type Ref } from '@hcengineering/core'
  import { createQuery, getClient, MessageViewer, MessageBox } from '@hcengineering/presentation'
  import { isEmptyMarkup } from '@hcengineering/text'
  import {
    canModifyStatusUpdate,
    latestStatusUpdate,
    projectShortDescription,
    ProjectStatus,
    type Project,
    type ProjectStatusUpdate
  } from '@hcengineering/tracker'
  import { Button, ButtonIcon, IconAdd, IconClose, IconDelete, IconEdit, Label, showPopup, themeStore } from '@hcengineering/ui'
  import { canEditSpace } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'
  import ProjectStatusPill from './ProjectStatusPill.svelte'
  import ProjectStatusUpdatePopup from './ProjectStatusUpdatePopup.svelte'

  // The "About" panel of a project (GitHub's project details): short description, README, the latest status and the
  // history of the status updates.
  export let space: Ref<Project>

  const client = getClient()
  const dispatch = createEventDispatcher()
  const projectQuery = createQuery()
  const updatesQuery = createQuery()

  let project: Project | undefined
  let updates: ProjectStatusUpdate[] = []
  let canManage = false

  $: projectQuery.query(tracker.class.Project, { _id: space }, (res) => {
    project = res[0]
  })
  $: updatesQuery.query(
    tracker.class.ProjectStatusUpdate,
    { space },
    (res) => {
      updates = res
    },
    { sort: { createdOn: SortingOrder.Descending } }
  )
  $: if (project !== undefined) void canEditSpace(project).then((res) => (canManage = res))

  $: latest = latestStatusUpdate(updates)
  $: authorIds = getCurrentAccount().socialIds as string[]

  function formatDay (ts: number | null | undefined): string {
    return ts === undefined || ts === null ? '' : new Date(ts).toLocaleDateString($themeStore.language)
  }

  function period (update: ProjectStatusUpdate): string {
    const from = formatDay(update.startDate)
    const to = formatDay(update.targetDate)
    if (from !== '' && to !== '') return `${from} - ${to}`
    return from !== '' ? from : to
  }

  function write (update?: ProjectStatusUpdate): void {
    if (project === undefined) return
    showPopup(ProjectStatusUpdatePopup, {
      project,
      update,
      initialStatus: latest?.status ?? ProjectStatus.OnTrack
    })
  }

  function remove (update: ProjectStatusUpdate): void {
    showPopup(MessageBox, {
      label: tracker.string.ProjectStatusDelete,
      message: tracker.string.ProjectStatusDeleteConfirm,
      action: async () => {
        try {
          await client.removeDoc(tracker.class.ProjectStatusUpdate, update.space, update._id)
        } catch (err: any) {
          Analytics.handleError(err)
        }
      }
    })
  }
</script>

<aside class="details" data-id="project-details-panel">
  <div class="header">
    <span class="title"><Label label={tracker.string.ProjectDetails} /></span>
    <ButtonIcon icon={IconClose} size={'small'} kind={'tertiary'} dataId={'btn-close-details'} on:click={() => dispatch('close')} />
  </div>
  <div class="body">
    {#if project !== undefined}
      <div class="name">{project.name}</div>
      {#if projectShortDescription(project) !== ''}
        <div class="short" data-id="project-short-description">{projectShortDescription(project)}</div>
      {:else}
        <div class="content-dark-color"><Label label={tracker.string.ProjectNoDescription} /></div>
      {/if}
      {#if project.readme !== undefined && !isEmptyMarkup(project.readme)}
        <div class="readme" data-id="project-readme">
          <div class="section-title"><Label label={tracker.string.ProjectReadme} /></div>
          <MessageViewer message={project.readme} />
        </div>
      {/if}
    {/if}

    <div class="section-title status-title">
      <Label label={tracker.string.ProjectStatusUpdates} />
      <Button
        icon={IconAdd}
        kind={'ghost'}
        size={'small'}
        label={tracker.string.NewProjectStatusUpdate}
        dataId={'btn-add-status-update'}
        on:click={() => write()}
      />
    </div>
    {#if latest === undefined}
      <div class="content-dark-color" data-id="status-updates-empty"><Label label={tracker.string.ProjectStatusNoUpdates} /></div>
    {/if}
    {#each updates as update (update._id)}
      <div class="update" data-id="status-update">
        <div class="update-head">
          <ProjectStatusPill status={update.status} />
          <span class="content-dark-color">{formatDay(update.createdOn)}</span>
          <div class="flex-grow" />
          {#if canModifyStatusUpdate(update, authorIds, canManage)}
            <ButtonIcon icon={IconEdit} size={'small'} kind={'tertiary'} on:click={() => write(update)} />
            <ButtonIcon icon={IconDelete} size={'small'} kind={'tertiary'} on:click={() => remove(update)} />
          {/if}
        </div>
        <div class="update-meta content-dark-color">
          {#if update.createdBy !== undefined && $employeeByPersonIdStore.get(update.createdBy) !== undefined}
            <PersonPresenter value={$employeeByPersonIdStore.get(update.createdBy)} inline shouldShowAvatar={false} />
          {/if}
          {#if period(update) !== ''}
            <span>{period(update)}</span>
          {/if}
        </div>
        {#if !isEmptyMarkup(update.body)}
          <div class="update-body"><MessageViewer message={update.body} /></div>
        {/if}
      </div>
    {/each}
  </div>
</aside>

<style lang="scss">
  .details {
    display: flex;
    flex-direction: column;
    flex: 0 0 22rem;
    width: 22rem;
    max-width: 40%;
    min-height: 0;
    border-left: 1px solid var(--theme-divider-color);
    background-color: var(--theme-bg-color);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .title {
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    overflow: auto;
    min-height: 0;
  }
  .name {
    font-size: 1.125rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .short {
    color: var(--theme-content-color);
  }
  .section-title {
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .status-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 0.5rem;
    border-top: 1px solid var(--theme-divider-color);
  }
  .update {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
  }
  .update-head,
  .update-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
  }
</style>
