<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { ActivityMessageHeader, ActivityMessageTemplate } from '@hcengineering/activity-resources'
  import { type Person } from '@hcengineering/contact'
  import { EmployeePresenter, getPersonByPersonIdCb } from '@hcengineering/contact-resources'
  import { getCurrentAccount, type Markup, type Ref, SortingOrder, type WithLookup } from '@hcengineering/core'
  import diffview from '@hcengineering/diffview'
  import {
    type GitlabMergeRequest,
    type GitlabPatch,
    type GitlabReviewComment,
    type GitlabReviewThread
  } from '@hcengineering/gitlab'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { ReferenceInput } from '@hcengineering/text-editor-resources'
  import { Button, Component, Label, PaletteColorIndexes, getPlatformColor, themeStore } from '@hcengineering/ui'
  import { extractHunk } from '../../hunk'
  import { patchText } from '../../patch-loader'
  import gitlab from '../../plugin'
  import { expansionAfter } from '../../thread-expansion'
  import ReviewCommentPresenter from './ReviewCommentPresenter.svelte'

  export let value: WithLookup<GitlabReviewThread>
  export let showNotify = false
  export let isHighlighted = false
  export let isSelected = false
  export let shouldScroll = false
  export let embedded = false
  export let onClick: (() => void) | undefined = undefined

  const client = getClient()

  let person: Person | undefined
  $: getPersonByPersonIdCb(value.createdBy ?? value.modifiedBy, (p) => {
    person = p ?? undefined
  })

  let resolver: Person | undefined
  $: if (value.resolvedBy != null) {
    getPersonByPersonIdCb(value.resolvedBy, (p) => {
      resolver = p ?? undefined
    })
  } else {
    resolver = undefined
  }

  $: mergeRequest = value.attachedTo as Ref<GitlabMergeRequest>

  let comments: GitlabReviewComment[] = []
  const commentsQuery = createQuery()
  $: commentsQuery.query(
    gitlab.class.GitlabReviewComment,
    { attachedTo: mergeRequest, discussionId: value.discussionId },
    (res) => {
      comments = res
    },
    { sort: { createdOn: SortingOrder.Ascending } }
  )

  let patch: GitlabPatch | undefined
  const patchQuery = createQuery()
  $: patchQuery.query(gitlab.class.GitlabPatch, { attachedTo: mergeRequest }, (res) => {
    ;[patch] = res
  })

  // Cut from the stored diff; an outdated thread shows its location only
  let hunk = ''
  async function loadHunk (file: GitlabPatch | undefined, thread: GitlabReviewThread): Promise<void> {
    if (file === undefined || thread.isOutdated) {
      hunk = ''
      return
    }
    try {
      const text = await patchText(file)
      // A newer diff may have arrived meanwhile
      if (patch?.file === file.file) hunk = extractHunk(text, thread.path, thread.line, thread.oldLine)
    } catch {
      hunk = ''
    }
  }
  $: void loadHunk(patch, value)

  $: location =
    value.line !== null
      ? `${value.path}:${value.line}`
      : value.oldLine !== null
        ? `${value.oldPath}:${value.oldLine}`
        : value.path

  let expansion = { expanded: !value.isResolved, resolved: value.isResolved }
  $: expansion = expansionAfter(expansion, value.isResolved)
  $: expanded = expansion.expanded

  function onExpand (next: boolean): void {
    expansion = { ...expansion, expanded: next }
  }

  async function reply (event: CustomEvent<Markup>): Promise<void> {
    await client.addCollection(
      gitlab.class.GitlabReviewComment,
      value.space,
      mergeRequest,
      value.attachedToClass,
      'reviewComments',
      { discussionId: value.discussionId, body: event.detail }
    )
  }

  // The GitLab service resolves or reopens the discussion in GitLab
  async function toggleResolved (): Promise<void> {
    if (value.isResolved) {
      await client.update(value, { isResolved: false, resolvedBy: null })
    } else {
      await client.update(value, { isResolved: true, resolvedBy: getCurrentAccount().primarySocialId })
    }
  }
</script>

<div
  class:unresolved={!value.isResolved}
  style:border-color={!value.isResolved ? getPlatformColor(PaletteColorIndexes.Orange, $themeStore.dark) : undefined}
>
  <ActivityMessageTemplate
    message={value}
    parentMessage={undefined}
    {person}
    {showNotify}
    {isHighlighted}
    {isSelected}
    {shouldScroll}
    {embedded}
    viewlet={undefined}
    {onClick}
  >
    <svelte:fragment slot="header">
      <ActivityMessageHeader
        message={value}
        {person}
        object={undefined}
        parentObject={undefined}
        isEdited={false}
        label={gitlab.string.ReviewThread}
      />
    </svelte:fragment>
    <svelte:fragment slot="content" let:readonly>
      <div class="thread">
        <div class="flex-row-center p-2">
          <Label label={gitlab.string.CommentedOnDiff} params={{ path: location }} />
          {#if value.isOutdated}
            <span class="ml-2"><Label label={gitlab.string.Outdated} /></span>
          {/if}
        </div>
        {#if hunk !== ''}
          <Component
            is={diffview.component.InlineDiffView}
            props={{ patch: hunk, fileName: value.path, expandable: value.isResolved, expanded, onExpand }}
          />
        {/if}
        {#if expanded}
          <div class="ml-4">
            {#each comments as comment (comment._id)}
              <ReviewCommentPresenter {comment} />
            {/each}
          </div>
          {#if !readonly}
            <div class="ml-4 mr-4">
              <ReferenceInput showSend showHeader showActions on:message={reply} />
            </div>
          {/if}
          <div class="p-2 flex-row-center">
            {#if !readonly}
              <Button
                label={value.isResolved ? gitlab.string.UnresolveThread : gitlab.string.ResolveThread}
                on:click={toggleResolved}
              />
            {/if}
            {#if value.isResolved && resolver !== undefined}
              <span class="ml-4"><Label label={gitlab.string.ResolvedBy} /></span>
              <div class="ml-2"><EmployeePresenter value={resolver} shouldShowAvatar /></div>
            {/if}
          </div>
        {:else}
          <div class="p-2">
            <Button
              label={gitlab.string.ReviewComments}
              kind="ghost"
              on:click={() => {
                onExpand(true)
              }}
            />
          </div>
        {/if}
      </div>
    </svelte:fragment>
  </ActivityMessageTemplate>
</div>

<style lang="scss">
  .unresolved {
    border: 1px solid;
    border-radius: 0.5rem;
    margin: 0.25rem 0;
  }
  .thread {
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    overflow-y: hidden;
  }
</style>
