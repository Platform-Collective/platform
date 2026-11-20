// SPDX-License-Identifier: EPL-2.0
import type { Attachment } from '@hcengineering/attachment'
import type { Class, Doc, Ref, Space, TxOperations } from '@hcengineering/core'
import type { CreateFinalizer } from '@hcengineering/presentation'

export interface AttachmentTransactionState {
  attachments: Map<Ref<Attachment>, Attachment>
  newAttachments: Set<Ref<Attachment>>
  removedAttachments: Set<Attachment>
  originalAttachments: Set<Ref<Attachment>>
  preparedAttachments: Set<Ref<Attachment>>
  uncertainAttachments: Set<Ref<Attachment>>
}

export interface AttachmentTransactionCallbacks {
  deleteFile: (file: Attachment['file']) => Promise<void> | void
  removeDraft: (removeFiles: boolean) => void
  saveDraft: () => Promise<void>
  isDestroyed: () => boolean
  setSaved: (saved: boolean) => void
  reportError: (error: unknown) => void
}

export async function prepareAttachmentTransaction (
  op: TxOperations,
  attachmentClass: Ref<Class<Attachment>>,
  id: Ref<Doc>,
  attachedToClass: Ref<Class<Doc>>,
  space: Ref<Space>,
  state: AttachmentTransactionState,
  callbacks: AttachmentTransactionCallbacks
): Promise<CreateFinalizer> {
  const added = Array.from(state.newAttachments)
    .map((id) => state.attachments.get(id))
    .filter((doc): doc is Attachment => doc !== undefined)
  const removed = Array.from(state.removedAttachments)
  added.forEach((doc) => state.preparedAttachments.add(doc._id))
  let completed = false
  const releasePreparation = (cleanupIfDestroyed: boolean): void => {
    if (completed) return
    completed = true
    added.forEach((doc) => state.preparedAttachments.delete(doc._id))
    if (cleanupIfDestroyed && callbacks.isDestroyed()) {
      added.forEach((doc) => {
        if (!state.originalAttachments.has(doc._id) && !state.uncertainAttachments.has(doc._id)) {
          void Promise.resolve(callbacks.deleteFile(doc.file)).catch(callbacks.reportError)
        }
      })
    }
  }
  try {
    for (const doc of added) {
      await op.addCollection(attachmentClass, space, id, attachedToClass, 'attachments', doc, doc._id)
    }
    for (const doc of removed) {
      if (state.originalAttachments.has(doc._id)) {
        await op.removeCollection(doc._class, doc.space, doc._id, doc.attachedTo, doc.attachedToClass, 'attachments')
      }
    }
  } catch (error) {
    releasePreparation(true)
    throw error
  }
  const finalize = (() => {
    if (completed) return
    releasePreparation(false)
    for (const doc of added) {
      state.newAttachments.delete(doc._id)
      state.originalAttachments.add(doc._id)
      state.uncertainAttachments.delete(doc._id)
    }
    for (const doc of removed) {
      state.removedAttachments.delete(doc)
      state.newAttachments.delete(doc._id)
      if (!state.originalAttachments.has(doc._id)) {
        void Promise.resolve(callbacks.deleteFile(doc.file)).catch(callbacks.reportError)
      }
      state.originalAttachments.delete(doc._id)
    }
    const saved = state.newAttachments.size === 0 && state.removedAttachments.size === 0
    callbacks.setSaved(saved)
    if (saved) callbacks.removeDraft(false)
    else void callbacks.saveDraft()
  }) as CreateFinalizer
  finalize.cancelBeforeCommit = () => {
    releasePreparation(true)
  }
  finalize.markCommitUncertain = () => {
    added.forEach((doc) => state.uncertainAttachments.add(doc._id))
  }
  return finalize
}
