<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { Integration as AccountIntegration } from '@hcengineering/account-client'
  import Connect from './Connect.svelte'

  export let integration: AccountIntegration | undefined = undefined
</script>

<Connect {integration} on:close on:changeContent />
