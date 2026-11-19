<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import activity, { type ActivityMessage, type DisplayActivityMessage } from '@hcengineering/activity'
  import { createQuery } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  import activityResources from '../../plugin'

  import { getActivityRepliesQueryOptions } from './activity-replies'
  import ActivityMessagePresenter from './ActivityMessagePresenter.svelte'

  export let message: ActivityMessage
  export let readonly = false
  export let onReply: ((message: ActivityMessage) => void) | undefined = undefined

  const query = createQuery()
  let element: HTMLDivElement
  let shouldLoad = false
  let showAll = false
  let replies: DisplayActivityMessage[] = []

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          shouldLoad = true
          observer.disconnect()
        }
      },
      { rootMargin: '200px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  })

  function showAllReplies(): void {
    showAll = true
  }

  $: if (shouldLoad) {
    query.query(
      activity.class.ActivityMessage,
      { attachedTo: message._id, space: message.space, collection: 'replies' },
      (result: DisplayActivityMessage[]): void => {
        replies = [...result].reverse()
      },
      getActivityRepliesQueryOptions(showAll)
    )
  }

  $: remainingReplies = Math.max(0, (message.replies ?? 0) - replies.length)
</script>

<div bind:this={element}>
  {#if replies.length > 0}
    <div class="activity-replies">
      {#if !showAll && remainingReplies > 0}
        <button type="button" class="show-more-replies" on:click={showAllReplies}>
          <Label label={activityResources.string.ShowMoreReplies} params={{ count: remainingReplies }} />
        </button>
      {/if}
      {#each replies as reply (reply._id)}
        <ActivityMessagePresenter value={reply} presentation="reply" skipLabel hideLink hideFooter {readonly} {onReply} />
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .activity-replies {
    margin-top: 0.75rem;
    margin-inline-start: 0.75rem;
    padding-top: 0.5rem;
    padding-inline-start: 0.75rem;
    border-top: 1px solid var(--global-ui-BorderColor);
    border-inline-start: 1px solid var(--global-ui-BorderColor);
  }

  .show-more-replies {
    margin-bottom: 0.5rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--global-ui-BorderColor);
    border-radius: 0.25rem;
    color: var(--theme-link-color);
    background-color: var(--global-surface-01-BackgroundColor);
    font-size: 0.75rem;
    cursor: pointer;

    &:hover {
      background-color: var(--global-ui-BackgroundColor);
    }

    &:focus-visible {
      outline: 2px solid var(--theme-link-color);
      outline-offset: 2px;
    }
  }
</style>
