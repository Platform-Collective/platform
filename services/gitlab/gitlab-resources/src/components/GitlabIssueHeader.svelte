<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type Ref } from '@hcengineering/core'
  import { type GitlabIntegrationRepository } from '@hcengineering/gitlab'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Issue, type Project } from '@hcengineering/tracker'
  import { Button, Icon, Label, showPopup } from '@hcengineering/ui'
  import { errorText, reportError } from '../errors'
  import { asMergeRequest, headerImages, issueHeaderState } from '../issue-header'
  import gitlab from '../plugin'
  import { issueLinkFor, linkedRepositories } from '../repository-choice'
  import GitlabImagePopup from './GitlabImagePopup.svelte'
  import GitlabRefLink from './GitlabRefLink.svelte'
  import { gitlabRepositories } from './repositories'
  import RepositorySelect from './RepositorySelect.svelte'

  export let value: Issue
  export let readonly = false

  const client = getClient()
  const hierarchy = client.getHierarchy()

  let project: Project | undefined
  const projectQuery = createQuery()
  $: projectQuery.query(tracker.class.Project, { _id: value.space }, (res) => {
    ;[project] = res
  })

  // A change this browser could not save (the server refused it)
  let failed: string | null = null

  $: mergeRequest = asMergeRequest(hierarchy, value)
  $: link = mergeRequest === undefined ? hierarchy.asIf(value, gitlab.mixin.GitlabIssue) : undefined
  $: repositoryId = mergeRequest?.repository ?? link?.repository ?? undefined
  $: repository = repositoryId != null ? $gitlabRepositories.get(repositoryId) : undefined
  $: linked =
    project !== undefined && hierarchy.hasMixin(project, gitlab.mixin.GitlabProject)
      ? linkedRepositories($gitlabRepositories.values(), project._id)
      : []
  $: state = issueHeaderState({ mergeRequest, link, linkedRepositories: linked.length, readonly })
  $: error = state.error ?? failed
  // Description images left on GitLab; the viewer loads each one with the viewer's own GitLab account
  $: images = state.kind === 'mergeRequest' || state.kind === 'linked' ? headerImages({ mergeRequest, link }) : []

  function openImages(): void {
    showPopup(GitlabImagePopup, { images, index: 0 }, 'centered')
  }

  // Picking a repository is all it takes: the GitLab service creates the GitLab issue
  async function createInGitlab(picked: Ref<GitlabIntegrationRepository> | null): Promise<void> {
    if (picked === null) return
    failed = null
    const issueLink = issueLinkFor({ repository: picked })
    if (issueLink === undefined) return
    const data = { ...issueLink, syncError: null }
    try {
      if (link !== undefined) {
        await client.updateMixin(value._id, value._class, value.space, gitlab.mixin.GitlabIssue, data)
      } else {
        await client.createMixin(value._id, value._class, value.space, gitlab.mixin.GitlabIssue, data)
      }
    } catch (err: unknown) {
      failed = errorText(err)
      reportError(err)
    }
  }

  // Clearing the error is a Huly change: the GitLab service syncs the issue again
  async function retry(): Promise<void> {
    failed = null
    try {
      if (mergeRequest !== undefined) {
        await client.update(mergeRequest, { syncError: null })
      } else {
        await client.updateMixin(value._id, value._class, value.space, gitlab.mixin.GitlabIssue, { syncError: null })
      }
    } catch (err: unknown) {
      failed = errorText(err)
      reportError(err)
    }
  }
</script>

{#if state.kind === 'mergeRequest' && mergeRequest !== undefined}
  <div class="ml-2">
    <GitlabRefLink
      icon={gitlab.icon.MergeRequest}
      url={mergeRequest.url}
      repository={repository?.pathWithNamespace ?? ''}
      reference={`!${mergeRequest.gitlabIid}`}
    />
  </div>
{:else if state.kind === 'linked' && link !== undefined}
  <div class="ml-2">
    <GitlabRefLink
      icon={gitlab.icon.Gitlab}
      url={link.url}
      repository={repository?.pathWithNamespace ?? ''}
      reference={`#${link.gitlabIid}`}
    />
  </div>
{:else if state.kind === 'creating' || state.kind === 'failed'}
  <!-- Picked: the GitLab issue is being created, or GitLab refused it -->
  <div class="ml-2 flex-row-center">
    <Icon icon={gitlab.icon.Gitlab} size={'small'} />
    <span class="ml-1">{repository?.pathWithNamespace ?? ''}</span>
  </div>
{:else if state.kind === 'pick'}
  <div class="ml-2">
    <RepositorySelect
      repositories={linked}
      value={null}
      label={gitlab.string.CreateInGitlab}
      allowNone={false}
      onChange={(picked) => {
        void createInGitlab(picked)
      }}
    />
  </div>
{/if}
{#if images.length > 0}
  <div class="ml-2">
    <Button
      kind={'ghost'}
      size={'small'}
      icon={gitlab.icon.Image}
      label={gitlab.string.GitlabImages}
      labelParams={{ count: images.length }}
      on:click={openImages}
    />
  </div>
{/if}
{#if error !== null}
  <div class="ml-2 flex-row-center sync-error" title={error}>
    <span class="overflow-label"><Label label={gitlab.string.SyncErrorMessage} params={{ message: error }} /></span>
    {#if !readonly && state.error !== null}
      <div class="ml-2">
        <Button kind={'link'} size={'small'} label={gitlab.string.Retry} on:click={retry} />
      </div>
    {/if}
  </div>
{/if}

<style lang="scss">
  .sync-error {
    color: var(--theme-error-color);
    max-width: 30rem;
  }
</style>
