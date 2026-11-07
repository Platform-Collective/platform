<!--
// Copyright © 2022 Hardcore Engineering Inc.
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
  import { Analytics } from '@hcengineering/analytics'
  import type { Class, Doc, Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import type { KeyedAttribute } from '@hcengineering/presentation'
  import type { TagElement, TagReference } from '@hcengineering/tags'
  import tags from '../plugin'
  import TagsEditor from './TagsEditor.svelte'
  import { addTagReference } from '../tag-reference'

  export let object: Doc
  export let _class: Ref<Class<Doc>>
  export let key: KeyedAttribute
  export let readonly: boolean = false

  const client = getClient()

  let items: TagReference[] = []
  const query = createQuery()

  $: query.query(
    tags.class.TagReference,
    { attachedTo: object._id, attachedToClass: _class, collection: key.key },
    (result) => {
      items = result
    },
    { sort: { weight: -1, title: 1 } }
  )

  async function addRef(tag: TagElement): Promise<void> {
    await addTagReference(client, object, tag, key.key, _class)
  }

  const pendingToggles = new Map<string, Promise<void>>()

  async function toggleTag(tag: TagElement, selected: boolean): Promise<void> {
    const origin = { object: { ...object }, referenceClass: _class, collection: key.key }
    const scopeKey = JSON.stringify([origin.object._id, origin.referenceClass, origin.collection, tag._id])
    const previous = pendingToggles.get(scopeKey)
    // Preserve click order and permit later intent after a failed operation.
    const operation = (async () => {
      if (previous !== undefined) await previous.catch(() => {})
      if (selected) {
        await addTagReference(client, origin.object, tag, origin.collection, origin.referenceClass)
      } else {
        // The add can finish before LiveQuery reports its reference, so remove from fresh state too.
        const result = await client.findAllPage(
          tags.class.TagReference,
          {
            attachedTo: origin.object._id,
            attachedToClass: origin.referenceClass,
            collection: origin.collection,
            tag: tag._id
          },
          { limit: 1 }
        )
        const reference = result.docs[0]
        if (reference !== undefined) {
          await client.removeCollection(
            tags.class.TagReference,
            reference.space,
            reference._id,
            origin.object._id,
            origin.referenceClass,
            origin.collection
          )
        }
      }
    })()
    pendingToggles.set(scopeKey, operation)
    try {
      await operation
    } finally {
      if (pendingToggles.get(scopeKey) === operation) pendingToggles.delete(scopeKey)
    }
  }

  async function removeTag(id: Ref<TagReference>): Promise<void> {
    await client.removeCollection(tags.class.TagReference, object.space, id, object._id, _class, key.key)
  }

  async function updateWeight(tag: TagReference, weight: TagReference['weight']): Promise<void> {
    await client.update(tag, { weight })
  }

  function handleError(error: unknown): void {
    Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
  }
</script>

<TagsEditor
  {key}
  {readonly}
  bind:items
  targetClass={_class}
  onToggle={toggleTag}
  on:open={(evt) => {
    void addRef(evt.detail).catch(handleError)
  }}
  on:delete={(evt) => {
    void removeTag(evt.detail).catch(handleError)
  }}
  on:change={(evt) => {
    void updateWeight(evt.detail.tag, evt.detail.weight).catch(handleError)
  }}
/>
