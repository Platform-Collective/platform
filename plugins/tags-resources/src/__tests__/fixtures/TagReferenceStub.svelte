<!-- SPDX-License-Identifier: EPL-2.0 -->
<!-- Only renders the reference supplied by the real parent. -->
<script lang="ts">
  import type { TagReference } from '@hcengineering/tags'

  export let value: TagReference | undefined = undefined
  export let tag: TagReference | undefined = undefined
</script>

<span data-reference={(value ?? tag)?._id}>{(value ?? tag)?.title}</span>
