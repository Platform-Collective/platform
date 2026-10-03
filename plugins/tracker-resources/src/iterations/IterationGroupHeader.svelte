<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { formatIterationRange, getIterationState, type Iteration } from '@hcengineering/tracker'
  import { Label, themeStore } from '@hcengineering/ui'

  import tracker from '../plugin'

  // Group header of a list grouped by an Iteration field. The category is an iteration id.
  export let value: string | undefined = undefined
  export let iterations: Iteration[] = []

  $: iteration = iterations.find((it) => it._id === value)
  $: now = Date.now()
  $: range = iteration !== undefined ? formatIterationRange(iteration, now, $themeStore.language) : ''
  $: current = iteration !== undefined && getIterationState(iteration, now) === 'current'
</script>

<span class="fs-bold overflow-label pointer-events-none">{iteration?.label ?? value ?? ''}</span>
{#if iteration !== undefined}
  <span class="ml-2 content-dark-color overflow-label pointer-events-none">{range}</span>
  {#if current}
    <span class="ml-2 content-dark-color pointer-events-none"><Label label={tracker.string.IterationCurrentMarker} /></span>
  {/if}
{/if}
