//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { Extension, getTextSerializersFromSchema, type TextSerializer } from '@tiptap/core'
import { type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const blockSeparator = '\n\n'
const tightSeparator = '\n'

const bulletLists = new Set(['bulletList'])
const orderedLists = new Set(['orderedList'])
const checkLists = new Set(['todoList', 'taskList'])
const listItems = new Set(['listItem', 'todoItem', 'taskItem'])

/**
 * Fallbacks for inline nodes that have no `renderText` of their own,
 * so they do not vanish from the plain text clipboard content.
 */
const defaultTextSerializers: Record<string, TextSerializer> = {
  reference: ({ node }) => `@${node.attrs.label ?? node.attrs.id ?? ''}`,
  emoji: ({ node }) => node.attrs.emoji ?? ''
}

interface Context {
  from: number
  to: number
  serializers: Record<string, TextSerializer>
}

/**
 * Serializes the document range to plain text for the clipboard.
 *
 * Unlike the default serializer, which puts a blank line before every block (so a list item
 * containing a paragraph ends up separated by several empty lines), list items and table rows
 * are placed on consecutive lines, list items get a marker and nested content is indented.
 */
export function serializePlainText (
  doc: ProseMirrorNode,
  from: number,
  to: number,
  textSerializers: Record<string, TextSerializer> = {}
): string {
  const ctx: Context = { from, to, serializers: { ...defaultTextSerializers, ...textSerializers } }

  // Start from the deepest node containing the whole range, so a selection inside a single
  // list item paragraph is copied as is, without a list marker.
  const $from = doc.resolve(from)
  const depth = $from.sharedDepth(to)

  return serializeContent($from.node(depth), $from.start(depth), ctx)
}

function serializeNode (
  node: ProseMirrorNode,
  pos: number,
  parent: ProseMirrorNode,
  index: number,
  ctx: Context
): string | undefined {
  const serializer = ctx.serializers[node.type.name]
  if (serializer !== undefined) {
    return serializer({ node, pos, parent, index, range: { from: ctx.from, to: ctx.to } })
  }

  if (node.isText) {
    const text = node.text ?? ''
    return text.slice(Math.max(ctx.from, pos) - pos, ctx.to - pos)
  }

  if (node.isLeaf) {
    const text = node.type.spec.leafText?.(node) ?? ''
    // Skip block leaves without text (images, rulers, etc.) instead of leaving empty lines.
    return text === '' && node.isBlock ? undefined : text
  }

  return serializeContent(node, pos + 1, ctx)
}

function serializeContent (node: ProseMirrorNode, start: number, ctx: Context): string {
  const parts: Array<{ text: string, index: number }> = []

  node.forEach((child, offset, index) => {
    const pos = start + offset
    if (pos + child.nodeSize <= ctx.from || pos >= ctx.to) return

    const text = serializeNode(child, pos, node, index, ctx)
    if (text !== undefined) {
      parts.push({ text, index })
    }
  })

  if (node.isTextblock) {
    return parts.map((p) => p.text).join('')
  }

  const name = node.type.name
  if (bulletLists.has(name) || orderedLists.has(name) || checkLists.has(name)) {
    return parts
      .map((p) => {
        const marker = getListMarker(node, p.index)
        return marker + p.text.split('\n').join('\n' + ' '.repeat(marker.length))
      })
      .join(tightSeparator)
  }

  return parts.map((p) => p.text).join(getSeparator(node))
}

function getListMarker (list: ProseMirrorNode, index: number): string {
  const name = list.type.name
  if (orderedLists.has(name)) {
    const start = Number(list.attrs.start ?? 1)
    return `${(Number.isFinite(start) ? start : 1) + index}. `
  }
  if (checkLists.has(name)) {
    return list.child(index).attrs.checked === true ? '[x] ' : '[ ] '
  }
  return '- '
}

function getSeparator (node: ProseMirrorNode): string {
  const tableRole = node.type.spec.tableRole
  if (tableRole === 'row') return '\t'
  if (tableRole === 'cell' || tableRole === 'header_cell') return ' '
  if (tableRole === 'table') return tightSeparator

  // List items keep their paragraphs and nested lists on consecutive lines.
  if (listItems.has(node.type.name)) return tightSeparator

  return blockSeparator
}

/**
 * Replaces the plain text (text/plain) clipboard serializer, which is used when content
 * is pasted into applications that do not accept HTML.
 */
export const PlainTextCopyExtension = Extension.create({
  name: 'plainTextCopy',

  // Must take precedence over the tiptap core ClipboardTextSerializer extension.
  priority: 1000,

  addProseMirrorPlugins () {
    return [
      new Plugin({
        key: new PluginKey('plainTextCopy'),
        props: {
          clipboardTextSerializer: (_slice, view) => {
            const { ranges } = view.state.selection
            const from = Math.min(...ranges.map((range) => range.$from.pos))
            const to = Math.max(...ranges.map((range) => range.$to.pos))

            return serializePlainText(view.state.doc, from, to, getTextSerializersFromSchema(view.state.schema))
          }
        }
      })
    ]
  }
})
