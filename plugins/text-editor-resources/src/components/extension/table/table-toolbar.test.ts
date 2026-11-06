// SPDX-License-Identifier: EPL-2.0

import { type Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { CellSelection, TableMap, tableNodes } from '@tiptap/pm/tables'

import { TableSelection } from './types'
import { findTableToolbarAnchor } from './utils'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    blockquote: { group: 'block', content: 'block+' },
    text: {},
    ...tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} })
  }
})

interface TableFixture {
  doc: ProseMirrorNode
  table: ProseMirrorNode
  tablePos: number
  cellPos: (row: number, column: number) => number
}

function createTable (): TableFixture {
  const paragraph = schema.nodes.paragraph.create(null, schema.text('Cell'))
  const rows = Array.from({ length: 60 }, (_, row) => {
    const cellType = row === 0 ? schema.nodes.table_header : schema.nodes.table_cell
    return schema.nodes.table_row.create(null, [cellType.create(null, paragraph), cellType.create(null, paragraph)])
  })
  const table = schema.nodes.table.create(null, rows)
  const doc = schema.nodes.doc.create(null, [paragraph, table, paragraph])
  const tablePos = paragraph.nodeSize
  const map = TableMap.get(table)
  const cellPos = (row: number, column: number): number => tablePos + 1 + map.map[row * map.width + column]
  return { doc, table, tablePos, cellPos }
}

describe('table toolbar anchor', () => {
  it.each([
    [0, 0],
    [0, 1],
    [30, 0],
    [30, 1],
    [59, 0],
    [59, 1]
  ])('anchors the text cursor in row %i, column %i to its cell', (row, column) => {
    const { doc, cellPos } = createTable()
    const pos = cellPos(row, column)
    const selection = TextSelection.create(doc, pos + 2)

    const anchor = findTableToolbarAnchor(selection)

    expect(anchor?.pos).toBe(pos)
    expect(anchor?.node).toBe(doc.nodeAt(pos))
  })

  it('finds the containing cell when the cursor is inside a nested block', () => {
    const paragraph = schema.nodes.paragraph.create(null, schema.text('Nested'))
    const blockquote = schema.nodes.blockquote.create(null, paragraph)
    const cell = schema.nodes.table_cell.create(null, blockquote)
    const table = schema.nodes.table.create(null, schema.nodes.table_row.create(null, cell))
    const doc = schema.nodes.doc.create(null, table)

    expect(findTableToolbarAnchor(TextSelection.create(doc, 5))).toMatchObject({ node: cell, pos: 2 })
  })

  it('preserves the table anchor for a nonempty text selection', () => {
    const { doc, table, tablePos, cellPos } = createTable()
    const pos = cellPos(30, 0)

    expect(findTableToolbarAnchor(TextSelection.create(doc, pos + 2, pos + 3))).toMatchObject({
      node: table,
      pos: tablePos
    })
  })

  it('preserves cell, row, column and whole-table selection handling', () => {
    const { doc, table, tablePos, cellPos } = createTable()
    const $cell = doc.resolve(cellPos(30, 0))
    const selections = [
      new CellSelection($cell),
      CellSelection.rowSelection($cell),
      CellSelection.colSelection($cell),
      new TableSelection(doc.resolve(cellPos(0, 0)), doc.resolve(cellPos(59, 1)))
    ]

    for (const selection of selections) {
      expect(findTableToolbarAnchor(selection)).toMatchObject({ node: table, pos: tablePos })
    }
  })

  it('preserves the table anchor for a selected node inside a cell', () => {
    const { doc, table, tablePos, cellPos } = createTable()

    expect(findTableToolbarAnchor(NodeSelection.create(doc, cellPos(30, 0) + 1))).toMatchObject({
      node: table,
      pos: tablePos
    })
  })

  it('does not resolve an anchor outside a table', () => {
    const { doc } = createTable()

    expect(findTableToolbarAnchor(TextSelection.create(doc, 1))).toBeUndefined()
  })
})
