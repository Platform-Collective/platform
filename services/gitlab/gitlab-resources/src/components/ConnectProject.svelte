<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import core, { type Ref } from '@hcengineering/core'
  import { type GitlabIntegration, type GitlabIntegrationRepository, type GitlabProject } from '@hcengineering/gitlab'
  import { getMetadata, translate } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import ui, {
    Button,
    DropdownLabelsPopup,
    IconChevronDown,
    getEventPopupPositionElement,
    showPopup
  } from '@hcengineering/ui'
  import { errorText } from '../errors'
  import { isLinkableProject } from '../state'
  import gitlab from '../plugin'
  import { sendGLServiceRequest } from '../utils'

  export let integration: GitlabIntegration
  export let repository: GitlabIntegrationRepository
  export let projects: Project[] = []
  export let integrations: GitlabIntegration[] = []

  // Dropdown item id that opens the "create project" dialog instead of linking an existing project.
  const NEW_PROJECT_ID = '#'

  const client = getClient()
  let busy = false
  let error: string | undefined

  async function link (projectId: Ref<Project>): Promise<void> {
    const project =
      projects.find((it) => it._id === projectId) ?? (await client.findOne(tracker.class.Project, { _id: projectId }))
    if (project === undefined) return
    busy = true
    error = undefined
    let hookInstalled = false
    try {
      // Install the webhook first; only link when GitLab accepted it.
      await sendGLServiceRequest('repository-enable', { repositoryId: repository._id })
      hookInstalled = true
      // Link atomically on the Huly side: mixin + repository update in one apply.
      const ops = client.apply()
      const glProject = client.getHierarchy().asIf(project, gitlab.mixin.GitlabProject)
      if (glProject === undefined) {
        await ops.createMixin(project._id, tracker.class.Project, core.space.Space, gitlab.mixin.GitlabProject, {
          integration: integration._id,
          repositories: [repository._id]
        })
      } else if (glProject.integration !== integration._id) {
        // Taken over from another (deleted or idle) integration: drop its possibly dangling repository refs.
        await ops.updateMixin(project._id, tracker.class.Project, core.space.Space, gitlab.mixin.GitlabProject, {
          integration: integration._id,
          repositories: [repository._id]
        })
      } else if (!(glProject.repositories ?? []).includes(repository._id)) {
        await ops.updateMixin(project._id, tracker.class.Project, core.space.Space, gitlab.mixin.GitlabProject, {
          integration: integration._id,
          $push: { repositories: repository._id }
        })
      } else {
        await ops.updateMixin(project._id, tracker.class.Project, core.space.Space, gitlab.mixin.GitlabProject, {
          integration: integration._id
        })
      }
      await ops.update(repository, { gitlabProject: project._id as Ref<GitlabProject>, enabled: true })
      const { result } = await ops.commit()
      if (!result) {
        throw new Error('Failed to link GitLab repository to project')
      }
      Analytics.handleEvent('gitlab.project.connected', { project: project.identifier, repository: repository._id })
    } catch (err: unknown) {
      error = errorText(err)
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
      if (hookInstalled) {
        // Best effort: remove the webhook installed above so no stray hook remains.
        await sendGLServiceRequest('repository-disable', { repositoryId: repository._id }).catch((disableErr) => {
          Analytics.handleError(disableErr)
        })
      }
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

  async function select (event: MouseEvent): Promise<void> {
    const newProjectLabel = await translate(tracker.string.NewProject, {})
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
{#if error !== undefined}<span class="error-color ml-2">{error}</span>{/if}
