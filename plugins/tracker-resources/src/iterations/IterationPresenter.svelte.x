<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { getIterationState, formatIterationRange, type Iteration } from '@hcengineering/tracker'
  import { Label, themeStore, tooltip } from '@hcengineering/ui'

  import tracker from '../plugin'

  // Title of an iteration; the dates are in the tooltip
  export let iteration: Iteration

  $: now = Date.now()
  $: current = getIterationState(iteration, now) === 'current'
  $: range = formatIterationRange(iteration, now, $themeStore.language)
</script>

<span
  class="flex-row-center flex-gap-1 overflow-label"
  use:tooltip={{ label: getEmbeddedLabel(range) }}
>
  <span class="overflow-label">{iteration.label}</span>
  {#if current}
    <span class="content-dark-color fs-small"><Label label={tracker.string.IterationCurrentMarker} /></span>
  {/if}
</span>
