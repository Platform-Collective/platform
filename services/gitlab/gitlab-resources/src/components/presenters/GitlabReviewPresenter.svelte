<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { ActivityMessageHeader, ActivityMessageTemplate } from '@hcengineering/activity-resources'
  import { type Person } from '@hcengineering/contact'
  import { getPersonByPersonIdCb } from '@hcengineering/contact-resources'
  import { type WithLookup } from '@hcengineering/core'
  import { type GitlabReview } from '@hcengineering/gitlab'
  import { PaletteColorIndexes, getPlatformColor, themeStore } from '@hcengineering/ui'
  import gitlab from '../../plugin'
  import { reviewLook } from '../../review-look'

  export let value: WithLookup<GitlabReview>
  export let showNotify = false
  export let isHighlighted = false
  export let isSelected = false
  export let shouldScroll = false
  export let embedded = false
  export let onClick: (() => void) | undefined = undefined

  let person: Person | undefined
  $: getPersonByPersonIdCb(value.createdBy ?? value.modifiedBy, (p) => {
    person = p ?? undefined
  })
  $: look = reviewLook(value.state, value.syncError != null)
  $: color = look.color !== undefined ? getPlatformColor(PaletteColorIndexes[look.color], $themeStore.dark) : undefined
</script>

<div class:framed={color !== undefined} style:border-color={color}>
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
        label={gitlab.string[look.label]}
      />
    </svelte:fragment>
    <svelte:fragment slot="content">
      {#if value.syncError != null}
        <div class="sync-error">{value.syncError}</div>
      {/if}
    </svelte:fragment>
  </ActivityMessageTemplate>
</div>

<style lang="scss">
  .framed {
    border: 1px solid;
    border-radius: 0.5rem;
    margin: 0.25rem 0;
  }
  .sync-error {
    color: var(--theme-error-color);
  }
</style>
