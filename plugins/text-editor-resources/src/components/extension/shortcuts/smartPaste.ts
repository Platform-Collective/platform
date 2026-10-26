//
// Copyright © 2025 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { MarkupMarkType, MarkupNodeType, type MarkupNode } from '@hcengineering/text'
import { markdownToMarkup } from '@hcengineering/text-markdown'
import { Extension } from '@tiptap/core'
import { Node, type Schema } from '@tiptap/pm/model'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import { CodeBlockHighlighExtension } from '../codeSnippets/codeblock'
import { hasTableMetadataMarker } from './tableMetadata'

export const SmartPasteExtension = Extension.create({
  name: 'transformPastedContent',

  addProseMirrorPlugins () {
    return [PasteTextAsMarkdownPlugin()]
  }
})

export function PasteTextAsMarkdownPlugin (): Plugin {
  return new Plugin({
    props: {
      transformPastedHTML: normalizePastedHTML,

      handlePaste (view, event, slice) {
        const clipboardData = event.clipboardData
        if (clipboardData === null) return false

        const pastedText = clipboardData.getData('text/plain')
        const pastedMarkdown = clipboardData.getData('text/markdown')

        // Ignore smart paste inside code blocks / mermaid blocks (keep default paste behavior).
        const selection = view.state.selection
        const ignoredNodeTypes = new Set<string>([CodeBlockHighlighExtension.name, 'mermaid'])
        if (selection instanceof NodeSelection && ignoredNodeTypes.has(selection.node.type.name)) {
          return false
        }
        const { $from } = selection
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d)
          if (ignoredNodeTypes.has(node.type.name)) {
            return false
          }
        }

        // If the clipboard explicitly provides markdown, prefer it even if other types (e.g. html) exist.
        const hasMarkdown = pastedMarkdown.trim().length > 0
        const markdownSource = hasMarkdown ? pastedMarkdown : pastedText

        // Table copies include metadata comment; treat as markdown even when clipboard has rich types.
        const hasTableMetadata = hasTableMetadataMarker(pastedText) || hasTableMetadataMarker(pastedMarkdown)

        const isPlainPaste = clipboardData.types.length === 1 && clipboardData.types[0] === 'text/plain'

        // Keep default paste behavior for rich clipboard formats, unless markdown is explicitly present.
        if (!hasMarkdown && !hasTableMetadata && !isPlainPaste) return false

        try {
          const markupNode = cleanUnknownContent(view.state.schema, markdownToMarkup(markdownSource))
          if (shouldUseMarkdownOutput(markupNode)) {
            const content = Node.fromJSON(view.state.schema, markupNode)
            content.check()

            const transaction = view.state.tr.replaceSelectionWith(content)
            view.dispatch(transaction)
            return true
          }
        } catch (e) {
          console.log('Unable to convert plain text to markdown:', e)
        }

        return false
      }
    }
  })
}

function normalizePastedHTML (html: string): string {
  html = normalizeSlackPastedHTML(html)
  if (!/<(?:pre|code)\b/i.test(html)) return html

  const document = new DOMParser().parseFromString(html, 'text/html')
  let changed = false

  document.querySelectorAll('code').forEach((code) => {
    const pre = code.closest('pre')
    const content = code.cloneNode(true) as HTMLElement
    content.querySelectorAll('br').forEach((br) => {
      br.replaceWith('\n')
    })
    const text = content.textContent ?? ''
    if (pre === null && !/[\r\n]/.test(text)) return

    // Keep code text and its language class, excluding surrounding labels and controls.
    code.textContent = text
    if (pre !== null) {
      // Only strip surrounding labels and controls when the block holds a single code element
      if (pre.querySelectorAll('code').length === 1) {
        pre.replaceChildren(code)
      }
    } else {
      const block = document.createElement('pre')
      code.replaceWith(block)
      block.append(code)

      // Split a surrounding paragraph so serializing the block produces valid HTML.
      const paragraph = block.closest('p')
      if (paragraph !== null) {
        const range = document.createRange()
        range.selectNodeContents(paragraph)
        range.setStartAfter(block)
        const after = paragraph.cloneNode(false) as HTMLElement
        after.append(range.extractContents())
        paragraph.after(block)
        if (after.hasChildNodes()) block.after(after)
        if (!paragraph.hasChildNodes()) paragraph.remove()
      }
    }
    changed = true
  })

  return changed ? document.body.innerHTML : html
}

export function normalizeSlackPastedHTML (html: string): string {
  if (!html.includes('data-stringify-type')) return html

  const tagStack: boolean[] = []
  let slackContentDepth = 0

  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      const openingTag = /^<([a-z][\w:-]*)\b[^>]*>$/i.exec(part)
      if (openingTag !== null) {
        const isSlackContent = /\sdata-stringify-type(?:\s|=|>)/i.test(part)
        const isVoidElement = /\/>$/.test(part) || ['br', 'img', 'meta'].includes(openingTag[1].toLowerCase())

        if (!isVoidElement) {
          tagStack.push(isSlackContent)
          if (isSlackContent) {
            slackContentDepth++
          }
        }
        return part
      }

      if (/^<\/[a-z][\w:-]*\s*>$/i.test(part)) {
        if (tagStack.pop() === true) {
          slackContentDepth--
        }
        return part
      }

      return slackContentDepth > 0 ? part.replace(/\r\n?|\n/g, '<br>') : part
    })
    .join('')
}

const importantMarkupNodeTypes = new Set<MarkupNodeType>([
  MarkupNodeType.code_block,
  MarkupNodeType.bullet_list,
  MarkupNodeType.list_item,
  MarkupNodeType.table,
  MarkupNodeType.todoList,
  MarkupNodeType.ordered_list,
  MarkupNodeType.reference,
  MarkupNodeType.image,
  MarkupNodeType.heading,
  MarkupNodeType.mermaid
])

const importantMarkupMarkTypes = new Set<MarkupMarkType>([
  MarkupMarkType.bold,
  MarkupMarkType.em,
  MarkupMarkType.code,
  MarkupMarkType.link
])

export function cleanUnknownContent (schema: Schema, node: MarkupNode): MarkupNode {
  const traverse = (node: MarkupNode): void => {
    if (node.content === undefined) {
      return
    }
    node.content = node.content.filter((child) => schema.nodes[child.type] !== undefined)
    node.content.forEach((child) => {
      traverse(child)
    })
  }

  traverse(node)
  return node
}

export function shouldUseMarkdownOutput (node: MarkupNode): boolean {
  const counter = {
    importantNodes: 0,
    importantMarks: 0
  }

  const traverse = (node: MarkupNode): void => {
    if (importantMarkupNodeTypes.has(node.type)) {
      counter.importantNodes++
    }

    if (node.type === MarkupNodeType.text) {
      for (const mark of node.marks ?? []) {
        if (importantMarkupMarkTypes.has(mark.type)) {
          counter.importantMarks++
        }
      }
    }

    ;(node.content ?? []).forEach((child) => {
      traverse(child)
    })
  }

  traverse(node)
  return counter.importantNodes > 0 || counter.importantMarks > 0
}
