<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Label, themeStore } from '@hcengineering/ui'
  import time from '../plugin'

  export let blockers: string[] = []
  export let startDate: number | undefined = undefined
</script>

<div class="flex-col flex-gap-1">
  {#if blockers.length > 0}
    <Label label={time.string.BlockedBy} params={{ issues: blockers.join(', ') }} />
  {/if}
  {#if startDate !== undefined}
    <Label label={time.string.StartsOn} params={{ date: new Date(startDate).toLocaleString($themeStore.language) }} />
  {/if}
</div>
