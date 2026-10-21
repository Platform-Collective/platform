// SPDX-License-Identifier: EPL-2.0

import contact, { type PermissionsStore } from '@hcengineering/contact'
import { generateId, makeCollabId, makeDocCollabId, type Ref, type TxOperations } from '@hcengineering/core'
import document, { type Document, type DocumentSnapshot } from '@hcengineering/document'
import { getResource } from '@hcengineering/platform'
import { createMarkup, getMarkup, updateMarkup } from '@hcengineering/presentation'
import { canChangeAttribute } from '@hcengineering/view-resources'
import { get } from 'svelte/store'

export function canRestoreSnapshot (doc: Document, snapshot: DocumentSnapshot, readonly: boolean): boolean {
  return !readonly && doc.lockedBy == null && snapshot.parent === doc._id
}

export function canEditDocumentContent (
  client: TxOperations,
  doc: Document,
  permissions: PermissionsStore | undefined
): boolean {
  if (doc.lockedBy != null || permissions === undefined) return false
  const attr = client.getHierarchy().getAttribute(doc._class, 'content')
  return canChangeAttribute(attr, doc.space, permissions, doc._class)
}

async function getEditableDocument (client: TxOperations, doc: Document): Promise<Document> {
  const current = await client.findOne(document.class.Document, { _id: doc._id })
  const permissions = get(await getResource(contact.store.Permissions))
  if (current === undefined || !canEditDocumentContent(client, current, permissions)) {
    throw new Error('Document content cannot be edited')
  }
  return current
}

export async function createDocumentSnapshot (client: TxOperations, doc: Document, title: string): Promise<void> {
  const current = await getEditableDocument(client, doc)
  const id: Ref<DocumentSnapshot> = generateId()
  const markup = await getMarkup(makeDocCollabId(current, 'content'), current.content)
  const content = await createMarkup(makeCollabId(document.class.DocumentSnapshot, id, 'content'), markup)
  await client.createDoc(
    document.class.DocumentSnapshot,
    current.space,
    {
      title: title.trim(),
      content,
      parent: current._id
    },
    id
  )
}

export async function restoreDocumentSnapshot (
  client: TxOperations,
  doc: Document,
  snapshot: DocumentSnapshot,
  backupTitle: string
): Promise<void> {
  const current = await getEditableDocument(client, doc)
  if (!canRestoreSnapshot(current, snapshot, false)) {
    throw new Error('Snapshot does not belong to this document')
  }
  const markup = await getMarkup(makeDocCollabId(snapshot, 'content'), snapshot.content)
  await createDocumentSnapshot(client, current, backupTitle)
  await updateMarkup(makeDocCollabId(current, 'content'), markup)
}
