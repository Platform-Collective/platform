<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { Attachment } from '@hcengineering/attachment'
  export let attachments: Attachment[] = []
</script>

{#each attachments as attachment (attachment._id)}
  <span data-attachment={attachment.file}>{attachment.name}</span>
{/each}
