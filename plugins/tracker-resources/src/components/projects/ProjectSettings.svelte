<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import { createQuery } from '@hcengineering/presentation'
  import type { Project } from '@hcengineering/tracker'
  import { getCurrentLocation, Label, Modal, navigate } from '@hcengineering/ui'
  import { canEditSpace } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import ArchivedItemsPopup from '../archive/ArchivedItemsPopup.svelte'
  import WebhooksPopup from '../webhooks/WebhooksPopup.svelte'
  import WorkflowsPopup from '../workflows/WorkflowsPopup.svelte'
  import ProjectFieldsPopup from '../../projectFields/ProjectFieldsPopup.svelte'
  import tracker from '../../plugin'
  import ProjectDangerZone from './ProjectDangerZone.svelte'
  import ProjectGeneralSettings from './ProjectGeneralSettings.svelte'

  // The settings page of a project (GitHub: project "Settings"), a popup with a sidebar of sections. The editors of the
  // sections are the ones the project has always had (fields, workflows, webhooks, archived items), embedded.
  export let projectId: Ref<Project>
  export let section: ProjectSettingsSection = 'general'

  type ProjectSettingsSection = 'general' | 'fields' | 'workflows' | 'webhooks' | 'archived' | 'danger'

  const dispatch = createEventDispatcher()
  const projectQuery = createQuery()

  const sections: Array<{ id: ProjectSettingsSection, label: IntlString }> = [
    { id: 'general', label: tracker.string.ProjectSettingsGeneral },
    { id: 'fields', label: tracker.string.CustomFields },
    { id: 'workflows', label: tracker.string.Workflows },
    { id: 'webhooks', label: tracker.string.ProjectWebhooks },
    { id: 'archived', label: tracker.string.ArchivedItems },
    { id: 'danger', label: tracker.string.ProjectSettingsDangerZone }
  ]

  let project: Project | undefined
  let canEdit = false

  $: projectQuery.query(tracker.class.Project, { _id: projectId }, (res) => {
    project = res[0]
  })
  $: if (project !== undefined) void canEditSpace(project).then((res) => (canEdit = res))

  function deleted (): void {
    dispatch('close')
    // Leave the page of the project that is gone
    const loc = getCurrentLocation()
    loc.path.length = 3
    loc.query = undefined
    loc.fragment = undefined
    navigate(loc)
  }
</script>

<Modal
  label={tracker.string.ProjectSettings}
  type={'type-popup'}
  width={'large'}
  maxWidth={'70rem'}
  hideFooter
  scrollableContent={false}
  onCancel={() => dispatch('close')}
  on:close
>
  <div class="settings" data-id="project-settings">
    <nav class="sidebar">
      {#each sections as item (item.id)}
        <button
          type="button"
          class="nav-item"
          class:selected={section === item.id}
          data-id={`settings-section-${item.id}`}
          on:click={() => {
            section = item.id
          }}
        >
          <Label label={item.label} />
        </button>
      {/each}
    </nav>
    <div class="content">
      {#if project === undefined}
        <div class="content-dark-color"><Label label={tracker.string.ProjectNoDescription} /></div>
      {:else if section === 'general'}
        <ProjectGeneralSettings {project} readonly={!canEdit} />
      {:else if section === 'fields'}
        <ProjectFieldsPopup {project} embedded />
      {:else if section === 'workflows'}
        <WorkflowsPopup {project} embedded />
      {:else if section === 'webhooks'}
        <WebhooksPopup {project} embedded />
      {:else if section === 'archived'}
        <ArchivedItemsPopup {project} embedded />
      {:else}
        <ProjectDangerZone {project} on:deleted={deleted} />
      {/if}
    </div>
  </div>
</Modal>

<style lang="scss">
  .settings {
    display: flex;
    flex: 1 1 0;
    min-height: 0;
    height: 70vh;
  }
  .sidebar {
    display: flex;
    flex-direction: column;
    flex: 0 0 13rem;
    gap: 0.125rem;
    padding: 0.75rem 0.5rem;
    border-right: 1px solid var(--theme-divider-color);
    overflow: auto;
  }
  .nav-item {
    padding: 0.5rem 0.75rem;
    text-align: left;
    color: var(--theme-content-color);
    background: none;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
  }
  .nav-item:hover {
    background-color: var(--theme-button-hovered);
  }
  .nav-item.selected {
    color: var(--theme-caption-color);
    font-weight: 500;
    background-color: var(--theme-button-pressed, var(--theme-button-hovered));
  }
  .content {
    flex: 1 1 0;
    min-width: 0;
    padding: 1rem 1.5rem;
    overflow: auto;
  }
</style>
