<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { ActivityMessageHeader, ActivityMessageTemplate } from '@hcengineering/activity-resources'
  import { type Person } from '@hcengineering/contact'
  import { getPersonByPersonIdCb } from '@hcengineering/contact-resources'
  import { type WithLookup } from '@hcengineering/core'
  import { type GitlabReview } from '@hcengineering/gitlab'
  import { PaletteColorIndexes, getPlatformColor, themeStore } from '@hcengineering/ui'
  import { reviewLook } from '../../review-look'
  import ActivityFrame from './ActivityFrame.svelte'

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

<ActivityFrame {color}>
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
        label={look.label}
      />
    </svelte:fragment>
    <svelte:fragment slot="content">
      {#if value.syncError != null}
        <div class="error-color">{value.syncError}</div>
      {/if}
    </svelte:fragment>
  </ActivityMessageTemplate>
</ActivityFrame>
