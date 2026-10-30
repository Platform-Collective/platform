<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import love, { Floor, MeetingMinutes } from '@hcengineering/love'
  import { ObjectPresenter, openDoc } from '@hcengineering/view-resources'
  import view from '@hcengineering/view'
  import { ActionIcon } from '@hcengineering/ui'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import type { Doc, Ref } from '@hcengineering/core'
  import FloorAttributePresenter from './FloorAttributePresenter.svelte'

  export let object: MeetingMinutes

  const client = getClient()
  const docQuery = createQuery()

  let doc: Doc | undefined

  $: docQuery.query(object.attachedToClass, { _id: object.attachedTo }, (r) => {
    doc = r.shift()
  })
  $: floorId = doc?._class === love.class.Floor ? (doc._id as Ref<Floor>) : undefined
</script>

{#if doc}
  {#if floorId !== undefined}
    <FloorAttributePresenter value={floorId} />
  {:else}
    <span class="label flex-row-center flex-gap-4 no-word-wrap">
      <ObjectPresenter
        objectId={doc._id}
        _class={doc._class}
        value={doc}
        shouldShowAvatar={false}
        disabled
        props={{ type: 'text' }}
      />
      <ActionIcon
        icon={view.icon.Open}
        size={'small'}
        action={async () => {
          if (doc === undefined) return
          await openDoc(client.getHierarchy(), doc)
        }}
      />
    </span>
  {/if}
{/if}
