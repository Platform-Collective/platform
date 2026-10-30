<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type GitlabMergeRequestState } from '@hcengineering/gitlab'
  import { type IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import gitlab from '../../plugin'

  export let value: GitlabMergeRequestState | undefined
  export let accent = false

  const labels: Record<GitlabMergeRequestState, IntlString> = {
    opened: gitlab.string.StateOpened,
    merged: gitlab.string.StateMerged,
    closed: gitlab.string.StateClosed,
    locked: gitlab.string.StateLocked
  }
</script>

{#if value !== undefined}
  <div class="p-1" class:fs-bold={accent}>
    <Label label={labels[value]} />
  </div>
{/if}
