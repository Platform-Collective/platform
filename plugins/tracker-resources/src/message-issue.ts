// SPDX-License-Identifier: EPL-2.0

import type { Attachment } from '@hcengineering/attachment'
import type { AttachedData, Blob, Markup, Ref } from '@hcengineering/core'
import { getMetadata } from '@hcengineering/platform'
import presentation, {
  authorizationHeaders,
  deleteFile,
  generateFileId,
  getFileUrl,
  uploadFile
} from '@hcengineering/presentation'
import { jsonToMarkup, markupToJSON, type MarkupNode, MarkupMarkType, MarkupNodeType } from '@hcengineering/text'

const MESSAGE_ISSUE_TITLE_LIMIT = 100
export const MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT_MB = 25
const MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT = MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT_MB * 1024 * 1024

function messageText (node: MarkupNode): string {
  if (node.type === MarkupNodeType.text) return node.text ?? ''
  if (node.type === MarkupNodeType.reference) return String(node.attrs?.label ?? '')
  if (node.type === MarkupNodeType.hard_break) return '\n'

  const text = (node.content ?? []).map(messageText).join('')
  return [MarkupNodeType.paragraph, MarkupNodeType.heading, MarkupNodeType.code_block].includes(node.type)
    ? text + '\n'
    : text
}

function referencesToText (node: MarkupNode): MarkupNode {
  if (node.type === MarkupNodeType.reference) {
    return { type: MarkupNodeType.text, text: String(node.attrs?.label ?? '') }
  }
  return { ...node, content: node.content?.map(referencesToText) }
}

/** Prepare an issue from message markup, preserving its content and a link to the source. */
export function getMessageIssueData (
  message: Markup,
  sourceUrl: string,
  sourceLabel: string,
  fallbackTitle: string
): { title: string, description: Markup } {
  const doc = referencesToText(markupToJSON(message))
  const firstLine =
    messageText(doc)
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? fallbackTitle
  const characters = Array.from(firstLine)
  const title =
    characters.length > MESSAGE_ISSUE_TITLE_LIMIT
      ? characters.slice(0, MESSAGE_ISSUE_TITLE_LIMIT - 1).join('') + '…'
      : firstLine

  return {
    title,
    description: jsonToMarkup({
      ...doc,
      content: [
        ...(doc.content ?? []),
        {
          type: MarkupNodeType.paragraph,
          content: [
            {
              type: MarkupNodeType.text,
              text: sourceLabel,
              marks: [{ type: MarkupMarkType.link, attrs: { href: sourceUrl } }]
            }
          ]
        }
      ]
    })
  }
}

/** Prepare source attachment data without ownership or document identity. Blobs are copied on save. */
export function getMessageAttachmentData (attachment: AttachedData<Attachment>): AttachedData<Attachment> {
  const { name, file, type, size, lastModified, metadata, description } = attachment
  return { name, file, type, size, lastModified, metadata, description }
}

/** Accept plain workspace blob IDs, never URLs or paths supplied by a message. */
export function isMessageBlobId (file: unknown): file is Ref<Blob> {
  return typeof file === 'string' && file.length > 0 && !/[^a-zA-Z0-9_-]/.test(file)
}

export function isMessageAttachmentWithinSizeLimit (attachment: Pick<AttachedData<Attachment>, 'size'>): boolean {
  return attachment.size <= MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT
}

function getMessageAttachmentUrl (attachment: AttachedData<Attachment>): string | undefined {
  try {
    const frontUrl = getMetadata(presentation.metadata.FrontUrl) ?? window.location.origin
    const filesUrl =
      getMetadata(presentation.metadata.DatalakeUrl) ||
      getMetadata(presentation.metadata.HulylakeUrl) ||
      getMetadata(presentation.metadata.UploadURL) ||
      frontUrl
    const url = new URL(getFileUrl(attachment.file, attachment.name), frontUrl)
    if (url.origin === new URL(filesUrl, frontUrl).origin) return url.href
  } catch {
    // Skip malformed URLs without preventing the issue from being created.
  }
  return undefined
}

/** Copy message files and update inline references before saving the issue. */
export async function copyMessageAttachments (
  attachments: AttachedData<Attachment>[],
  description: Markup,
  sourceAttachments: AttachedData<Attachment>[] = attachments,
  onProgress?: (copied: number, total: number) => void
): Promise<{ attachments: AttachedData<Attachment>[], description: Markup }> {
  if (attachments.length === 0 && sourceAttachments.length === 0) return { attachments, description }

  const doc = markupToJSON(description)
  const files = new Map(
    attachments
      .filter((attachment) => isMessageBlobId(attachment.file) && isMessageAttachmentWithinSizeLimit(attachment))
      .map((attachment) => [attachment.file, attachment])
  )
  function collectInlineFiles (node: MarkupNode): void {
    const source = sourceAttachments.find(
      (attachment) =>
        isMessageBlobId(attachment.file) &&
        isMessageAttachmentWithinSizeLimit(attachment) &&
        attachment.file === node.attrs?.['file-id']
    )
    if (source !== undefined) files.set(source.file, source)
    node.content?.forEach(collectInlineFiles)
  }
  collectInlineFiles(doc)

  if (files.size > 0) onProgress?.(0, files.size)
  let copied = 0
  const copies = new Map<Ref<Blob>, Ref<Blob>>()
  try {
    for (const attachment of files.values()) {
      const url = getMessageAttachmentUrl(attachment)
      if (url === undefined) continue
      const response = await fetch(url, {
        headers: authorizationHeaders(getMetadata(presentation.metadata.Token))
      })
      if (!response.ok) throw new Error(`Failed to copy message attachment: ${response.status}`)
      const blob = await response.blob()
      const file = new File([blob], attachment.name, {
        type: attachment.type,
        lastModified: attachment.lastModified
      })
      const id = generateFileId() as Ref<Blob>
      copies.set(attachment.file, id)
      await uploadFile(file, id)
      copied++
      onProgress?.(copied, files.size)
    }

    function updateReferences (node: MarkupNode): void {
      const fileId = node.attrs?.['file-id']
      const file = typeof fileId === 'string' ? copies.get(fileId as Ref<Blob>) : undefined
      if (file !== undefined && node.attrs !== undefined) {
        node.attrs['file-id'] = file
        if (node.attrs.src != null) node.attrs.src = getFileUrl(file)
        if (node.attrs['data-file-href'] != null) node.attrs['data-file-href'] = getFileUrl(file)
      }
      node.content?.forEach(updateReferences)
    }
    updateReferences(doc)
    return {
      attachments: Array.from(files.values())
        .filter((attachment) => copies.has(attachment.file))
        .map((attachment) => ({ ...attachment, file: copies.get(attachment.file) ?? attachment.file })),
      description: jsonToMarkup(doc)
    }
  } catch (err: unknown) {
    await Promise.allSettled(Array.from(copies.values(), (file) => deleteFile(file)))
    throw err
  }
}
