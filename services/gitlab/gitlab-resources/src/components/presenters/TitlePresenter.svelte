<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type WithLookup } from '@hcengineering/core'
  import { type GitlabMergeRequest } from '@hcengineering/gitlab'
  import { TitlePresenter } from '@hcengineering/tracker-resources'

  export let value: WithLookup<GitlabMergeRequest>
  export let shouldUseMargin: boolean = false
  export let showParent = true
  export let kind: 'list' | undefined = undefined
  export let onClick: (() => void) | undefined = undefined
  export let disabled = false
</script>

{#if value}
  <TitlePresenter {value} {shouldUseMargin} {showParent} {kind} {onClick} {disabled} />
{/if}
