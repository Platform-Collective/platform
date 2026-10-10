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
  import { reportError } from '../../errors'
  import { patchFiles } from '../../patch-loader'
  import gitlab from '../../plugin'
  import { createHunkLoader, resolveChange, threadLocation } from '../../review-thread'
  import { expansionAfter } from '../../thread-expansion'
  import ErrorText from '../ErrorText.svelte'
  import ActivityFrame from './ActivityFrame.svelte'
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

  // Cut from the stored diff; an outdated thread shows its location only. Each input is its own reactive value, so
  // updates to the thread that keep them (resolve, sync, activity) do not cut the hunk again.
  $: patchFile = patch?.file
  $: path = value.path
  $: line = value.line
  $: oldLine = value.oldLine
  $: outdated = value.isOutdated
  const loadHunk = createHunkLoader(async (file) => await patchFiles({ file }))
  let hunk = ''
  $: void loadHunk({ file: patchFile, path, line, oldLine, outdated }).then((next) => {
    if (next !== undefined) hunk = next
  })

  $: location = threadLocation(value)
  $: frameColor = value.isResolved ? undefined : getPlatformColor(PaletteColorIndexes.Orange, $themeStore.dark)

  let expansion = { expanded: !value.isResolved, resolved: value.isResolved }
  $: expansion = expansionAfter(expansion, value.isResolved)
  $: expanded = expansion.expanded

  function onExpand (next: boolean): void {
    expansion = { ...expansion, expanded: next }
  }

  let actionError: unknown

  function showActionError (err: unknown): void {
    actionError = err
    reportError(err)
  }

  async function reply (event: CustomEvent<Markup>): Promise<void> {
    actionError = undefined
    try {
      await client.addCollection(
        gitlab.class.GitlabReviewComment,
        value.space,
        mergeRequest,
        value.attachedToClass,
        'reviewComments',
        { discussionId: value.discussionId, body: event.detail }
      )
    } catch (err: unknown) {
      showActionError(err)
    }
  }

  // The GitLab service resolves or reopens the discussion in GitLab
  async function toggleResolved (): Promise<void> {
    actionError = undefined
    try {
      await client.update(value, resolveChange(value.isResolved, getCurrentAccount().primarySocialId))
    } catch (err: unknown) {
      showActionError(err)
    }
  }
</script>

<ActivityFrame color={frameColor}>
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
          {#if readonly !== true}
            <div class="ml-4 mr-4">
              <ReferenceInput showSend showHeader showActions on:message={reply} />
            </div>
          {/if}
          <div class="p-2 flex-row-center">
            {#if readonly !== true}
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
          {#if actionError !== undefined}
            <div class="p-2"><ErrorText error={actionError} /></div>
          {/if}
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
</ActivityFrame>

<style lang="scss">
  .thread {
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    overflow-y: hidden;
  }
</style>
