<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type Ref } from '@hcengineering/core'
  import { type GitlabIntegration, type GitlabIntegrationRepository } from '@hcengineering/gitlab'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import { Button, Label, SearchEdit } from '@hcengineering/ui'
  import { reportError } from '../errors'
  import gitlab from '../plugin'
  import { linkedProjectName, unlinkRepository } from '../project-link'
  import { safeHttpUrl } from '../safe-url'
  import { confirmDangerous, sendGLServiceRequest } from '../utils'
  import ConnectProject from './ConnectProject.svelte'
  import ErrorText from './ErrorText.svelte'

  export let integration: GitlabIntegration
  export let projects: Project[] = []
  // Every GitLab integration in the workspace; used to tell a live project owner from a dangling one.
  export let integrations: GitlabIntegration[] = []

  const client = getClient()
  const query = createQuery()
  const linkedProjectsQuery = createQuery()
  let repositories: GitlabIntegrationRepository[] = []
  let search = ''
  let error: unknown
  // The projects these repositories are linked to, archived ones included (`projects` lists active ones only)
  let linkedProjects = new Map<Ref<Project>, Project>()

  $: query.query(gitlab.class.GitlabIntegrationRepository, { attachedTo: integration._id }, (res) => {
    repositories = res.sort((a, b) => a.pathWithNamespace.localeCompare(b.pathWithNamespace))
  })

  $: linkedIds = [
    ...new Set(
      repositories.map((it) => it.gitlabProject as Ref<Project> | null).filter((it): it is Ref<Project> => it !== null)
    )
  ]
  $: linkedProjectsQuery.query(tracker.class.Project, { _id: { $in: linkedIds } }, (res) => {
    linkedProjects = new Map(res.map((it) => [it._id, it]))
  })

  $: visible = repositories.filter(
    (it) => search === '' || it.pathWithNamespace.toLowerCase().includes(search.toLowerCase())
  )

  function confirmUnlink(repository: GitlabIntegrationRepository): void {
    confirmDangerous(
      gitlab.string.Unlink,
      gitlab.string.UnlinkConfirm,
      async () => {
        await unlink(repository)
      },
      { repository: repository.pathWithNamespace, project: linkedProjectName(repository, linkedProjects) }
    )
  }

  async function unlink(repository: GitlabIntegrationRepository): Promise<void> {
    error = undefined
    const projectId = repository.gitlabProject as Ref<Project> | null
    try {
      const project =
        projectId === null
          ? undefined
          : (linkedProjects.get(projectId) ?? (await client.findOne(tracker.class.Project, { _id: projectId })))
      await unlinkRepository(client, sendGLServiceRequest, repository, project)
    } catch (err: unknown) {
      error = err
      reportError(err)
    }
  }
</script>

<div class="flex-col flex-gap-2">
  <SearchEdit bind:value={search} />
  {#if error !== undefined}
    <ErrorText {error} />
  {/if}
  {#if visible.length === 0}
    <Label label={gitlab.string.NoRepositories} />
  {/if}
  {#each visible as repository (repository._id)}
    <div class="flex-row-center flex-between flex-gap-2">
      <a href={safeHttpUrl(repository.webUrl)} target="_blank" rel="noopener noreferrer"
        >{repository.pathWithNamespace}</a
      >
      {#if repository.deleted}
        <span class="content-dark-color"><Label label={gitlab.string.Unavailable} /></span>
      {:else if repository.enabled && repository.gitlabProject !== null}
        <div class="flex-row-center flex-gap-2">
          <span><Label label={gitlab.string.LinkedTo} /> <b>{linkedProjectName(repository, linkedProjects)}</b></span>
          <Button
            label={gitlab.string.Unlink}
            on:click={() => {
              confirmUnlink(repository)
            }}
          />
        </div>
      {:else}
        <ConnectProject {integration} {repository} {projects} {integrations} />
      {/if}
    </div>
  {/each}
</div>
