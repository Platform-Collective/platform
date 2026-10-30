// SPDX-License-Identifier: EPL-2.0

import type { Attachment } from '@hcengineering/attachment'
import type { Blob, IdMap, Markup, Ref } from '@hcengineering/core'
import { isFileId, markupToJSON, traverseNode } from '@hcengineering/text'

/** Blob IDs rendered by inline image nodes, including images nested in lists or tables. */
export function getInlineImageFiles (content: Markup): Set<Ref<Blob>> {
  const files = new Set<Ref<Blob>>()
  traverseNode(markupToJSON(content), (node) => {
    const file = node.attrs?.['file-id']
    if (node.type === 'image' && isFileId(file)) {
      files.add(file)
    }
    return true
  })
  return files
}

/** Hide inline image previews, including pending inline uploads in the composer. */
export function getVisibleAttachments<T extends Attachment> (
  attachments: Iterable<T>,
  inlineFiles: Set<Ref<Blob>>,
  hideInlineUploads = false
): T[] {
  return Array.from(attachments).filter(
    (item) => !inlineFiles.has(item.file) && (!hideInlineUploads || item.metadata?.inlineImage !== true)
  )
}

/** Retain referenced files and queue unused inline attachments for the existing cleanup flow. */
export function reconcileInlineAttachments (
  message: Markup,
  attachments: IdMap<Attachment>,
  removedAttachments: Set<Attachment>,
  newAttachments: Set<Ref<Attachment>>,
  knownInlineFiles: Set<Ref<Blob>>
): void {
  const files = getInlineImageFiles(message)
  for (const item of removedAttachments) {
    if (files.has(item.file)) {
      removedAttachments.delete(item)
      attachments.set(item._id, item)
    }
  }
  for (const item of attachments.values()) {
    if ((item.metadata?.inlineImage === true || knownInlineFiles.has(item.file)) && !files.has(item.file)) {
      removedAttachments.add(item)
      attachments.delete(item._id)
      newAttachments.delete(item._id)
    }
  }
}
