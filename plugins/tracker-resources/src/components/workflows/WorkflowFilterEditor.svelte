<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { createQuery } from '@hcengineering/presentation'
  import {
    WORKFLOW_SCAN_LIMIT,
    WorkflowKind,
    type FilterWorkflowKind,
    type Project
  } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'
  import { FilterQueryBar, type filterGrammar } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import tracker from '../../plugin'
  import { compileWorkflowPreview, countPreviewMatches } from '../../workflows/preview'

  // The filter of a filter workflow with the number of items it matches now. The grammar, the field schema and the
  // rules are those of the server, so the number is what the next run would find (a run changes at most a hundred).
  export let project: Project
  export let kind: FilterWorkflowKind
  // The applied filter text
  export let filter: string
  export let schema: filterGrammar.FieldSpec[]
  export let ctx: filterGrammar.FilterContext

  const dispatch = createEventDispatcher()
  const scanQuery = createQuery()

  let scanned: unknown[] = []
  let ready = false

  $: compiled = compileWorkflowPreview(kind, filter, schema, ctx)
  $: if (compiled.ok === true) {
    const projection: Record<string, 1> = { _id: 1 }
    for (const key of compiled.projection) projection[key] = 1
    scanQuery.query(
      tracker.class.Issue,
      { space: project._id, ...compiled.query } as any,
      (res) => {
        scanned = res
        ready = true
      },
      { limit: WORKFLOW_SCAN_LIMIT, projection }
    )
  } else {
    scanQuery.unsubscribe()
    scanned = []
    ready = false
  }
  $: counted = compiled.ok === true && ready ? countPreviewMatches(compiled, scanned, WORKFLOW_SCAN_LIMIT) : undefined
</script>

<FilterQueryBar
  value={filter}
  {schema}
  on:apply={(e) => {
    dispatch('apply', e.detail)
  }}
/>
<div class="content-dark-color" data-id="workflow-preview" data-kind={kind}>
  {#if compiled.ok === false}
    {#if compiled.reason === 'empty'}
      <Label label={tracker.string.WorkflowFilterRequired} />
    {:else}
      <span class="error-color"><Label label={tracker.string.WorkflowFilterInvalid} /></span>
    {/if}
  {:else if counted !== undefined}
    {#if counted.over}
      <Label label={tracker.string.WorkflowPreviewOver} params={{ count: counted.count }} />
    {:else}
      <Label
        label={kind === WorkflowKind.AutoAddFromQuery
          ? tracker.string.WorkflowPreviewArchived
          : tracker.string.WorkflowPreviewActive}
        params={{ count: counted.count }}
      />
    {/if}
  {/if}
</div>
