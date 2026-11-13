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
  import { Icon, IconEdit, Component } from '@hcengineering/ui'
  import { ObjectPresenter } from '@hcengineering/view-resources'
  import { getClient } from '@hcengineering/presentation'
  import { Doc, Ref, Space } from '@hcengineering/core'
  import { AttributeModel } from '@hcengineering/view'
  import { DocAttributeUpdates, DocUpdateMessageViewlet } from '@hcengineering/activity'

  import { getAttributeValues, isUnresolvedObjectRef } from '../../../activityMessagesUtils'

  type Values = DocAttributeUpdates['set' | 'added' | 'removed']
  export let viewlet: DocUpdateMessageViewlet | undefined
  export let attributeModel: AttributeModel
  export let values: Values
  export let preview = false
  export let space: Ref<Space> | undefined = undefined

  const client = getClient()

  let attributeValues: Values | Doc[] = []
  let resolvedFor: Values | undefined

  $: void resolveValues(values, attributeModel)

  async function resolveValues(values: Values, attributeModel: AttributeModel): Promise<void> {
    const result = await getAttributeValues(client, values, attributeModel._class)
    attributeValues = result
    resolvedFor = values
  }

  // A reference shown with an object presenter whose value is not a document, e.g. a cleared parent issue
  $: unresolved = resolvedFor === values && isUnresolvedObjectRef(client, attributeModel, attributeValues)

  $: attrViewletConfig = viewlet?.config?.[attributeModel.key]
  $: attributeIcon = attrViewletConfig?.icon ?? attributeModel.icon ?? IconEdit
  $: _space = space ?? (typeof attributeValues[0] === 'object' ? attributeValues[0]?.space : undefined)
</script>

<div class="content overflow-label" class:preview>
  <span class="mr-1">
    {#if attrViewletConfig?.iconPresenter}
      <Component
        is={attrViewletConfig?.iconPresenter}
        props={{ value: attributeValues[0], space: _space, size: 'small' }}
      />
    {:else}
      <Icon icon={attributeIcon} size="small" />
    {/if}
  </span>

  <slot name="text" {unresolved} />

  {#if !unresolved}
    {#each attributeValues as value}
      <span class="strong overflow-label">
        {#if value !== null && typeof value === 'object'}
          <ObjectPresenter {value} shouldShowAvatar={false} accent />
        {:else}
          <svelte:component
            this={attributeModel.presenter}
            {value}
            shouldShowAvatar={false}
            accent
            kind="list-header"
          />
        {/if}
      </span>
    {/each}
  {/if}
</div>

<style lang="scss">
  .content {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.25rem;
    color: var(--global-primary-TextColor);

    &.preview {
      flex-wrap: nowrap;
    }
  }
</style>
