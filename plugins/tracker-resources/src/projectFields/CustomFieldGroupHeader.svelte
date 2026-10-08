<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { ProjectFieldOption } from '@hcengineering/tracker'

  // Group header of a list grouped by a single-select custom field. The category is an option id.
  export let value: string | undefined = undefined
  export let options: ProjectFieldOption[] = []

  $: label = options.find((o) => o.value === value)?.label ?? value ?? ''
</script>

<span class="fs-bold overflow-label pointer-events-none">{label}</span>
