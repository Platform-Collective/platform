<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import { mergeStatusLabel } from '../../merge-status'

  export let value: string | undefined
  export let accent = false

  $: label = value !== undefined ? mergeStatusLabel(value, false) : undefined
</script>

{#if label !== undefined}
  <div class="p-1" class:fs-bold={accent}>
    <Label {label} />
  </div>
{/if}
