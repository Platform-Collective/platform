<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type GitlabMergeRequest } from '@hcengineering/gitlab'
  import MergeRequestApprovals from './MergeRequestApprovals.svelte'
  import MergeRequestDiff from './MergeRequestDiff.svelte'

  export let object: GitlabMergeRequest
</script>

<MergeRequestApprovals mergeRequest={object} />
<MergeRequestDiff mergeRequest={object} />
