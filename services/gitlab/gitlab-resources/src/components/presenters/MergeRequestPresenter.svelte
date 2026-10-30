<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type WithLookup } from '@hcengineering/core'
  import gitlab, { type GitlabMergeRequest } from '@hcengineering/gitlab'
  import { IssuePresenter } from '@hcengineering/tracker-resources'

  export let value: WithLookup<GitlabMergeRequest>
  export let disabled = false
  export let onClick: (() => void) | undefined = undefined
  export let shouldShowAvatar: boolean = false
  export let noUnderline = false
  export let inline = false
  export let kind: 'list' | undefined = undefined
</script>

<IssuePresenter
  {value}
  {disabled}
  {onClick}
  {shouldShowAvatar}
  {noUnderline}
  {inline}
  {kind}
  icon={gitlab.icon.MergeRequest}
/>
