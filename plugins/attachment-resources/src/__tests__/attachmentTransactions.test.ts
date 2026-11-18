// SPDX-License-Identifier: EPL-2.0
import type { Attachment } from '@hcengineering/attachment'
import type { AttachedDoc, Class, Doc, Ref, Space, TxOperations } from '@hcengineering/core'
import {
  prepareAttachmentTransaction,
  type AttachmentTransactionCallbacks,
  type AttachmentTransactionState
} from '../attachmentTransactions'

const attachmentClass = 'Attachment' as Ref<Class<Attachment>>
const parentId = 'parent' as Ref<Doc>
const parentClass = 'Parent' as Ref<Class<Doc>>
const space = 'space' as Ref<Space>

function harness (): {
  state: AttachmentTransactionState
  callbacks: AttachmentTransactionCallbacks
  op: TxOperations
  prepare: () => ReturnType<typeof prepareAttachmentTransaction>
  setDestroyed: (destroyed: boolean) => void
} {
  const current = { _id: 'a', file: 'blob-a' } as Attachment
  const state: AttachmentTransactionState = {
    attachments: new Map([[current._id, current]]),
    newAttachments: new Set([current._id]),
    removedAttachments: new Set(),
    originalAttachments: new Set(),
    preparedAttachments: new Set(),
    uncertainAttachments: new Set()
  }
  let destroyed = false
  const callbacks: AttachmentTransactionCallbacks = {
    deleteFile: jest.fn().mockResolvedValue(undefined),
    removeDraft: jest.fn(),
    saveDraft: jest.fn().mockResolvedValue(undefined),
    isDestroyed: () => destroyed,
    setSaved: jest.fn(),
    reportError: jest.fn()
  }
  const op = {
    addCollection: jest.fn().mockResolvedValue(undefined),
    removeCollection: jest.fn().mockResolvedValue(undefined)
  } as unknown as TxOperations
  return {
    state,
    callbacks,
    op,
    prepare: () => prepareAttachmentTransaction(op, attachmentClass, parentId, parentClass, space, state, callbacks),
    setDestroyed: (value) => {
      destroyed = value
    }
  }
}

describe('deferred attachment transactions', () => {
  it('retains uploaded refs through a failed commit and reuses their IDs', async () => {
    const { state, callbacks, op, prepare } = harness()
    await prepare()
    expect(state.newAttachments.has('a' as Ref<Attachment>)).toBe(true)
    expect(callbacks.removeDraft).not.toHaveBeenCalled()
    const complete = await prepare()
    expect(jest.mocked(op.addCollection).mock.calls.map((call) => call[6])).toEqual(['a', 'a'])
    complete()
    complete()
    expect(state.newAttachments.size).toBe(0)
    expect(callbacks.removeDraft).toHaveBeenCalledWith(false)
    expect(callbacks.deleteFile).not.toHaveBeenCalled()
  })

  it('does not consume refs when preparation partially fails', async () => {
    const { state, callbacks, op, prepare } = harness()
    const other = { _id: 'b', file: 'blob-b' } as Attachment
    state.attachments.set(other._id, other)
    state.newAttachments.add(other._id)
    jest.mocked(op.addCollection)
      .mockResolvedValueOnce('a' as Ref<AttachedDoc>)
      .mockRejectedValueOnce(new Error('queue'))
    await expect(prepare()).rejects.toThrow('queue')
    expect(Array.from(state.newAttachments)).toEqual(['a', 'b'])
    expect(callbacks.deleteFile).not.toHaveBeenCalled()
  })

  it('retains prepared blobs until a successful finalization after unmount', async () => {
    const { state, callbacks, prepare, setDestroyed } = harness()
    const complete = await prepare()
    setDestroyed(true)
    expect(state.preparedAttachments.size).toBe(1)
    expect(callbacks.deleteFile).not.toHaveBeenCalled()
    complete()
    expect(state.preparedAttachments.size).toBe(0)
    expect(state.newAttachments.size).toBe(0)
    expect(callbacks.deleteFile).not.toHaveBeenCalled()
  })

  it('keeps attachment ownership after an ambiguous commit and failed retry cleanup', async () => {
    const { state, callbacks, prepare, setDestroyed } = harness()
    const first = await prepare()
    first.markCommitUncertain()
    first.cancelBeforeCommit()
    const retry = await prepare()
    setDestroyed(true)
    retry.cancelBeforeCommit()
    expect(state.uncertainAttachments.has('a' as Ref<Attachment>)).toBe(true)
    expect(callbacks.deleteFile).not.toHaveBeenCalled()
  })

  it('defers unused blob cleanup and reports cleanup failures separately', async () => {
    const { state, callbacks, prepare } = harness()
    const original = {
      _id: 'old',
      _class: 'Attachment',
      space: 'space',
      attachedTo: 'parent',
      attachedToClass: 'Parent'
    } as Attachment
    const unused = { _id: 'unused', file: 'unused-blob' } as Attachment
    state.originalAttachments.add(original._id)
    state.removedAttachments.add(original)
    state.removedAttachments.add(unused)
    jest.mocked(callbacks.deleteFile).mockRejectedValue(new Error('cleanup'))
    const complete = await prepare()
    expect(callbacks.deleteFile).not.toHaveBeenCalled()
    complete()
    await Promise.resolve()
    expect(callbacks.deleteFile).toHaveBeenCalledWith('unused-blob')
    expect(callbacks.reportError).toHaveBeenCalled()
  })

  it('does not finalize attachments added after preparation', async () => {
    const { state, callbacks, prepare } = harness()
    const complete = await prepare()
    state.newAttachments.add('later' as Ref<Attachment>)
    complete()
    expect(Array.from(state.newAttachments)).toEqual(['later'])
    expect(callbacks.removeDraft).not.toHaveBeenCalled()
    expect(callbacks.saveDraft).toHaveBeenCalled()
  })
})
