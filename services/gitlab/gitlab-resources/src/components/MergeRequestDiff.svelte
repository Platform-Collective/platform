<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { getCurrentEmployee } from '@hcengineering/contact'
  import diffview from '@hcengineering/diffview'
  import { type GitlabMergeRequest, type GitlabMergeRequestReview, type GitlabPatch } from '@hcengineering/gitlab'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Button, Chevron, Component, ExpandCollapse, Label } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { reportError } from '../errors'
  import { changesUrl, isTooLargeForHuly, showDiffInHuly } from '../merge-request-changes'
  import { patchText } from '../patch-loader'
  import gitlab from '../plugin'
  import { createSerialQueue, saveViewedFile } from '../viewed-files'
  import ErrorText from './ErrorText.svelte'

  export let mergeRequest: GitlabMergeRequest

  const client = getClient()
  const me = getCurrentEmployee()
  // One toggle at a time: two quick ticks must not both create this user's review doc
  const serial = createSerialQueue()

  let collapsed = true
  // The diff downloads on the first expand only
  let opened = false
  let patch: GitlabPatch | undefined
  let text = ''
  let failed = false
  // Huly only: the files this user marked as viewed
  let review: GitlabMergeRequestReview | undefined
  let viewedError: unknown

  const patchQuery = createQuery()
  $: patchQuery.query(gitlab.class.GitlabPatch, { attachedTo: mergeRequest._id }, (res) => {
    ;[patch] = res
  })
  const reviewQuery = createQuery()
  $: reviewQuery.query(gitlab.class.GitlabMergeRequestReview, { attachedTo: mergeRequest._id, author: me }, (res) => {
    ;[review] = res
  })

  // Large merge requests are read in GitLab
  $: inHuly = showDiffInHuly(mergeRequest, patch !== undefined)
  $: href = changesUrl(mergeRequest.url)
  $: if (patch !== undefined && opened && inHuly) void load(patch)

  // Only the answer for the current blob is kept: an older download may finish last
  async function load (file: GitlabPatch): Promise<void> {
    failed = false
    try {
      const loaded = await patchText(file)
      if (patch?.file === file.file) text = loaded
    } catch (err: unknown) {
      reportError(err)
      if (patch?.file === file.file) {
        text = ''
        failed = true
      }
    }
  }

  function onViewed (fileName: string, sha: string, viewed: boolean): void {
    viewedError = undefined
    serial(async () => {
      await saveViewedFile(client, mergeRequest, me, { fileName, sha, viewed })
    }).catch((err: unknown) => {
      viewedError = err
      reportError(err)
    })
  }
</script>

{#if mergeRequest.files > 0 || href !== undefined}
  <div class="mt-6">
    <div class="flex-between mb-1">
      <div class="flex-row-center">
        {#if inHuly}
          <Button
            width="min-content"
            kind="ghost"
            on:click={() => {
              collapsed = !collapsed
              opened = true
            }}
          >
            <svelte:fragment slot="content">
              <Chevron
                size={'small'}
                expanded={!collapsed}
                outline
                fill={'var(--caption-color)'}
                marginRight={'.375rem'}
              />
              <Label label={gitlab.string.ChangedFiles} params={{ files: mergeRequest.files }} />
            </svelte:fragment>
          </Button>
        {:else if mergeRequest.files > 0}
          <Label label={gitlab.string.ChangedFiles} params={{ files: mergeRequest.files }} />
        {/if}
        {#if mergeRequest.files > 0}
          <span class="added ml-2">+{mergeRequest.additions}</span>
          <span class="deleted ml-1">−{mergeRequest.deletions}</span>
        {/if}
      </div>
      {#if href !== undefined}
        <Button
          kind="ghost"
          size="small"
          icon={view.icon.Open}
          label={gitlab.string.OpenInGitlab}
          on:click={() => {
            window.open(href, '_blank', 'noopener,noreferrer')
          }}
        />
      {/if}
    </div>
    {#if isTooLargeForHuly(mergeRequest)}
      <div class="note"><Label label={gitlab.string.DiffTooLarge} /></div>
    {:else if inHuly}
      <ExpandCollapse isExpanded={!collapsed}>
        <div class="list">
          {#if failed}
            <Label label={gitlab.string.DiffUnavailable} />
          {:else if text !== ''}
            {#if viewedError !== undefined}<ErrorText error={viewedError} />{/if}
            <Component
              is={diffview.component.DiffView}
              props={{ patch: text, viewed: review?.files ?? [] }}
              on:change={(evt) => {
                const { fileName, sha, viewed } = evt.detail
                onViewed(fileName, sha, viewed)
              }}
            />
          {/if}
        </div>
      </ExpandCollapse>
    {/if}
  </div>
{/if}

<style lang="scss">
  .added {
    color: var(--theme-won-color);
  }
  .deleted {
    color: var(--theme-lost-color);
  }
  .note {
    padding: 0.25rem 0.75rem;
    color: var(--theme-dark-color);
  }
  .list {
    padding-top: 0.75rem;
    border-top: 1px solid var(--divider-color);
  }
</style>
