// SPDX-License-Identifier: EPL-2.0

import type { Document, DocumentSnapshot } from '@hcengineering/document'
import type { TxOperations } from '@hcengineering/core'
import { createMarkup, getMarkup, updateMarkup } from '@hcengineering/presentation'
import { canChangeAttribute } from '@hcengineering/view-resources'
import { canRestoreSnapshot, createDocumentSnapshot, restoreDocumentSnapshot } from '../snapshots'

jest.mock('@hcengineering/core', () => ({
  generateId: () => 'new-snapshot',
  makeCollabId: (objectClass: string, objectId: string, objectAttr: string) => ({ objectClass, objectId, objectAttr }),
  makeDocCollabId: (doc: Document, objectAttr: string) => ({
    objectClass: doc._class,
    objectId: doc._id,
    objectAttr
  })
}))

jest.mock('@hcengineering/document', () => ({
  __esModule: true,
  default: { class: { Document: 'Document', DocumentSnapshot: 'DocumentSnapshot' } }
}))

jest.mock('@hcengineering/contact', () => ({
  __esModule: true,
  default: { store: { Permissions: 'permissions' } }
}))

jest.mock('@hcengineering/platform', () => ({
  getResource: jest.fn(async () => ({
    subscribe: (fn: (value: object) => void) => {
      fn({})
      return () => {}
    }
  }))
}))

jest.mock('@hcengineering/presentation', () => ({
  createMarkup: jest.fn(),
  getMarkup: jest.fn(),
  updateMarkup: jest.fn()
}))

jest.mock('@hcengineering/view-resources', () => ({
  canChangeAttribute: jest.fn()
}))

jest.mock('svelte/store', () => ({
  get: (store: { subscribe: (fn: (value: object) => void) => () => void }) => {
    let value: object = {}
    store.subscribe((v) => {
      value = v
    })()
    return value
  }
}))

const doc = { _id: 'doc', _class: 'Document', space: 'teamspace', content: 'live-blob' } as unknown as Document
const snapshot = {
  _id: 'snapshot',
  _class: 'DocumentSnapshot',
  parent: doc._id,
  content: 'snapshot-blob'
} as unknown as DocumentSnapshot

function makeClient (): {
  client: TxOperations
  findOne: jest.Mock
  createDoc: jest.Mock
} {
  const findOne = jest.fn().mockResolvedValue(doc)
  const createDoc = jest.fn().mockResolvedValue('new-snapshot')
  const client = {
    findOne,
    createDoc,
    getHierarchy: () => ({ getAttribute: () => ({ name: 'content' }) })
  } as unknown as TxOperations
  return { client, findOne, createDoc }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(canChangeAttribute).mockReturnValue(true)
  jest
    .mocked(getMarkup)
    .mockImplementation(async (id) => (id.objectId === snapshot._id ? 'saved content' : 'live content'))
  jest.mocked(createMarkup).mockResolvedValue('backup-blob' as DocumentSnapshot['content'])
  jest.mocked(updateMarkup).mockResolvedValue(undefined)
})

describe('canRestoreSnapshot', () => {
  it('allows an editable document and its own snapshot', () => {
    expect(canRestoreSnapshot(doc, snapshot, false)).toBe(true)
    expect(canRestoreSnapshot({ ...doc, lockedBy: null }, snapshot, false)).toBe(true)
  })

  it('rejects readonly documents, locks, and snapshots of another document', () => {
    expect(canRestoreSnapshot(doc, snapshot, true)).toBe(false)
    expect(canRestoreSnapshot({ ...doc, lockedBy: 'account' as Document['lockedBy'] }, snapshot, false)).toBe(false)
    expect(canRestoreSnapshot(doc, { ...snapshot, parent: 'other' as Document['_id'] }, false)).toBe(false)
  })
})

