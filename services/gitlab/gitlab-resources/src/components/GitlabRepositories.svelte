<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { type GitlabIntegration, type GitlabIntegrationRepository } from '@hcengineering/gitlab'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { type Project } from '@hcengineering/tracker'
  import { Button, Label, SearchEdit } from '@hcengineering/ui'
  import { errorText } from '../errors'
  import gitlab from '../plugin'
  import { sendGLServiceRequest } from '../utils'
  import ConnectProject from './ConnectProject.svelte'

  export let integration: GitlabIntegration
  export let projects: Project[] = []
  // Every GitLab integration in the workspace; used to tell a live project owner from a dangling one.
  export let integrations: GitlabIntegration[] = []

  const client = getClient()
  const query = createQuery()
  let repositories: GitlabIntegrationRepository[] = []
  let search = ''
  let error: string | undefined

  $: query.query(gitlab.class.GitlabIntegrationRepository, { attachedTo: integration._id }, (res) => {
    repositories = res.sort((a, b) => a.pathWithNamespace.localeCompare(b.pathWithNamespace))
  })

  $: visible = repositories.filter(
    (it) => search === '' || it.pathWithNamespace.toLowerCase().includes(search.toLowerCase())
  )

  async function unlink (repository: GitlabIntegrationRepository): Promise<void> {
    error = undefined
    try {
      const projectId = repository.gitlabProject
      // Batch the repository update and the project $pull into one transaction.
      const ops = client.apply()
      await ops.update(repository, { enabled: false, gitlabProject: null })
      const project = projects.find((it) => it._id === projectId)
      if (project !== undefined) {
        const glProject = client.getHierarchy().as(project, gitlab.mixin.GitlabProject)
        await ops.update(glProject, { $pull: { repositories: repository._id } })
      }
      const { result } = await ops.commit()
      if (!result) {
        throw new Error('Failed to unlink GitLab repository')
      }
    } catch (err) {
      error = errorText(err)
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
      return
    }
    // Best effort: the link is already removed locally.
    await sendGLServiceRequest('repository-disable', { repositoryId: repository._id }).catch((err) => {
      Analytics.handleError(err)
    })
  }

  function projectName (repository: GitlabIntegrationRepository): string {
    return projects.find((it) => it._id === repository.gitlabProject)?.name ?? ''
  }
</script>

<div class="flex-col flex-gap-2">
  <SearchEdit bind:value={search} />
  {#if error !== undefined}
    <span class="error-color">{error}</span>
  {/if}
  {#if visible.length === 0}
    <Label label={gitlab.string.NoRepositories} />
  {/if}
  {#each visible as repository (repository._id)}
    <div class="flex-row-center flex-between flex-gap-2">
      <a href={repository.webUrl} target="_blank" rel="noopener noreferrer">{repository.pathWithNamespace}</a>
      {#if repository.deleted}
        <span class="dark-color"><Label label={gitlab.string.Unavailable} /></span>
      {:else if repository.enabled && repository.gitlabProject !== null}
        <div class="flex-row-center flex-gap-2">
          <Label label={gitlab.string.LinkedTo} /> <b>{projectName(repository)}</b>
          <Button label={gitlab.string.Unlink} on:click={() => unlink(repository)} />
        </div>
      {:else}
        <ConnectProject {integration} {repository} {projects} {integrations} />
      {/if}
    </div>
  {/each}
</div>
