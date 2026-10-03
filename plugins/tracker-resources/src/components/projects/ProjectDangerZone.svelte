<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import type { IntlString } from '@hcengineering/platform'
  import { getClient, MessageBox } from '@hcengineering/presentation'
  import { isDeleteConfirmed, type Project } from '@hcengineering/tracker'
  import { Button, EditBox, Label, showPopup, Toggle } from '@hcengineering/ui'
  import { canArchiveSpace, canDeleteSpace, canEditSpace } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'
  import {
    closeProject,
    deleteProjectConfirmed,
    ProjectSettingsError,
    reopenProject,
    setProjectTemplate,
    setProjectVisibility
  } from '../../projectDetails/lifecycle'
  import ProjectSettingsCard from './ProjectSettingsCard.svelte'

  // Danger zone of the project settings (GitHub): close / reopen, visibility, template, delete. Every action asks
  // the permission model of the space (owners and the workspace roles), nothing is project specific.
  export let project: Project

  const client = getClient()
  const dispatch = createEventDispatcher()

  let canEdit = false
  let canArchive = false
  let canDelete = false
  let busy = false
  let error: IntlString | undefined
  let typedName = ''

  $: void Promise.all([canEditSpace(project), canArchiveSpace(project), canDeleteSpace(project)]).then(
    ([edit, archive, remove]) => {
      canEdit = edit
      canArchive = archive
      canDelete = remove
    }
  )

  async function run (action: () => Promise<void>): Promise<void> {
    busy = true
    error = undefined
    try {
      await action()
    } catch (err: any) {
      if (err instanceof ProjectSettingsError && err.code === 'noMembers') {
        error = tracker.string.ProjectVisibilityNeedsMembers
      } else {
        Analytics.handleError(err)
      }
    } finally {
      busy = false
    }
  }

  function close (): void {
    showPopup(MessageBox, {
      label: tracker.string.ProjectClose,
      message: tracker.string.ProjectCloseConfirm,
      action: async () => {
        await run(async () => {
          await closeProject(client, project)
        })
      }
    })
  }

  async function reopen (): Promise<void> {
    await run(async () => {
      await reopenProject(client, project)
    })
  }

  async function changeVisibility (isPrivate: boolean): Promise<void> {
    await run(async () => {
      await setProjectVisibility(client, project, isPrivate)
    })
  }

  async function toggleTemplate (): Promise<void> {
    await run(async () => {
      await setProjectTemplate(client, project, !(project.isTemplate ?? false))
    })
  }

  async function remove (): Promise<void> {
    await run(async () => {
      await deleteProjectConfirmed(client, project, typedName)
      dispatch('deleted')
    })
  }
</script>

<ProjectSettingsCard embedded label={tracker.string.ProjectSettingsDangerZone} hideFooter>
  {#if project.archived}
    <div class="content-dark-color" data-id="project-closed-note"><Label label={tracker.string.ProjectSettingsClosedNote} /></div>
  {/if}
  {#if !canEdit && !canArchive && !canDelete}
    <div class="content-dark-color"><Label label={tracker.string.ProjectNoPermission} /></div>
  {/if}

  <div class="row" data-id="danger-close">
    <div class="text">
      <span class="caption"><Label label={project.archived ? tracker.string.ProjectReopen : tracker.string.ProjectClose} /></span>
      <span class="content-dark-color">
        <Label label={project.archived ? tracker.string.ProjectReopenDescr : tracker.string.ProjectCloseDescr} />
      </span>
    </div>
    <Button
      label={project.archived ? tracker.string.ProjectReopen : tracker.string.ProjectClose}
      kind={'regular'}
      disabled={!canArchive || busy}
      dataId={'btn-project-close'}
      on:click={project.archived ? reopen : close}
    />
  </div>

  <div class="row" data-id="danger-visibility">
    <div class="text">
      <span class="caption"><Label label={tracker.string.ProjectVisibility} /></span>
      <span class="content-dark-color"><Label label={tracker.string.ProjectVisibilityDescr} /></span>
    </div>
    <div class="flex-row-center flex-gap-2">
      <Label label={project.private ? tracker.string.ProjectVisibilityPrivate : tracker.string.ProjectVisibilityPublic} />
      <Toggle
        id={'project-visibility-private'}
        on={project.private}
        disabled={!canEdit || busy}
        on:change={(e) => {
          void changeVisibility(e.detail)
        }}
      />
    </div>
  </div>

  <div class="row" data-id="danger-template">
    <div class="text">
      <span class="caption">
        <Label label={project.isTemplate === true ? tracker.string.ProjectUnmakeTemplate : tracker.string.ProjectMakeTemplate} />
      </span>
      <span class="content-dark-color"><Label label={tracker.string.ProjectTemplateDescr} /></span>
    </div>
    <Button
      label={project.isTemplate === true ? tracker.string.ProjectUnmakeTemplate : tracker.string.ProjectMakeTemplate}
      kind={'regular'}
      disabled={!canEdit || busy}
      dataId={'btn-project-template'}
      on:click={toggleTemplate}
    />
  </div>

  <div class="row delete" data-id="danger-delete">
    <div class="text">
      <span class="caption"><Label label={tracker.string.ProjectDeleteForever} /></span>
      <span class="content-dark-color"><Label label={tracker.string.ProjectDeleteDescr} /></span>
      <span class="content-dark-color"><Label label={tracker.string.ProjectDeleteTypeName} params={{ name: project.name }} /></span>
      <EditBox id="project-delete-name" bind:value={typedName} disabled={!canDelete || busy} />
    </div>
    <Button
      label={tracker.string.ProjectDeleteForever}
      kind={'dangerous'}
      disabled={!canDelete || busy || !isDeleteConfirmed(project.name, typedName)}
      dataId={'btn-project-delete'}
      on:click={remove}
    />
  </div>

  {#if error !== undefined}
    <div class="error-color"><Label label={error} /></div>
  {/if}
</ProjectSettingsCard>

<style lang="scss">
  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
  }
  .row.delete {
    border-color: var(--theme-error-color, #d73a49);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    flex: 1 1 0;
  }
  .caption {
    font-weight: 500;
    color: var(--theme-caption-color);
  }
</style>
