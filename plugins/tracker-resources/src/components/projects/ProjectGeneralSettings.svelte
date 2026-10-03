<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import type { DocumentUpdate } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import {
    MAX_PROJECT_SHORT_DESCRIPTION,
    validateProjectDetails,
    type Project,
    type ProjectDetailsError
  } from '@hcengineering/tracker'
  import { EditBox, Label } from '@hcengineering/ui'
  import type { IntlString } from '@hcengineering/platform'

  import tracker from '../../plugin'
  import ProjectSettingsCard from './ProjectSettingsCard.svelte'
  import ReadmeEditor from './ReadmeEditor.svelte'

  // General section of the project settings (GitHub: title, short description and README)
  export let project: Project
  export let readonly: boolean = false

  const client = getClient()

  let name: string = project.name
  let shortDescription: string = project.shortDescription ?? ''
  let readme: string | undefined = project.readme
  let saving = false
  let showErrors = false

  const errorLabels: Record<ProjectDetailsError, IntlString> = {
    shortDescriptionTooLong: tracker.string.ProjectShortDescriptionTooLong,
    readmeTooLong: tracker.string.ProjectReadmeTooLong
  }

  $: error = validateProjectDetails({ shortDescription, readme })
  $: changed =
    name.trim() !== project.name ||
    shortDescription !== (project.shortDescription ?? '') ||
    (readme ?? '') !== (project.readme ?? '')
  $: canSave = !readonly && !saving && name.trim().length > 0 && changed && error === undefined

  async function save (): Promise<void> {
    showErrors = true
    if (!canSave) return
    saving = true
    try {
      const update: DocumentUpdate<Project> = {}
      if (name.trim() !== project.name) update.name = name.trim()
      if (shortDescription !== (project.shortDescription ?? '')) update.shortDescription = shortDescription.trim()
      if ((readme ?? '') !== (project.readme ?? '') && readme !== undefined) update.readme = readme
      await client.update(project, update)
      showErrors = false
    } catch (err: any) {
      Analytics.handleError(err)
    } finally {
      saving = false
    }
  }
</script>

<ProjectSettingsCard
  embedded
  label={tracker.string.ProjectSettingsGeneral}
  okAction={save}
  {canSave}
  hideFooter={readonly}
>
  <div class="field">
    <span class="caption"><Label label={tracker.string.ProjectTitle} /></span>
    <EditBox
      id="project-settings-title"
      bind:value={name}
      placeholder={tracker.string.ProjectTitlePlaceholder}
      disabled={readonly}
    />
  </div>
  <div class="field">
    <span class="caption"><Label label={tracker.string.ProjectShortDescription} /></span>
    <EditBox
      id="project-settings-short-description"
      bind:value={shortDescription}
      placeholder={tracker.string.ProjectShortDescriptionPlaceholder}
      disabled={readonly}
    />
    <span class="content-dark-color counter">{shortDescription.length}/{MAX_PROJECT_SHORT_DESCRIPTION}</span>
  </div>
  <div class="field">
    <span class="caption"><Label label={tracker.string.ProjectReadme} /></span>
    <ReadmeEditor bind:value={readme} />
  </div>
  {#if showErrors && error !== undefined}
    <div class="error-color">
      <Label
        label={errorLabels[error]}
        params={{ limit: MAX_PROJECT_SHORT_DESCRIPTION }}
      />
    </div>
  {/if}
</ProjectSettingsCard>

<style lang="scss">
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-width: 0;
  }
  .caption {
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .counter {
    align-self: flex-end;
    font-size: 0.75rem;
  }
</style>
