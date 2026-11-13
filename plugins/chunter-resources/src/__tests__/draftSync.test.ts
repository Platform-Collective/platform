// SPDX-License-Identifier: EPL-2.0

import { type Attachment } from '@hcengineering/attachment'
import {
  type Blob as PlatformBlob,
  type Class,
  type Doc,
  type Markup,
  type PersonId,
  type Ref,
  type Space
} from '@hcengineering/core'
import { jsonToMarkup, MarkupNodeType, markupToJSON } from '@hcengineering/text'

import { keepsUnsentDraft, renewSharedDraft } from '../components/chat-message/draftSync'

function text (value: string): Markup {
  return jsonToMarkup({
    type: MarkupNodeType.doc,
    content:
      value === '' ? [] : [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: value }] }]
  })
}

const draft = (message: string, attachments = 0): { message: Markup, attachments: number } => ({
  message: text(message),
  attachments
})

describe('keepsUnsentDraft', () => {
  it('drops a stale copy that was never edited in this input', () => {
    // The sidebar opened earlier with "A", then "A B" was typed and sent from the main view.
    expect(keepsUnsentDraft(draft('A'), draft('A'), draft('A B'))).toBe(false)
  })

  it('drops the copy when it matches the sent message', () => {
    expect(keepsUnsentDraft(draft('A B'), draft('A'), draft('A B'))).toBe(false)
  })

  it('keeps text that was typed in this input and was not sent', () => {
    expect(keepsUnsentDraft(draft('A C'), draft('A'), draft('A B'))).toBe(true)
  })

  it('keeps text typed into an input that opened empty', () => {
    expect(keepsUnsentDraft(draft('C'), draft(''), draft('A B'))).toBe(true)
  })

  it('treats attachment changes made in this input as unsent content', () => {
    expect(keepsUnsentDraft(draft('A', 1), draft('A'), draft('A B'))).toBe(true)
    expect(keepsUnsentDraft(draft('A', 1), draft('A', 1), draft('A B'))).toBe(false)
  })

  it('compares markup by content, not by serialization', () => {
    const loaded = { message: jsonToMarkup(markupToJSON(text('A'))), attachments: 0 }
    expect(keepsUnsentDraft(draft('A'), loaded, draft('A B'))).toBe(false)
  })

  it('treats a missing attachment count as zero', () => {
    expect(keepsUnsentDraft({ message: text('A') }, draft('A'), { message: text('A B') })).toBe(false)
  })

  it('keeps a draft whose file was replaced by another one in this input', () => {
    // Same count, different file: the loaded file was removed here and another one was added.
    const current = { ...draft('A', 1), attachmentIds: ['added-here'] }
    const loaded = { ...draft('A', 1), attachmentIds: ['loaded'] }
    expect(keepsUnsentDraft(current, loaded, draft('A B'))).toBe(true)
  })

  it('keeps a draft with the same text and file count as the sent message but another file', () => {
    // The sent message has the loaded file; this input replaced it with another one.
    const current = { ...draft('A', 1), attachmentIds: ['added-here'] }
    const loaded = { ...draft('A', 1), attachmentIds: ['loaded'] }
    const sent = { ...draft('A', 1), attachmentIds: ['loaded'] }
    expect(keepsUnsentDraft(current, loaded, sent)).toBe(true)
  })

  it('drops a copy whose files are still the loaded ones, in any order', () => {
    const current = { ...draft('A', 2), attachmentIds: ['second', 'first'] }
    const loaded = { ...draft('A', 2), attachmentIds: ['first', 'second'] }
    expect(keepsUnsentDraft(current, loaded, draft('A B'))).toBe(false)
  })
})

function attachmentFile (id: Ref<Attachment>, attachedTo: Ref<Doc>, file: string): Attachment {
  return {
    _id: id,
    _class: 'attachment:class:Attachment' as Ref<Class<Attachment>>,
    collection: 'attachments',
    modifiedOn: 0,
    modifiedBy: 'author' as PersonId,
    space: 'space' as Ref<Space>,
    attachedTo,
    attachedToClass: 'message' as Ref<Class<Doc>>,
    name: file,
    file: file as Ref<PlatformBlob>,
    type: 'text/plain',
    size: 1,
    lastModified: 0
  }
}

describe('renewSharedDraft', () => {
  const oldId = 'old-message' as Ref<Doc>
  const nextId = 'new-message' as Ref<Doc>
  const attachmentId = 'sidebar-file' as Ref<Attachment>

  it('keeps the files of this input under the new message ID without mutating the old draft', () => {
    const file = attachmentFile(attachmentId, oldId, 'uploaded-file')
    const attachments = new Map([[attachmentId, file]])
    const current = { ...draft('sidebar text', 1), _id: oldId }
    const renewed = renewSharedDraft(current, attachments, nextId)
    expect(renewed.attachments.get(attachmentId)).toEqual({ ...file, attachedTo: nextId })
    expect(renewed.draft).toEqual({ ...current, _id: nextId })
    expect(file.attachedTo).toBe(oldId)
    expect(current._id).toBe(oldId)
  })

  it('drops files that were sent with the old message or came with the loaded copy', () => {
    const sentId = 'sent-file' as Ref<Attachment>
    const loadedId = 'loaded-file' as Ref<Attachment>
    const attachments = new Map([
      [sentId, attachmentFile(sentId, oldId, 'sent-upload')],
      [loadedId, attachmentFile(loadedId, oldId, 'loaded-upload')],
      [attachmentId, attachmentFile(attachmentId, oldId, 'sidebar-upload')]
    ])
    const current = { ...draft('sidebar text', 3), _id: oldId }
    const renewed = renewSharedDraft(current, attachments, nextId, new Set([sentId, loadedId]))
    expect(Array.from(renewed.attachments.keys())).toEqual([attachmentId])
    expect(renewed.draft.attachments).toBe(1)
    expect(attachments.size).toBe(3)
  })

  it('uses the kept draft as the new baseline of this input', () => {
    const file = attachmentFile(attachmentId, oldId, 'uploaded-file')
    const current = { ...draft('sidebar text', 1), _id: oldId }
    const renewed = renewSharedDraft(current, new Map([[attachmentId, file]]), nextId)
    expect(renewed.loaded).toEqual({ ...renewed.draft, attachmentIds: [attachmentId] })
    expect(renewed.loaded).not.toBe(renewed.draft)
    // The other input loads the kept draft, edits it further and sends it: this unchanged copy is dropped.
    const shown = { ...renewed.draft, attachmentIds: [attachmentId] }
    expect(keepsUnsentDraft(shown, renewed.loaded, draft('sidebar text continued', 1))).toBe(false)
  })

  it('keeps the count consistent with the kept files', () => {
    const current = { ...draft('sidebar text', 2), _id: oldId }
    const renewed = renewSharedDraft(current, new Map(), nextId)
    expect(renewed.draft.attachments).toBe(0)
    expect(renewed.loaded.attachments).toBe(0)
  })
})
