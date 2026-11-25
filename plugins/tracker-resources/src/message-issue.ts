// SPDX-License-Identifier: EPL-2.0

import type { Attachment } from '@hcengineering/attachment'
import type { AttachedData, Blob, Markup, Ref } from '@hcengineering/core'
import { getMetadata, setPlatformStatus, Severity, Status } from '@hcengineering/platform'
import presentation, {
  authorizationHeaders,
  deleteFile,
  generateFileId,
  getFileUrl,
  uploadFile
} from '@hcengineering/presentation'
import { jsonToMarkup, markupToJSON, type MarkupNode, MarkupMarkType, MarkupNodeType } from '@hcengineering/text'

import tracker from './plugin'

const MESSAGE_ISSUE_TITLE_LIMIT = 100
const MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT_MB = 25
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

function referencesToText (node: MarkupNode): MarkupNode[] {
  if (node.type === MarkupNodeType.reference) {
    const label = String(node.attrs?.label ?? '')
    const text = label !== '' ? label : (node.content ?? []).map(messageText).join('')
    return text === '' ? [] : [{ type: MarkupNodeType.text, text }]
  }
  return [{ ...node, content: node.content?.flatMap(referencesToText) }]
}

function updateAttachmentReferences (
  node: MarkupNode,
  copies: ReadonlyMap<Ref<Blob>, Ref<Blob>>,
  omittedFiles: ReadonlySet<Ref<Blob>>
): MarkupNode | undefined {
  const fileId = node.attrs?.['file-id']
  if (typeof fileId === 'string' && omittedFiles.has(fileId as Ref<Blob>)) return undefined

  const file = typeof fileId === 'string' ? copies.get(fileId as Ref<Blob>) : undefined
  if (file !== undefined && node.attrs !== undefined) {
    node.attrs['file-id'] = file
    if (node.attrs.src != null) node.attrs.src = getFileUrl(file)
    if (node.attrs['data-file-href'] != null) node.attrs['data-file-href'] = getFileUrl(file)
  }
  node.content = node.content
    ?.map((child) => updateAttachmentReferences(child, copies, omittedFiles))
    .filter((child): child is MarkupNode => child !== undefined)
  return node
}

/** Prepare an issue from message markup, preserving its content and a link to the source. */
export function getMessageIssueData (
  message: Markup,
  sourceUrl: string,
  sourceLabel: string,
  fallbackTitle: string,
  sourceAttachments: Array<Pick<AttachedData<Attachment>, 'file' | 'size'>> = []
): { title: string, description: Markup } {
  const parsed = markupToJSON(message)
  const doc = { ...parsed, content: parsed.content?.flatMap(referencesToText) }
  const omittedFiles = new Set(
    sourceAttachments
      .filter((attachment) => !isMessageBlobId(attachment.file) || !isMessageAttachmentWithinSizeLimit(attachment))
      .map((attachment) => attachment.file)
  )
  updateAttachmentReferences(doc, new Map<Ref<Blob>, Ref<Blob>>(), omittedFiles)
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
  return (
    Number.isFinite(attachment.size) && attachment.size >= 0 && attachment.size <= MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT
  )
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

/** Copy message files, update inline references and report size omissions before saving the issue. */
export async function copyMessageAttachments (
  attachments: Array<AttachedData<Attachment>>,
  description: Markup,
  sourceAttachments: Array<AttachedData<Attachment>> = attachments,
  onProgress?: (copied: number, total: number) => void
): Promise<{ attachments: Array<AttachedData<Attachment>>, description: Markup }> {
  if (attachments.length === 0 && sourceAttachments.length === 0) return { attachments, description }

  const doc = markupToJSON(description)
  const omittedFiles = new Set<Ref<Blob>>()
  let omittedForSize = false
  for (const attachment of [...attachments, ...sourceAttachments]) {
    if (!isMessageAttachmentWithinSizeLimit(attachment)) {
      omittedForSize = true
      omittedFiles.add(attachment.file)
    } else if (!isMessageBlobId(attachment.file)) {
      omittedFiles.add(attachment.file)
    }
  }
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
  for (const file of omittedFiles) files.delete(file)

  if (files.size > 0) onProgress?.(0, files.size)
  let copied = 0
  const copies = new Map<Ref<Blob>, Ref<Blob>>()
  const actualSizes = new Map<Ref<Blob>, number>()
  try {
    for (const attachment of files.values()) {
      const url = getMessageAttachmentUrl(attachment)
      if (url === undefined) {
        omittedFiles.add(attachment.file)
        continue
      }
      const response = await fetch(url, {
        headers: authorizationHeaders(getMetadata(presentation.metadata.Token))
      })
      if (!response.ok) throw new Error(`Failed to copy message attachment: ${response.status}`)
      const blob = await response.blob()
      if (blob.size > MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT) {
        omittedForSize = true
        omittedFiles.add(attachment.file)
        continue
      }
      actualSizes.set(attachment.file, blob.size)
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

    updateAttachmentReferences(doc, copies, omittedFiles)
    if (omittedForSize) {
      await setPlatformStatus(
        new Status(Severity.WARNING, tracker.string.MessageAttachmentsTooLarge, {
          limit: MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT_MB
        })
      )
    }
    return {
      attachments: Array.from(files.values())
        .filter((attachment) => copies.has(attachment.file))
        .map((attachment) => ({
          ...attachment,
          file: copies.get(attachment.file) ?? attachment.file,
          size: actualSizes.get(attachment.file) ?? attachment.size
        })),
      description: jsonToMarkup(doc)
    }
  } catch (err: unknown) {
    await Promise.allSettled(
      Array.from(copies.values(), async (file) => {
        await deleteFile(file)
      })
    )
    throw err
  }
}
