<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import type { Project } from '@hcengineering/tracker'
  import { Button, eventToHTMLElement, IconFilter, showPopup } from '@hcengineering/ui'

  import tracker from '../plugin'
  import { customFieldFilterStore } from './customFieldView'
  import CustomFieldFilterPopup from './CustomFieldFilterPopup.svelte'
  import { activeFilterCount } from './query'

  export let space: Ref<Project>

  $: filtersStore = customFieldFilterStore(space)
  $: count = activeFilterCount($filtersStore)

  function open (event: MouseEvent): void {
    showPopup(CustomFieldFilterPopup, { space }, eventToHTMLElement(event))
  }
</script>

<Button
  icon={IconFilter}
  label={tracker.string.CustomFieldFilter}
  kind={count > 0 ? 'primary' : 'regular'}
  size={'medium'}
  showTooltip={{ label: tracker.string.CustomFieldFilter }}
  on:click={open}
/>
