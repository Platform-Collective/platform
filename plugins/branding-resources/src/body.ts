// SPDX-License-Identifier: EPL-2.0

import core, {
  type AnyAttribute,
  type Blob,
  type Client,
  type Doc,
  type Markup,
  type Ref,
  type RefTo,
  makeDocCollabId
} from '@hcengineering/core'
import { DOC_TITLE_CLASS, PAGE_BREAK_ATTR, escapeHtml } from '@hcengineering/branding'
import type { IntlString } from '@hcengineering/platform'
import { getMarkup } from '@hcengineering/presentation'
import { jsonToHTML, markupToJSON } from '@hcengineering/text'

import { loadAsDataUrl } from './assets'

/**
 * What is printed as the document body.
 * - content: rich text of the document, laid out in the preview where page breaks can be set
 * - file: an existing PDF (Word documents are converted to PDF by the print service)
 * - page: the document page as displayed in the application
 */
export type BodySource =
  | { kind: 'content', attribute: string, label: IntlString }
  | { kind: 'file', file: Ref<Blob>, contentType: string, name: string }
  | { kind: 'page' }

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function isPrintableFile (contentType: string): boolean {
  return contentType === 'application/pdf' || contentType === DOCX_TYPE || contentType.startsWith('image/')
}

interface FileInfo {
  file: Ref<Blob>
  contentType: string
  name: string
}

function readFileInfo (value: Record<string, unknown>): FileInfo | undefined {
  if (typeof value.file === 'string' && typeof value.type === 'string') {
    const name = typeof value.name === 'string' ? value.name : typeof value.title === 'string' ? value.title : 'file'
    return { file: value.file as Ref<Blob>, contentType: value.type, name }
  }
  return undefined
}

/**
 * Downloadable file of a document: attachments keep the blob themselves, Drive files reference their latest version.
 */
export async function resolveDocFile (client: Client, doc: Doc): Promise<FileInfo | undefined> {
  const hierarchy = client.getHierarchy()
  const attr = hierarchy.findAttribute(doc._class, 'file')
  if (attr === undefined) return undefined
  const value = doc as unknown as Record<string, unknown>
  if (attr.type._class === core.class.TypeBlob) {
    return readFileInfo(value)
  }
  if (attr.type._class === core.class.RefTo && typeof value.file === 'string') {
    const version = await client.findOne((attr.type as RefTo<Doc>).to, { _id: value.file as Ref<Doc> })
    return version !== undefined ? readFileInfo(version as unknown as Record<string, unknown>) : undefined
  }
  return undefined
}

function contentAttributes (client: Client, doc: Doc): AnyAttribute[] {
  const value = doc as unknown as Record<string, unknown>
  return Array.from(client.getHierarchy().getAllAttributes(doc._class).values()).filter(
    (attr) =>
      (attr.type._class === core.class.TypeCollaborativeDoc || attr.type._class === core.class.TypeMarkup) &&
      value[attr.name] !== undefined &&
      value[attr.name] !== null &&
      value[attr.name] !== ''
  )
}

/**
 * Body sources available for the document, preferred first.
 */
export async function detectBodySources (client: Client, doc: Doc): Promise<BodySource[]> {
  const result: BodySource[] = []
  const file = await resolveDocFile(client, doc)
  if (file !== undefined && isPrintableFile(file.contentType)) {
    result.push({ kind: 'file', ...file })
  }
  for (const attr of contentAttributes(client, doc)) {
    result.push({ kind: 'content', attribute: attr.name, label: attr.label })
  }
  result.push({ kind: 'page' })
  return result
}

async function loadMarkup (client: Client, doc: Doc, attribute: string): Promise<Markup> {
  const attr = client.getHierarchy().findAttribute(doc._class, attribute)
  const value = (doc as unknown as Record<string, unknown>)[attribute]
  if (attr?.type._class === core.class.TypeCollaborativeDoc) {
    return await getMarkup(makeDocCollabId(doc, attribute), (value as Ref<Blob> | undefined) ?? null)
  }
  return (value as Markup | undefined) ?? ('' as Markup)
}

