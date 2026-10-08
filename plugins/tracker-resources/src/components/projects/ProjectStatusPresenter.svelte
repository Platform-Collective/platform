<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { SortingOrder } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import type { Project, ProjectStatusUpdate } from '@hcengineering/tracker'

  import tracker from '../../plugin'
  import ProjectStatusPill from './ProjectStatusPill.svelte'

  // The latest status of a project, a column of the project list
  export let value: Project

  const query = createQuery()
  let latest: ProjectStatusUpdate | undefined

  $: query.query(
    tracker.class.ProjectStatusUpdate,
    { space: value._id },
    (res) => {
      latest = res[0]
    },
    { sort: { createdOn: SortingOrder.Descending }, limit: 1 }
  )
</script>

{#if latest !== undefined}
  <ProjectStatusPill status={latest.status} />
{/if}
