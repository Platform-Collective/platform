<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import type { Project } from '@hcengineering/tracker'
  import { themeStore } from '@hcengineering/ui'
  import type { ViewOptions } from '@hcengineering/view'
  import { readable } from 'svelte/store'

  import { readFieldSums, resolveFieldSums, type SummableField } from '../../fieldSum/config'
  import { loadSummableFields } from '../../fieldSum/load'
  import { computeFieldSums, formatFieldSums } from '../../fieldSum/sum'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import { buildRegistry } from '../../projectFields/registry'

  // Sums of the number fields of the view in the header of a group (GitHub's "Field sum"). The list passes the
  // documents of the group, which already are the ones that stay after the filter.
  export let docs: any[] = []
  export let viewOptions: ViewOptions
  export let space: Ref<Project> | undefined = undefined
  // Passed by the list, not needed here
  export let value: unknown = undefined
  export let groupKey: string | undefined = undefined
  void value
  void groupKey

  const emptyRegistry = readable(buildRegistry([]))
  $: registry = space !== undefined ? sharedProjectFieldsStore(space) : emptyRegistry

  let available: SummableField[] = []
  $: void loadSummableFields($registry.fields, $themeStore.language).then((res) => {
    available = res
  })

  $: fields = resolveFieldSums(readFieldSums(viewOptions), available)
  $: text = formatFieldSums(computeFieldSums(docs, fields))
</script>

{#if text !== undefined}
  <span class="field-sums content-dark-color fs-small ml-2" data-id="group-field-sums" title={text}>{text}</span>
{/if}

<style lang="scss">
  .field-sums {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
