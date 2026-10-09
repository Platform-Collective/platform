<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import { mergeStatusKey } from '../../merge-status'
  import gitlab from '../../plugin'

  export let value: string | undefined
  export let accent = false

  $: key = value !== undefined ? mergeStatusKey(value, false) : undefined
</script>

{#if key !== undefined}
  <div class="p-1" class:fs-bold={accent}>
    <Label label={gitlab.string[key]} />
  </div>
{/if}
