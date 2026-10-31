<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type Asset } from '@hcengineering/platform'
  import { Icon } from '@hcengineering/ui'
  import { safeHttpUrl } from '../safe-url'

  export let icon: Asset
  // Mirrored from GitLab: rendered only as an http(s) link
  export let url: string | undefined
  export let repository: string
  // '#12' for an issue, '!3' for a merge request
  export let reference: string
</script>

<a class="flex-row-center" href={safeHttpUrl(url)} target="_blank" rel="noopener noreferrer">
  <Icon {icon} size={'small'} />
  <span class="ml-1">{repository} {reference}</span>
</a>
