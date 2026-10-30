<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { type Ref } from '@hcengineering/core'
  import { type GitlabIntegration, type GitlabIntegrationRepository } from '@hcengineering/gitlab'
  import { getMetadata, translate } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import ui, {
    Button,
    DropdownLabelsPopup,
    IconChevronDown,
    getEventPopupPositionElement,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import { reportError } from '../errors'
  import gitlab from '../plugin'
  import { isLinkableProject, linkRepository } from '../project-link'
  import { sendGLServiceRequest } from '../utils'
  import ErrorText from './ErrorText.svelte'

  export let integration: GitlabIntegration
  export let repository: GitlabIntegrationRepository
  export let projects: Project[] = []
  export let integrations: GitlabIntegration[] = []

  // Dropdown item id that opens the "create project" dialog instead of linking an existing project.
  const NEW_PROJECT_ID = '#'

  const client = getClient()
  let busy = false
  let error: unknown

  async function link(projectId: Ref<Project>): Promise<void> {
    const project =
      projects.find((it) => it._id === projectId) ?? (await client.findOne(tracker.class.Project, { _id: projectId }))
    if (project === undefined) return
    busy = true
    error = undefined
    try {
      await linkRepository(client, sendGLServiceRequest, project, integration, repository)
      Analytics.handleEvent('gitlab.project.connected', { project: project.identifier, repository: repository._id })
    } catch (err: unknown) {
      error = err
      reportError(err)
    } finally {
      busy = false
    }
  }

  $: existingIntegrationIds = new Set<string>(integrations.map((it) => it._id))
  $: allowed = projects.filter((it) =>
    isLinkableProject(
      client.getHierarchy().asIf(it, gitlab.mixin.GitlabProject),
      integration._id,
      existingIntegrationIds
    )
  )

  async function select(event: MouseEvent): Promise<void> {
    const newProjectLabel = await translate(tracker.string.NewProject, {}, $themeStore.language)
    showPopup(
      DropdownLabelsPopup,
      {
        enableSearch: allowed.length > 5,
        items: [
          ...allowed.map((it) => ({ id: `${it._id}`, label: it.name })),
          { id: NEW_PROJECT_ID, label: newProjectLabel }
        ]
      },
      getEventPopupPositionElement(event),
      (result) => {
        if (result == null) return
        if (result === NEW_PROJECT_ID) {
          showPopup(tracker.component.CreateProject, {}, 'center', (created) => {
            if (created != null) void link(created as Ref<Project>)
          })
        } else {
          void link(result as Ref<Project>)
        }
      }
    )
  }
</script>

<Button
  size={'medium'}
  kind={'primary'}
  loading={busy}
  label={gitlab.string.LinkToProject}
  labelParams={{ title: getMetadata(ui.metadata.PlatformTitle) }}
  on:click={select}
  iconRight={IconChevronDown}
/>
{#if error !== undefined}<span class="ml-2"><ErrorText {error} /></span>{/if}
