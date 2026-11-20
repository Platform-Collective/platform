<!--
// Copyright © 2022-2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { Doc } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import { Issue } from '@hcengineering/tracker'
  import { floorFractionDigits, Label } from '@hcengineering/ui'
  import { ViewOptions } from '@hcengineering/view'
  import { FixedColumn, statusStore } from '@hcengineering/view-resources'
  import { calcIssueTimeStats, calcPlanningIssueTimeStats, getIssueStatsQueryBatches } from '../../issueTimeStats'
  import tracker from '../../plugin'
  import EstimationProgressCircle from '../issues/timereport/EstimationProgressCircle.svelte'
  import TimePresenter from '../issues/timereport/TimePresenter.svelte'
  export let docs: Issue[] | undefined = undefined
  // All documents of the group, docs may hold only the loaded part of it.
  export let allDocs: Doc[] | undefined = undefined
  export let viewOptions: ViewOptions | undefined = undefined
  export let capacity: number | undefined = undefined
  export let category: string | undefined = undefined

  $: planning = category === 'milestone' || category === 'assignee'
  $: showSum = viewOptions?.showEstimationSum === true
  $: show = docs !== undefined && (planning || showSum)

  const client = getClient()
  let fetched: Issue[] | undefined = undefined
  let fetchSeq = 0

  let fetchedIds = new Set<Issue['_id']>()
  let hasFetchedGroup = false

  $: void fetchGroup(showSum ? allDocs : undefined)

  async function fetchGroup(group: Doc[] | undefined): Promise<void> {
    if (group === undefined) {
      if (!hasFetchedGroup) return
      hasFetchedGroup = false
      fetchedIds = new Set()
      fetchSeq++
      fetched = undefined
      return
    }

    const ids = group.map((it) => it._id as Issue['_id'])
    if (hasFetchedGroup && ids.length === fetchedIds.size && ids.every((id) => fetchedIds.has(id))) return

    hasFetchedGroup = true
    fetchedIds = new Set(ids)
    const seq = ++fetchSeq
    fetched = undefined

    const loadedIds = new Set((docs ?? []).map((it) => it._id))
    const missingIds = ids.filter((id) => !loadedIds.has(id))
    if (missingIds.length === 0) return

    const responses = await Promise.all(
      getIssueStatsQueryBatches(missingIds).map((batch) =>
        client.findAll(
          tracker.class.Issue,
          { _id: { $in: batch } },
          {
            projection: {
              _id: 1,
              _class: 1,
              space: 1,
              attachedTo: 1,
              parents: 1,
              status: 1,
              estimation: 1,
              reportedTime: 1,
              childInfo: 1
            }
          }
        )
      )
    )
    if (seq === fetchSeq) {
      fetched = responses.flat()
    }
  }

  // Prefer the live loaded rows, fetched data only completes them.
  $: loaded = new Map((docs ?? []).map((it) => [it._id, it]))
  $: groupDocs =
    fetched !== undefined ? [...loaded.values(), ...fetched.filter((it) => !loaded.has(it._id))] : (docs ?? [])

  $: statsOptions = {
    isUnStarted: (it: Issue) => $statusStore.byId.get(it.status)?.category === task.statusCategory.UnStarted,
    isClosed: (it: Issue) => {
      const cat = $statusStore.byId.get(it.status)?.category
      return cat === task.statusCategory.Won || cat === task.statusCategory.Lost
    },
    skipUnStarted: planning,
    includeAllChildren: viewOptions?.shouldShowSubIssues === false
  }
  $: stats =
    planning && !showSum
      ? calcPlanningIssueTimeStats(docs ?? [], statsOptions)
      : calcIssueTimeStats(groupDocs, statsOptions)
  $: totalEstimation = floorFractionDigits(stats.estimation, 3)
  $: totalReported = floorFractionDigits(stats.reportedTime, 3)
</script>

{#if show}
  <FixedColumn key="estimation-editor">
    <!-- <Label label={tracker.string.MilestoneDay} value={}/> -->
    <div class="flex-row-center flex-no-shrink h-6" class:showWarning={totalEstimation > (capacity ?? 0)}>
      <EstimationProgressCircle value={totalReported} max={totalEstimation} />
      <div class="w-2 min-w-2" />
      {#if totalReported > 0}
        <TimePresenter value={totalReported} />
        /
      {/if}
      <TimePresenter value={totalEstimation} />
      {#if capacity}
        <Label label={tracker.string.CapacityValue} params={{ value: capacity }} />
      {/if}
    </div>
  </FixedColumn>
{/if}
