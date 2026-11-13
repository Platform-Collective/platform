<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import ui, { Label, themeStore } from '@hcengineering/ui'
  import time from '../plugin'

  export let blockers: string[] = []
  export let startDate: number | undefined = undefined
</script>

<div class="flex-col flex-gap-1">
  {#if blockers.length > 0}
    <Label label={time.string.BlockedBy} params={{ issues: blockers.slice(0, 3).join(', ') }} />
  {/if}
  {#if blockers.length > 3}
    <Label label={ui.string.MoreCount} params={{ count: blockers.length - 3 }} />
  {/if}
  {#if startDate !== undefined}
    <Label
      label={time.string.StartsOn}
      params={{ date: new Date(startDate).toLocaleDateString($themeStore.language) }}
    />
  {/if}
</div>