const REMOVED_TAGS = ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base', 'form', 'input', 'button']

/**
 * Make content safe and self-contained for offline rendering: no scripts or handlers, images inlined.
 */
async function prepareContent (root: HTMLElement): Promise<void> {
  for (const el of Array.from(root.querySelectorAll(REMOVED_TAGS.join(',')))) {
    el.remove()
  }
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const name of el.getAttributeNames()) {
      const value = el.getAttribute(name) ?? ''
      if (name.startsWith('on') || (name === 'href' && /^\s*javascript:/i.test(value))) {
        el.removeAttribute(name)
      } else if (name === 'style' && /url\s*\(/i.test(value)) {
        el.removeAttribute(name)
      }
    }
  }
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map(async (img) => {
      const fileId = img.getAttribute('file-id')
      const src = img.getAttribute('src') ?? ''
      try {
        if (fileId !== null && fileId !== '') {
          img.setAttribute('src', await loadAsDataUrl(fileId))
        } else if (!src.startsWith('data:')) {
          throw new Error('External image')
        }
        img.removeAttribute('srcset')
      } catch {
        // The renderer has no network access, keep the alternative text only
        const alt = document.createElement('span')
        alt.textContent = img.getAttribute('alt') ?? ''
        img.replaceWith(alt)
      }
    })
  )
}

/**
 * Split HTML into top-level blocks; loose inline content is wrapped into paragraphs.
 */
export function splitBlocks (root: HTMLElement): string[] {
  const blocks: string[] = []
  let inline: Node[] = []
  const flush = (): void => {
    if (inline.length === 0) return
    const p = document.createElement('p')
    inline.forEach((n) => p.appendChild(n))
    if ((p.textContent ?? '').trim() !== '' || p.querySelector('img') !== null) blocks.push(p.outerHTML)
    inline = []
  }
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && !['SPAN', 'A', 'STRONG', 'EM', 'B', 'I', 'CODE', 'IMG'].includes((node as Element).tagName)) {
      flush()
      blocks.push((node as Element).outerHTML)
    } else {
      inline.push(node)
    }
  }
  flush()
  return blocks
}

/**
 * Load the document rich text as body blocks.
 */
export async function loadContentBlocks (client: Client, doc: Doc, attribute: string): Promise<string[]> {
  const markup = await loadMarkup(client, doc, attribute)
  const html = markup !== '' ? jsonToHTML(markupToJSON(markup)) : ''
  return await htmlToBlocks(html)
}

export async function htmlToBlocks (html: string): Promise<string[]> {
  const root = document.createElement('div')
  root.innerHTML = html
  await prepareContent(root)
  return splitBlocks(root)
}

/**
 * Image file laid out as a single content block fitting the page.
 */
export async function imageBlocks (file: FileInfo): Promise<string[]> {
  const src = await loadAsDataUrl(file.file)
  return [`<p style="text-align:center"><img alt="${escapeHtml(file.name)}" src="${escapeHtml(src)}"/></p>`]
}

/**
 * Body HTML with the document title and page breaks before the selected blocks.
 */
export function buildContentHtml (blocks: string[], breaks: Set<number>, title?: string): string {
  const parts: string[] = []
  if (title !== undefined && title !== '') {
    parts.push(`<div class="${DOC_TITLE_CLASS}">${escapeHtml(title)}</div>`)
  }
  blocks.forEach((block, index) => {
    parts.push(breaks.has(index) ? markBreak(block) : block)
  })
  return parts.join('\n')
}

function markBreak (block: string): string {
  const template = document.createElement('template')
  template.innerHTML = block
  const el = template.content.firstElementChild
  if (el === null) return block
  el.setAttribute(PAGE_BREAK_ATTR, '')
  return el.outerHTML
}
