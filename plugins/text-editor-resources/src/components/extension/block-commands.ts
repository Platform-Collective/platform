// SPDX-License-Identifier: EPL-2.0

import { CommandManager, type ChainedCommands, type Editor, type Range } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export const BLOCK_COMMAND_IDS = [
  'heading-1',
  'heading-2',
  'heading-3',
  'bullet-list',
  'ordered-list',
  'blockquote'
] as const
export type BlockCommandId = (typeof BLOCK_COMMAND_IDS)[number]

export function isBlockCommandId (id: string): id is BlockCommandId {
  return BLOCK_COMMAND_IDS.some((command) => command === id)
}

export function isBlockCommandAvailable (editor: Editor, id: string): boolean {
  if (!editor.isEditable || !isBlockCommandId(id)) return false
  if (id === 'bullet-list' || id === 'ordered-list') {
    return (
      editor.schema.nodes[id === 'bullet-list' ? 'bulletList' : 'orderedList'] !== undefined &&
      editor.schema.nodes.listItem !== undefined
    )
  }
  if (id === 'blockquote') return editor.schema.nodes.blockquote !== undefined
  const level = Number(id.slice(-1))
  const heading = editor.extensionManager.extensions.find((extension) => extension.name === 'heading')
  return editor.schema.nodes.heading !== undefined && heading?.options.levels.includes(level) === true
}

function formatBlock (chain: ChainedCommands, id: BlockCommandId): ChainedCommands {
  switch (id) {
    case 'heading-1':
      return chain.setHeading({ level: 1 })
    case 'heading-2':
      return chain.setHeading({ level: 2 })
    case 'heading-3':
      return chain.setHeading({ level: 3 })
    case 'bullet-list':
      return chain.toggleBulletList()
    case 'ordered-list':
      return chain.toggleOrderedList()
    case 'blockquote':
      return chain.setBlockquote()
  }
}

export function runBlockCommand (editor: Editor | undefined, id: string, pos: number, range?: Range): boolean {
  if (editor === undefined || !isBlockCommandId(id) || !isBlockCommandAvailable(editor, id)) return false

  // Prepare the target explicitly, including side-menu positions that differ
  // from the current cursor. Failed commands keep the query.
  const prepare = (chain: ChainedCommands): ChainedCommands =>
    chain.command(({ tr }) => {
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos), 1))
      return true
    })
  const complete = (chain: ChainedCommands): ChainedCommands =>
    formatBlock(prepare(chain), id).command(({ tr }) => {
      // List lifting expects a transaction without earlier document changes.
      // Map the slash range after formatting so deletion follows the moved text.
      if (range !== undefined) tr.delete(tr.mapping.map(range.from), tr.mapping.map(range.to))
      return true
    })
  // List toggles skip some conversions in can() mode. A custom state makes the
  // command manager simulate the complete chain without dispatching to the view.
  const preview = new CommandManager({ editor, state: editor.state })
  if (!complete(preview.chain()).run()) return false

  // Remove the slash query and format in one transaction for native undo/redo.
  return complete(editor.chain()).focus(undefined, { scrollIntoView: false }).run()
}
