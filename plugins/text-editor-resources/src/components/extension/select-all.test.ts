// SPDX-License-Identifier: EPL-2.0

import { type Editor, getExtensionField, type KeyboardShortcutCommand } from '@tiptap/core'
import { selectAll } from '@tiptap/pm/commands'
import { type Node, Schema } from '@tiptap/pm/model'
import { AllSelection, EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { CellSelection, tableNodes } from '@tiptap/pm/tables'
import { CodeBlockHighlighExtension } from './codeSnippets/codeblock'
import { Table } from './table/table'

jest.mock('@hcengineering/text-editor', () => ({}))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('@hcengineering/highlight', () => ({ grammars: {} }))
jest.mock('@hcengineering/text', () => ({ codeBlockOptions: {} }))
jest.mock('lowlight', () => ({ createLowlight: () => ({}) }))
jest.mock('../node-view', () => ({}))
jest.mock('./toolbar/toolbar', () => ({}))
jest.mock('./table/actions', () => ({}))
jest.mock('./table/TableNodeView.svelte', () => ({}))
jest.mock('../icons/table/AddColAfter.svelte', () => ({}))
jest.mock('../icons/table/AddColBefore.svelte', () => ({}))
jest.mock('../icons/table/AddRowAfter.svelte', () => ({}))
jest.mock('../icons/table/AddRowBefore.svelte', () => ({}))
jest.mock('../icons/table/DeleteCol.svelte', () => ({}))
jest.mock('../icons/table/DeleteRow.svelte', () => ({}))
jest.mock('../icons/table/DeleteTable.svelte', () => ({}))

const tableSchema = tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} })
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    codeBlock: { group: 'block', content: 'text*', code: true },
    table: { ...tableSchema.table, content: 'tableRow+' },
    tableRow: { ...tableSchema.table_row, content: '(tableCell | tableHeader)+' },
    tableCell: tableSchema.table_cell,
    tableHeader: tableSchema.table_header
  }
})

function paragraph (text: string): Node {
  return schema.node('paragraph', null, text === '' ? [] : schema.text(text))
}

function table (type: 'tableCell' | 'tableHeader', content: Node[]): Node {
  return schema.node('table', null, [
    schema.node('tableRow', null, [
      schema.node(type, null, content),
      schema.node(type, null, [paragraph('other cell')])
    ])
  ])
}

describe('Mod-a within editor blocks', () => {
  let state: EditorState
  let editor: Editor
  let shortcuts: Array<Record<string, KeyboardShortcutCommand>>

  function dispatch (tr: Transaction): void {
    state = state.apply(tr)
  }

  function createEditor (block: Node): void {
    state = EditorState.create({ doc: schema.node('doc', null, [paragraph('before'), block, paragraph('after')]) })
    editor = {
      get state () {
        return state
      },
      commands: {
        setTextSelection: jest.fn(({ from, to }: { from: number, to: number }) => {
          dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
          return true
        }),
        toggleCodeBlock: jest.fn(() => true)
      }
    } as unknown as Editor
    shortcuts = [CodeBlockHighlighExtension, Table].map((extension) => {
      const addKeyboardShortcuts = getExtensionField<() => Record<string, KeyboardShortcutCommand>>(
        extension,
        'addKeyboardShortcuts',
        { editor, name: extension.name, options: extension.options, storage: extension.storage }
      )
      return addKeyboardShortcuts?.() ?? {}
    })
  }

  function selectText (text: string, reverse = false): { from: number, to: number } {
    let from = -1
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === text) from = pos
    })
    expect(from).toBeGreaterThanOrEqual(0)
    const to = from + text.length
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, reverse ? to : from + 1, reverse ? from : from + 1)))
    return { from, to }
  }

  function pressSelectAll (): void {
    for (const bindings of shortcuts) {
      if (bindings['Mod-a']?.({ editor })) return
    }
    expect(selectAll(state, dispatch)).toBe(true)
  }

  function expectSelection (from: number, to: number): void {
    expect(state.selection).toBeInstanceOf(from === 0 ? AllSelection : TextSelection)
    expect(state.selection.from).toBe(from)
    expect(state.selection.to).toBe(to)
  }

  it.each(['tableCell', 'tableHeader'] as const)('selects only the active %s, then the document', (type) => {
    createEditor(table(type, [paragraph('cell text')]))
    const { from, to } = selectText('cell text')

    pressSelectAll()
    expectSelection(from, to)
    pressSelectAll()
    expectSelection(0, state.doc.content.size)
  })

  it('selects all paragraphs in the active cell', () => {
    createEditor(table('tableCell', [paragraph('first'), paragraph('last')]))
    const { to } = selectText('last')
    const { from } = selectText('first')

    pressSelectAll()
    expectSelection(from, to)
    pressSelectAll()
    expectSelection(0, state.doc.content.size)
  })

  it('selects only the active code block, then the document', () => {
    createEditor(schema.node('codeBlock', null, schema.text('line one\nline two')))
    const { from, to } = selectText('line one\nline two')

    pressSelectAll()
    expectSelection(from, to)
    pressSelectAll()
    expectSelection(0, state.doc.content.size)
  })

  it.each([false, true])('reaches the document from a code block in a cell (table first: %s)', (tableFirst) => {
    createEditor(table('tableCell', [schema.node('codeBlock', null, schema.text('code')), paragraph('last')]))
    if (tableFirst) shortcuts.reverse()
    const { to: cellEnd } = selectText('last')
    const { from, to } = selectText('code')

    pressSelectAll()
    if (!tableFirst) {
      expectSelection(from, to)
      pressSelectAll()
    }
    expectSelection(from, cellEnd)
    pressSelectAll()
    expectSelection(0, state.doc.content.size)
  })

  it.each([
    ['tableCell', 'cell text'],
    ['tableCell', 'other cell'],
    ['tableHeader', 'cell text'],
    ['tableHeader', 'other cell']
  ] as const)('falls through for a %s selection ending in %s', (type, end) => {
    createEditor(table(type, [paragraph('cell text')]))
    const { from } = selectText('cell text')
    const { from: endFrom } = selectText(end)
    dispatch(state.tr.setSelection(CellSelection.create(state.doc, from - 2, endFrom - 2)))

    pressSelectAll()
    expectSelection(0, state.doc.content.size)
  })

  it.each(['other cell', 'after'])('falls through for a selection from a cell to %s', (end) => {
    createEditor(table('tableCell', [paragraph('cell text')]))
    const { from } = selectText('cell text')
    const { to } = selectText(end)
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)))

    pressSelectAll()
    expectSelection(0, state.doc.content.size)
  })

  it.each(['tableCell', 'tableHeader', 'codeBlock'] as const)(
    'falls through when the %s content is already selected backwards',
    (type) => {
      createEditor(
        type === 'codeBlock' ? schema.node(type, null, schema.text('selected')) : table(type, [paragraph('selected')])
      )
      selectText('selected', true)

      pressSelectAll()
      expectSelection(0, state.doc.content.size)
    }
  )

  it('preserves document selection outside a table or code block', () => {
    createEditor(table('tableCell', [paragraph('cell text')]))
    selectText('before')

    pressSelectAll()
    expectSelection(0, state.doc.content.size)
  })

  it('preserves inherited code block shortcuts', () => {
    createEditor(schema.node('codeBlock', null, schema.text('code')))

    expect(shortcuts[0]['Mod-Alt-c']({ editor })).toBe(true)
    expect(editor.commands.toggleCodeBlock).toHaveBeenCalledTimes(1)
  })
})
