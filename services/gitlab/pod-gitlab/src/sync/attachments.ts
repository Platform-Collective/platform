// SPDX-License-Identifier: EPL-2.0

import { linkTarget } from './image-links'

/** Starts the Huly-owned list of a comment's attachments at the end of a GitLab note. */
export const ATTACHMENT_MARKER = '<!-- huly-attachments -->'

function escapeLabel (name: string): string {
  return name.replace(/[\\[\]]/g, (it) => `\\${it}`)
}

export function attachmentLink (name: string, type: string, path: string): string {
  return `${type.startsWith('image/') ? '!' : ''}[${escapeLabel(name)}](${linkTarget(path)})`
}

export function attachmentBlock (links: string[]): string {
  return links.length === 0 ? '' : [ATTACHMENT_MARKER, ...links].join('\n')
}

/** A note's own text and its attachment block ('' without one). */
export function splitAttachmentBlock (body: string): { text: string, block: string } {
  const at = body.indexOf(ATTACHMENT_MARKER)
  if (at < 0) return { text: body, block: '' }
  return { text: body.slice(0, at).trimEnd(), block: body.slice(at).trimEnd() }
}

export function withAttachments (text: string, block: string): string {
  if (block === '') return text
  return text.trim() === '' ? block : `${text.trimEnd()}\n\n${block}`
}
