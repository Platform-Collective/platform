<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  import { TimeSpendReport } from '@hcengineering/tracker'
  import { floorFractionDigits } from '@hcengineering/ui'
  import TimePresenter from './TimePresenter.svelte'

  export let docs: TimeSpendReport[] = []
  export let allDocs: Doc[] = []

  // Do not open a workspace-sized subscription for every group. Only show an
  // exact total when the list has loaded every report belonging to the group.
  $: total = docs.length === allDocs.length
    ? floorFractionDigits(docs.reduce((sum, it) => sum + (it.value ?? 0), 0), 3)
    : undefined
</script>

{#if total !== undefined}
  <TimePresenter value={total} hoursOnly accent />
{/if}
