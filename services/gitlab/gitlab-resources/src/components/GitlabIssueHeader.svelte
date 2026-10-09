<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type Hyperlink, type Ref } from '@hcengineering/core'
  import { type GitlabIntegrationRepository, type GitlabMergeRequest } from '@hcengineering/gitlab'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Issue, type Project } from '@hcengineering/tracker'
  import { Button, Icon, Label } from '@hcengineering/ui'
  import { issueHeaderState } from '../issue-header'
  import gitlab from '../plugin'
  import { linkedRepositories } from '../repository-choice'
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

  $: mergeRequest = hierarchy.isDerived(value._class, gitlab.class.GitlabMergeRequest) ? (value as GitlabMergeRequest) : undefined
  $: link = mergeRequest === undefined ? hierarchy.asIf(value, gitlab.mixin.GitlabIssue) : undefined
  $: repositoryId = mergeRequest?.repository ?? link?.repository ?? undefined
  $: repository = repositoryId != null ? $gitlabRepositories.get(repositoryId) : undefined
  $: linked =
    project !== undefined && hierarchy.hasMixin(project, gitlab.mixin.GitlabProject)
      ? linkedRepositories($gitlabRepositories.values(), project._id)
      : []
  $: state = issueHeaderState({ mergeRequest, link, linkedRepositories: linked.length, readonly })
  $: error = state.error ?? failed

  function messageOf (err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  // Picking a repository is all it takes: the GitLab service creates the GitLab issue
  async function createInGitlab (picked: Ref<GitlabIntegrationRepository> | null): Promise<void> {
    if (picked === null) return
    failed = null
    const data = { repository: picked, url: '' as Hyperlink, gitlabIid: 0, syncError: null }
    try {
      if (link !== undefined) {
        await client.updateMixin(value._id, value._class, value.space, gitlab.mixin.GitlabIssue, data)
      } else {
        await client.createMixin(value._id, value._class, value.space, gitlab.mixin.GitlabIssue, data)
      }
    } catch (err: unknown) {
      failed = messageOf(err)
    }
  }

  // Clearing the error is a Huly change: the GitLab service syncs the issue again
  async function retry (): Promise<void> {
    failed = null
    try {
      if (mergeRequest !== undefined) {
        await client.update(mergeRequest, { syncError: null })
      } else {
        await client.updateMixin(value._id, value._class, value.space, gitlab.mixin.GitlabIssue, { syncError: null })
      }
    } catch (err: unknown) {
      failed = messageOf(err)
    }
  }
</script>

{#if state.kind === 'mergeRequest' && mergeRequest !== undefined}
  <a class="ml-2 flex-row-center" href={mergeRequest.url} target="_blank" rel="noreferrer">
    <Icon icon={gitlab.icon.MergeRequest} size={'small'} />
    <span class="ml-1">{repository?.pathWithNamespace ?? ''} !{mergeRequest.gitlabIid}</span>
  </a>
{:else if state.kind === 'linked' && link !== undefined}
  <a class="ml-2 flex-row-center" href={link.url} target="_blank" rel="noreferrer">
    <Icon icon={gitlab.icon.Gitlab} size={'small'} />
    <span class="ml-1">{repository?.pathWithNamespace ?? ''} #{link.gitlabIid}</span>
  </a>
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
{#if error !== null}
  <div class="ml-2 flex-row-center sync-error" title={error}>
    <Label label={gitlab.string.SyncError} />:
    <span class="ml-1 overflow-label">{error}</span>
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
