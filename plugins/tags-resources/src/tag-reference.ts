// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref, TxOperations } from '@hcengineering/core'
import tags from '@hcengineering/tags'
import type { TagElement, TagReference } from '@hcengineering/tags'

// Editors share reservations through the stable clientProxy identity returned by getClient().
const pendingReferences = new WeakMap<
  Pick<TxOperations, 'findAllPage' | 'addCollection'>,
  Map<Ref<Doc>, Array<Pick<TagReference, 'tag' | 'attachedToClass' | 'collection'>>>
>()

/** Check tag identity within an editor's references or draft. */
export function hasTagReference (
  references: ReadonlyArray<Pick<TagReference, 'tag'>>,
  tag: Pick<TagElement, '_id'>
): boolean {
  return references.some((ref) => ref.tag === tag._id)
}

/**
 * Add a tag reference once, including while another editor is still attaching it.
 * Duplicates silently return false. An in-flight duplicate does not wait for the original
 * caller's result or retry if that caller fails; the original caller handles the error.
 * Each nonreserved attempt reads one fresh page (at most one reference) through the connection.
 * Reservations cover that read and write; this is not cross-client/server uniqueness.
 */
export async function addTagReference (
  client: Pick<TxOperations, 'findAllPage' | 'addCollection'>,
  object: Pick<Doc, '_id' | '_class' | 'space'>,
  tag: TagElement,
  collection = 'labels',
  attachedToClass: Ref<Class<Doc>> = object._class
): Promise<boolean> {
  let documents = pendingReferences.get(client)
  if (documents === undefined) {
    documents = new Map()
    pendingReferences.set(client, documents)
  }
  const pending = documents.get(object._id) ?? []
  if (
    pending.some(
      (ref) => ref.tag === tag._id && ref.attachedToClass === attachedToClass && ref.collection === collection
    )
  ) {
    return false
  }

  const reference = { tag: tag._id, attachedToClass, collection }
  pending.push(reference)
  documents.set(object._id, pending)
  try {
    // UIClient.findAll reuses LiveQuery results, which can lag behind a completed write.
    // The paged API reads through the connection without that cache or clearing other queries.
    const existing = await client.findAllPage(
      tags.class.TagReference,
      { attachedTo: object._id, attachedToClass, collection, tag: tag._id },
      { limit: 1 }
    )
    if (hasTagReference(existing.docs, tag)) return false

    await client.addCollection(tags.class.TagReference, object.space, object._id, attachedToClass, collection, {
      tag: tag._id,
      title: tag.title,
      color: tag.color
    })
    return true
  } finally {
    pending.splice(pending.indexOf(reference), 1)
    if (pending.length === 0) documents.delete(object._id)
  }
}
