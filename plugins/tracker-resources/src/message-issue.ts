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

type SizeOmission = 'declared-size' | 'downloaded-size'
type AttachmentOmission = SizeOmission | 'invalid-id' | 'invalid-url'

export interface MessageAttachment {
  attachment: AttachedData<Attachment>
  omission?: AttachmentOmission
}

export interface MessageIssueData {
  title: string
  description: Markup
  sourceAttachments: MessageAttachment[]
}

interface SavedMessageAttachment extends MessageAttachment {
  copy?: AttachedData<Attachment>
}

interface MessageAttachmentSizeOmission {
  attachment: AttachedData<Attachment>
  omission: SizeOmission
}

interface MessageAttachmentCopy {
  attachments: Array<AttachedData<Attachment>>
  description: Markup
  sizeOmissions: MessageAttachmentSizeOmission[]
}

function isSizeOmission (omission: AttachmentOmission | undefined): omission is SizeOmission {
  return omission === 'declared-size' || omission === 'downloaded-size'
}

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
  attachments: Array<AttachedData<Attachment>> = []
): MessageIssueData {
  const parsed = markupToJSON(message)
  const doc = { ...parsed, content: parsed.content?.flatMap(referencesToText) }
  const sourceAttachments = classifyMessageAttachments(attachments)
  const omittedFiles = new Set(
    Array.from(messageAttachmentsByFile(sourceAttachments)).flatMap(([file, { omission }]) =>
      omission !== undefined ? [file] : []
    )
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
    sourceAttachments,
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
function isMessageBlobId (file: unknown): file is Ref<Blob> {
  return typeof file === 'string' && file.length > 0 && !/[^a-zA-Z0-9_-]/.test(file)
}

/** Classify every source attachment before filtering the list or the description. */
export function classifyMessageAttachments (attachments: Array<AttachedData<Attachment>>): MessageAttachment[] {
  return attachments.map((attachment) => {
    const { size, file } = attachment
    if (!Number.isFinite(size) || size < 0 || size > MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT) {
      return { attachment, omission: 'declared-size' }
    }
    return isMessageBlobId(file) ? { attachment } : { attachment, omission: 'invalid-id' }
  })
}

function messageAttachmentsByFile (source: readonly MessageAttachment[]): Map<Ref<Blob>, SavedMessageAttachment> {
  const byFile = new Map<Ref<Blob>, SavedMessageAttachment>()
  for (const decision of source) {
    const { attachment, omission } = decision
    const previous = byFile.get(attachment.file)
    // A single blob can be attached more than once. An omission applies to all of its inline references.
    if (previous?.omission === undefined || isSizeOmission(omission)) byFile.set(attachment.file, decision)
  }
  return byFile
}

/** Select the attachments shown in the issue dialog before the user edits the list. */
export function getCopyableMessageAttachments (source: readonly MessageAttachment[]): Array<AttachedData<Attachment>> {
  return Array.from(messageAttachmentsByFile(source).values()).flatMap(({ attachment, omission }) =>
    omission === undefined ? [attachment] : []
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
  sourceAttachments: readonly MessageAttachment[],
  selectedAttachments: ReadonlyArray<AttachedData<Attachment>>,
  description: Markup,
  onProgress?: (copied: number, total: number) => void
): Promise<MessageAttachmentCopy> {
  if (sourceAttachments.length === 0) return { attachments: [], description, sizeOmissions: [] }

  const doc = markupToJSON(description)
  const selected = new Set(selectedAttachments.map(({ file }) => file))
  function collectInlineFiles (node: MarkupNode): void {
    const fileId = node.attrs?.['file-id']
    if (typeof fileId === 'string') selected.add(fileId as Ref<Blob>)
    node.content?.forEach(collectInlineFiles)
  }
  collectInlineFiles(doc)

  const decisions = messageAttachmentsByFile(sourceAttachments)
  const files = Array.from(selected).flatMap((file) => {
    const decision = decisions.get(file)
    return decision !== undefined && decision.omission === undefined ? [decision.attachment] : []
  })

  if (files.length > 0) onProgress?.(0, files.length)
  let copied = 0
  try {
    for (const attachment of files) {
      const url = getMessageAttachmentUrl(attachment)
      if (url === undefined) {
        decisions.set(attachment.file, { attachment, omission: 'invalid-url' })
        continue
      }
      const response = await fetch(url, {
        headers: authorizationHeaders(getMetadata(presentation.metadata.Token))
      })
      if (!response.ok) throw new Error(`Failed to copy message attachment: ${response.status}`)
      const blob = await response.blob()
      if (blob.size > MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT) {
        decisions.set(attachment.file, { attachment, omission: 'downloaded-size' })
        continue
      }
      const file = new File([blob], attachment.name, {
        type: attachment.type,
        lastModified: attachment.lastModified
      })
      const id = generateFileId() as Ref<Blob>
      decisions.set(attachment.file, { attachment, copy: { ...attachment, file: id, size: blob.size } })
      await uploadFile(file, id)
      onProgress?.(++copied, files.length)
    }

    const attachments: Array<AttachedData<Attachment>> = []
    const sizeOmissions: MessageAttachmentSizeOmission[] = []
    const copiedIds = new Map<Ref<Blob>, Ref<Blob>>()
    const omittedFiles = new Set<Ref<Blob>>()
    for (const [file, { attachment, copy, omission }] of decisions) {
      if (copy !== undefined) {
        attachments.push(copy)
        copiedIds.set(file, copy.file)
      } else if (omission !== undefined) {
        omittedFiles.add(file)
        if (isSizeOmission(omission)) sizeOmissions.push({ attachment, omission })
      }
    }
    updateAttachmentReferences(doc, copiedIds, omittedFiles)
    if (sizeOmissions.length > 0) {
      await setPlatformStatus(
        new Status(Severity.WARNING, tracker.string.MessageAttachmentsTooLarge, {
          limit: MESSAGE_ISSUE_ATTACHMENT_SIZE_LIMIT_MB
        })
      )
    }
    return {
      attachments,
      description: jsonToMarkup(doc),
      sizeOmissions
    }
  } catch (err: unknown) {
    await Promise.allSettled(
      Array.from(decisions.values()).map(async ({ copy }) => {
        if (copy !== undefined) await deleteFile(copy.file)
      })
    )
    throw err
  }
}
