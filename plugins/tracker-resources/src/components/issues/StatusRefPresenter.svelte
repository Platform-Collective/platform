<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import { Ref, Status } from '@hcengineering/core'
  import { getStatusProjectType } from './status-project-type'
  import { Project } from '@hcengineering/tracker'
  import { statusStore } from '@hcengineering/view-resources'
  import StatusPresenter from './StatusPresenter.svelte'
  import {
    selectedTaskTypeStore,
    selectedTypeStore,
    typeStore,
    typesOfJoinedProjectsStore
  } from '@hcengineering/task-resources'

  export let value: Ref<Status> | undefined
  export let space: Ref<Project>
  export let size: 'small' | 'medium' = 'medium'
  export let kind: 'list-header' | undefined = undefined
  export let colorInherit: boolean = false
  export let accent: boolean = false

  $: statusValue = value ? $statusStore.byId.get(value) : undefined

  // Without a space (e.g. All issues group headers and kanban columns) take the status color and icon
  // from a project type instead of falling back to the category color.
  // Mirrors getStatusProjectType from the status filter: the selected project type wins, otherwise a joined
  // project type that configures a color or icon for the status, otherwise the first joined one containing it.
  $: projectType =
    space === undefined && value !== undefined
      ? getStatusProjectType(value, $selectedTypeStore, $typeStore, $typesOfJoinedProjectsStore ?? [])
      : undefined
</script>

<StatusPresenter
  {space}
  {projectType}
  value={statusValue}
  {size}
  {kind}
  {colorInherit}
  {accent}
  on:accent-color
  taskType={$selectedTaskTypeStore}
/>
