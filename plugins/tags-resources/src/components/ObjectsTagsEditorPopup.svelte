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
  import { Analytics } from '@hcengineering/analytics'
  import type { Doc, Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tags from '@hcengineering/tags'
  import type { TagElement } from '@hcengineering/tags'
  import TagsPopup from './TagsPopup.svelte'
  import { addTagReference } from '../tag-reference'

  export let value: Doc | Doc[]
  $: objects = Array.isArray(value) ? value : [value]

  let selected: Ref<TagElement>[] = []
  const query = createQuery()
  $: query.query(
    tags.class.TagReference,
    {
      attachedTo: { $in: objects.map((object) => object._id) },
      attachedToClass: { $in: objects.map((object) => object._class) },
      collection: 'labels'
    },
    (result) => {
      const classesByDocument = new Map(objects.map((object) => [object._id, object._class]))
      const documentsByTag = new Map<Ref<TagElement>, Set<Ref<Doc>>>()
      for (const reference of result) {
        if (classesByDocument.get(reference.attachedTo) !== reference.attachedToClass) continue
        const documents = documentsByTag.get(reference.tag) ?? new Set<Ref<Doc>>()
        documents.add(reference.attachedTo)
        documentsByTag.set(reference.tag, documents)
      }
      selected = Array.from(documentsByTag)
        .filter(([, documents]) => objects.every((object) => documents.has(object._id)))
        .map(([tag]) => tag)
    }
  )

  const client = getClient()
  async function addRef(tag: TagElement): Promise<void> {
    await Promise.all(objects.map((object) => addTagReference(client, object, tag)))
  }
  async function removeTag(tag: TagElement): Promise<void> {
    await Promise.all(
      objects.map(async (object) => {
        const tagRef = await client.findOne(tags.class.TagReference, {
          attachedTo: object._id,
          attachedToClass: object._class,
          collection: 'labels',
          tag: tag._id
        })
        if (tagRef) await client.remove(tagRef)
      })
    )
  }
  function onUpdate(event: CustomEvent<{ action: string, tag: TagElement }>): void {
    const result = event.detail
    if (result === undefined) return
    const operation = result.action === 'add' ? addRef : result.action === 'remove' ? removeTag : undefined
    if (operation !== undefined) {
      void operation(result.tag).catch((error: unknown) => {
        Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
      })
    }
  }
</script>

<TagsPopup targetClass={objects[0]._class} {selected} on:update={onUpdate} />
