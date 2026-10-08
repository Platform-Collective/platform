<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { DocumentQuery, FindOptions, Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import type { Issue, Project } from '@hcengineering/tracker'
  import { Label, themeStore } from '@hcengineering/ui'
  import { readable } from 'svelte/store'

  import { resolveFieldSums, sumProjection, type SummableField } from '../../fieldSum/config'
  import { loadSummableFields } from '../../fieldSum/load'
  import { computeFieldSums, formatFieldSums } from '../../fieldSum/sum'
  import tracker from '../../plugin'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import { exceedsScanLimit } from '../../projectFields/query'
  import { buildRegistry } from '../../projectFields/registry'

  // Totals of the number fields of the view over everything the view shows (the footer of the table).
  // The items are read by a bounded scan; above the limit the totals are not shown, never computed on a part.
  export let project: Ref<Project> | undefined = undefined
  export let query: DocumentQuery<Issue> = {}
  // Options of the view that narrow the result, e.g. archived items
  export let options: FindOptions<Issue> = {}
  // Keys of the fields to sum (the view option `fieldSums`)
  export let keys: string[] = []
  export let scanLimit: number

  const emptyRegistry = readable(buildRegistry([]))
  $: registry = project !== undefined ? sharedProjectFieldsStore(project) : emptyRegistry

  let available: SummableField[] = []
  $: void loadSummableFields($registry.fields, $themeStore.language).then((res) => {
    available = res
  })
  $: fields = resolveFieldSums(keys, available)

  function withoutLookup (q: DocumentQuery<Issue>): DocumentQuery<Issue> {
    const res: DocumentQuery<Issue> = {}
    for (const [k, v] of Object.entries(q)) {
      if (!k.startsWith('$lookup.')) (res as any)[k] = v
    }
    return res
  }

  let docs: Array<Partial<Issue>> = []
  let ready = false
  const itemsQuery = createQuery()
  $: if (fields.length > 0) {
    const projection: Record<string, 1> = { _id: 1 }
    for (const key of sumProjection(keys)) projection[key] = 1
    itemsQuery.query(
      tracker.class.Issue,
      withoutLookup(query),
      (res) => {
        docs = res
        ready = true
      },
      { ...options, limit: scanLimit + 1, projection }
    )
  } else {
    itemsQuery.unsubscribe()
    docs = []
    ready = false
  }

  $: tooMany = ready && exceedsScanLimit(docs.length, scanLimit)
  $: text = ready && !tooMany ? formatFieldSums(computeFieldSums(docs, fields)) : undefined
</script>

{#if fields.length > 0 && ready}
  <div class="field-sum-footer" data-id="field-sum-footer">
    {#if tooMany}
      <span class="warning"><Label label={tracker.string.FieldSumScanLimitExceeded} params={{ limit: scanLimit }} /></span>
    {:else if text !== undefined}
      <span class="caption-color"><Label label={tracker.string.FieldSumTotal} /></span>
      <span class="content-dark-color">({docs.length})</span>
      <span class="sums" title={text}>{text}</span>
    {/if}
  </div>
{/if}

<style lang="scss">
  .field-sum-footer {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    padding: 0.375rem 1.5rem;
    font-size: 0.8125rem;
    border-top: 1px solid var(--theme-divider-color);
    background: var(--theme-bg-color);
  }
  .sums {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--theme-content-color);
  }
  .warning {
    color: var(--theme-warning-color, #9a6700);
  }
</style>