describe('createDocumentSnapshot', () => {
  it('copies current collaborative content into a separate snapshot linked by parent', async () => {
    const { client, createDoc } = makeClient()
    await createDocumentSnapshot(client, doc, '  Before restore  ')
    expect(getMarkup).toHaveBeenCalledWith(
      { objectClass: doc._class, objectId: doc._id, objectAttr: 'content' },
      doc.content
    )
    expect(createMarkup).toHaveBeenCalledWith(
      { objectClass: snapshot._class, objectId: 'new-snapshot', objectAttr: 'content' },
      'live content'
    )
    expect(createDoc).toHaveBeenCalledWith(
      'DocumentSnapshot',
      doc.space,
      { title: 'Before restore', content: 'backup-blob', parent: doc._id },
      'new-snapshot'
    )
    expect(updateMarkup).not.toHaveBeenCalled()
  })

  it('does not create a snapshot when the document cannot be edited', async () => {
    const { client, createDoc } = makeClient()
    jest.mocked(canChangeAttribute).mockReturnValue(false)
    await expect(createDocumentSnapshot(client, doc, 'Backup')).rejects.toThrow()
    expect(createDoc).not.toHaveBeenCalled()
    expect(getMarkup).not.toHaveBeenCalled()
  })
})

describe('restoreDocumentSnapshot', () => {
  it('persists a backup before replacing the current collaborative content', async () => {
    const { client, createDoc } = makeClient()
    await restoreDocumentSnapshot(client, doc, snapshot, 'Before restore')
    expect(getMarkup).toHaveBeenCalledWith(
      { objectClass: snapshot._class, objectId: snapshot._id, objectAttr: 'content' },
      snapshot.content
    )
    expect(createDoc).toHaveBeenCalled()
    expect(updateMarkup).toHaveBeenCalledWith(
      { objectClass: doc._class, objectId: doc._id, objectAttr: 'content' },
      'saved content'
    )
    expect(createDoc.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(updateMarkup).mock.invocationCallOrder[0])
  })

  it('waits for the backup to finish before updating the live document', async () => {
    const { client, createDoc } = makeClient()
    let finishBackup: () => void = () => {}
    const backup = new Promise<void>((resolve) => {
      finishBackup = resolve
    })
    const backupStarted = new Promise<void>((resolve) => {
      createDoc.mockImplementationOnce(() => {
        resolve()
        return backup
      })
    })
    const restoring = restoreDocumentSnapshot(client, doc, snapshot, 'Before restore')
    await backupStarted
    expect(updateMarkup).not.toHaveBeenCalled()
    finishBackup()
    await restoring
    expect(updateMarkup).toHaveBeenCalled()
  })

  it.each(['missing', 'locked', 'forbidden', 'wrong parent'])('does not restore when %s', async (reason) => {
    const { client, findOne, createDoc } = makeClient()
    if (reason === 'missing') findOne.mockResolvedValue(undefined)
    if (reason === 'locked') findOne.mockResolvedValue({ ...doc, lockedBy: 'account' })
    if (reason === 'forbidden') jest.mocked(canChangeAttribute).mockReturnValue(false)
    const version = reason === 'wrong parent' ? { ...snapshot, parent: 'other' as Document['_id'] } : snapshot
    await expect(restoreDocumentSnapshot(client, doc, version, 'Before restore')).rejects.toThrow()
    expect(createDoc).not.toHaveBeenCalled()
    expect(updateMarkup).not.toHaveBeenCalled()
  })

  it('does not change live content if reading the selected version fails', async () => {
    const { client, createDoc } = makeClient()
    jest.mocked(getMarkup).mockRejectedValueOnce(new Error('Read failed'))
    await expect(restoreDocumentSnapshot(client, doc, snapshot, 'Before restore')).rejects.toThrow('Read failed')
    expect(createDoc).not.toHaveBeenCalled()
    expect(updateMarkup).not.toHaveBeenCalled()
  })

  it.each(['read', 'upload', 'persist'])('does not restore if the backup cannot %s', async (stage) => {
    const { client, createDoc } = makeClient()
    if (stage === 'read') {
      jest.mocked(getMarkup).mockResolvedValueOnce('saved content').mockRejectedValueOnce(new Error('Backup failed'))
    }
    if (stage === 'upload') jest.mocked(createMarkup).mockRejectedValueOnce(new Error('Backup failed'))
    if (stage === 'persist') createDoc.mockRejectedValueOnce(new Error('Backup failed'))
    await expect(restoreDocumentSnapshot(client, doc, snapshot, 'Before restore')).rejects.toThrow('Backup failed')
    expect(updateMarkup).not.toHaveBeenCalled()
  })

  it('retains the backup when updating the live document fails', async () => {
    const { client, createDoc } = makeClient()
    jest.mocked(updateMarkup).mockRejectedValueOnce(new Error('Update failed'))
    await expect(restoreDocumentSnapshot(client, doc, snapshot, 'Before restore')).rejects.toThrow('Update failed')
    expect(createDoc).toHaveBeenCalled()
  })
})
