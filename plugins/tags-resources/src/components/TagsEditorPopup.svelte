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
  import type { Class, Doc, Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tags, { TagsEvents } from '@hcengineering/tags'
  import type { TagElement } from '@hcengineering/tags'
  import { getObjectId } from '@hcengineering/view-resources'
  import { addTagReference } from '../tag-reference'
  import TagsPopup from './TagsPopup.svelte'

  export let object: Doc
  export let targetClass: Ref<Class<Doc>> | undefined = undefined
  export let attachedToClass: Ref<Class<Doc>> | undefined = undefined
  export let collection: string = 'labels'

  let selected: Ref<TagElement>[] = []
  const query = createQuery()
  $: referenceClass = attachedToClass ?? object._class
  $: tagTargetClass = targetClass ?? object._class
  // A new scope object also distinguishes leaving and returning to the same document.
  $: scope = { object: { ...object }, referenceClass, collection }
  $: query.query(
    tags.class.TagReference,
    { attachedTo: object._id, attachedToClass: referenceClass, collection },
    (result) => {
      selected = result.map(({ tag }) => tag)
    }
  )
  const client = getClient()
  const hierarchy = client.getHierarchy()
  async function addRef(tag: TagElement): Promise<void> {
    const origin = scope
    if (!(await addTagReference(client, origin.object, tag, origin.collection, origin.referenceClass))) return

    if (scope === origin && !selected.includes(tag._id)) selected = [...selected, tag._id]
    const id = await getObjectId(origin.object, hierarchy)
    Analytics.handleEvent(TagsEvents.TagCreated, { objectId: id, objectClass: origin.object._class })
  }

  async function removeTag(tag: TagElement): Promise<void> {
    const origin = scope
    const tagRef = await client.findOne(tags.class.TagReference, {
      tag: tag._id,
      attachedTo: origin.object._id,
      attachedToClass: origin.referenceClass,
      collection: origin.collection
    })
    if (tagRef !== undefined) {
      await client.remove(tagRef)
      if (scope === origin) selected = selected.filter((id) => id !== tag._id)
      const id = await getObjectId(origin.object, hierarchy)
      Analytics.handleEvent(TagsEvents.TagRemoved, { objectId: id, objectClass: origin.object._class })
    }
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

<TagsPopup targetClass={tagTargetClass} {selected} on:update={onUpdate} />
