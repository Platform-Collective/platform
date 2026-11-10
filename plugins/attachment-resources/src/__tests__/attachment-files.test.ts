// SPDX-License-Identifier: EPL-2.0

import type { Attachment } from '@hcengineering/attachment'
import type { Blob, IdMap, Ref } from '@hcengineering/core'
import { getInlineImageFiles, getVisibleAttachments, reconcileInlineAttachments } from '../attachment-files'

test('collects nested inline image file-ids once, ignoring external images, GIFs and file nodes', () => {
  const content = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'image', attrs: { 'file-id': 'inline' } },
              { type: 'image', attrs: { 'file-id': 'inline' } },
              { type: 'image', attrs: { src: 'https://example.com/image.png' } },
              { type: 'file', attrs: { 'file-id': 'document' } },
              { type: 'gif', attrs: { 'file-id': 'gif' } }
            ]
          }
        ]
      }
    ]
  })
  expect([...getInlineImageFiles(content)]).toEqual(['inline'])
})

test('accepts empty content', () => {
  expect([...getInlineImageFiles('')]).toEqual([])
})

test.each(['', null, undefined, 42, false])('ignores an invalid inline image file-id: %s', (fileId) => {
  const content = JSON.stringify({ type: 'image', attrs: { 'file-id': fileId } })
  expect([...getInlineImageFiles(content)]).toEqual([])
})

function attachment (id: string, metadata?: Attachment['metadata']): Attachment {
  return { _id: id, file: id, metadata } as unknown as Attachment
}

function withImages (...files: string[]): string {
  return JSON.stringify({
    type: 'doc',
    content: files.map((file) => ({ type: 'image', attrs: { 'file-id': file } }))
  })
}

describe('inline attachment visibility', () => {
  const inline = attachment('inline', { inlineImage: true })
  const document = attachment('document')
  const attachments = [inline, document]

  test('other composers retain image attachments when inline images are disabled', () => {
    expect(getVisibleAttachments(attachments, new Set())).toEqual(attachments)
  })

  test('the composer hides pending inline uploads before markup insertion', () => {
    expect(getVisibleAttachments(attachments, new Set(), true)).toEqual([document])
  })

  test('the composer hides referenced legacy images without inline metadata', () => {
    const legacy = attachment('legacy')
    const inlineFiles = getInlineImageFiles(withImages('legacy'))
    expect(getVisibleAttachments([legacy, document], inlineFiles, true)).toEqual([document])
  })

  test('sent previews hide only files referenced inline in the message', () => {
    expect(getVisibleAttachments(attachments, getInlineImageFiles(withImages('inline')))).toEqual([document])
    expect(getVisibleAttachments(attachments, getInlineImageFiles(''))).toEqual(attachments)
  })
})

describe('inline attachment reconciliation on send', () => {
  let attachments: IdMap<Attachment>
  let removedAttachments: Set<Attachment>
  let newAttachments: Set<Ref<Attachment>>
  let knownInlineFiles: Set<Ref<Blob>>

  beforeEach(() => {
    attachments = new Map()
    removedAttachments = new Set()
    newAttachments = new Set()
    knownInlineFiles = new Set()
  })

  function reconcile (message: string): void {
    reconcileInlineAttachments(message, attachments, removedAttachments, newAttachments, knownInlineFiles)
  }

  function add (item: Attachment, pending = true): void {
    attachments.set(item._id, item)
    if (pending) newAttachments.add(item._id)
  }

  test('keeps referenced inline uploads and ordinary files for saving', () => {
    const inline = attachment('inline', { inlineImage: true })
    const document = attachment('document')
    add(inline)
    add(document)
    reconcile(withImages('inline'))
    expect([...attachments.values()]).toEqual([inline, document])
    expect([...newAttachments]).toEqual([inline._id, document._id])
    expect(removedAttachments.size).toBe(0)
  })

  test('queues an unused inline upload for deletion instead of saving it', () => {
    const inline = attachment('inline', { inlineImage: true })
    const document = attachment('document')
    add(inline)
    add(document)
    reconcile('')
    expect([...attachments.values()]).toEqual([document])
    expect([...newAttachments]).toEqual([document._id])
    expect([...removedAttachments]).toEqual([inline])
  })

  test('a restored draft retains inline ownership after the node was removed', () => {
    const restored = JSON.parse(JSON.stringify(attachment('restored', { inlineImage: true }))) as Attachment
    add(restored)
    reconcile('')
    expect(attachments.size).toBe(0)
    expect(newAttachments.size).toBe(0)
    expect([...removedAttachments]).toEqual([restored])
  })

  test('queues an existing legacy attachment when its previously seen inline node is removed', () => {
    const legacy = attachment('legacy')
    add(legacy, false)
    knownInlineFiles.add(legacy.file)
    reconcile('')
    expect(attachments.size).toBe(0)
    expect([...removedAttachments]).toEqual([legacy])
  })

  test('retains an existing legacy attachment still referenced in the submitted message', () => {
    const legacy = attachment('legacy')
    add(legacy, false)
    knownInlineFiles.add(legacy.file)
    reconcile(withImages('legacy'))
    expect([...attachments.values()]).toEqual([legacy])
    expect(newAttachments.size).toBe(0)
    expect(removedAttachments.size).toBe(0)
  })

  test('restores a removed chip if its blob is referenced inline before sending', () => {
    const removed = attachment('removed')
    removedAttachments.add(removed)
    newAttachments.add(removed._id)
    reconcile(withImages('removed'))
    expect([...attachments.values()]).toEqual([removed])
    expect([...newAttachments]).toEqual([removed._id])
    expect(removedAttachments.size).toBe(0)
  })

  test('keeps unreferenced removed chips queued for cleanup', () => {
    const removed = attachment('removed')
    removedAttachments.add(removed)
    reconcile('')
    expect(attachments.size).toBe(0)
    expect([...removedAttachments]).toEqual([removed])
  })

  test('keeps ordinary attachments when only an external image is present', () => {
    const document = attachment('document')
    add(document)
    reconcile(JSON.stringify({ type: 'image', attrs: { src: 'https://example.com/image.png' } }))
    expect([...attachments.values()]).toEqual([document])
    expect([...newAttachments]).toEqual([document._id])
    expect(removedAttachments.size).toBe(0)
  })
})
