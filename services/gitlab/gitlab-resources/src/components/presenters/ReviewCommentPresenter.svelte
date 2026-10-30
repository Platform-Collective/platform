<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type Person } from '@hcengineering/contact'
  import { Avatar, EmployeePresenter, SystemAvatar, getPersonByPersonIdCb } from '@hcengineering/contact-resources'
  import core, { getDisplayTime } from '@hcengineering/core'
  import { type GitlabReviewComment } from '@hcengineering/gitlab'
  import { MessageViewer } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'

  export let comment: GitlabReviewComment

  let person: Person | undefined
  $: getPersonByPersonIdCb(comment.createdBy ?? comment.modifiedBy, (p) => {
    person = p ?? undefined
  })
</script>

<div>
  <div class="flex-row-center">
    <div class="min-w-6 mt-1">
      {#if person !== undefined}
        <Avatar size="tiny" {person} name={person.name} />
      {:else}
        <SystemAvatar size="tiny" />
      {/if}
    </div>
    <div class="header clear-mins flex-row-center">
      {#if person !== undefined}
        <EmployeePresenter value={person} shouldShowAvatar={false} />
      {:else}
        <div class="strong"><Label label={core.string.System} /></div>
      {/if}
      <span class="text-sm ml-2">{getDisplayTime(comment.createdOn ?? 0)}</span>
    </div>
  </div>
  <div class="p-2">
    <MessageViewer message={comment.body} />
  </div>
</div>
