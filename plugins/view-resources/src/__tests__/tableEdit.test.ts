//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  EditJournal,
  coalesceOps,
  copyRect,
  createBatch,
  decodeTsv,
  encodeTsv,
  extendRectDown,
  extendSelection,
  fillDown,
  formatDateValue,
  formatMultiOptionValue,
  invertOps,
  isNoop,
  movePos,
  moveSelection,
  parseDateValue,
  parseMultiOptionValue,
  parseNumberValue,
  parseOptionValue,
  parseTextValue,
  placePaste,
  planClear,
  planEdits,
  rectCells,
  rectOf,
  tabPos,
  updateOp,
  type CellAdapter,
  type CellColumn,
  type DocTarget,
  type EditOp
} from '../tableEdit'

const dims = { rows: 4, cols: 3 }

describe('tsv', () => {
  it('encodes rows with tabs and line breaks', () => {
    expect(
      encodeTsv([
        ['a', 'b'],
        ['c', '']
      ])
    ).toBe('a\tb\nc\t')
  })

  it('quotes cells that contain separators or quotes', () => {
    expect(encodeTsv([['a\tb', 'say "hi"', 'x\ny']])).toBe('"a\tb"\t"say ""hi"""\t"x\ny"')
  })

  it('decodes what it encodes', () => {
    const block = [
      ['plain', 'with\ttab', 'with "quote"'],
      ['multi\nline', '', 'end']
    ]
    expect(decodeTsv(encodeTsv(block))).toEqual(block)
  })

  it('ignores one trailing line break and understands CRLF', () => {
    expect(decodeTsv('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
    expect(decodeTsv('a\n')).toEqual([['a']])
  })

  it('keeps a trailing empty cell and empty rows in between', () => {
    expect(decodeTsv('a\t\n\nb')).toEqual([['a', ''], [''], ['b']])
  })

  it('gives no rows for empty text', () => {
    expect(decodeTsv('')).toEqual([])
  })

  it('does not treat a quote in the middle of a cell as quoting', () => {
    expect(decodeTsv('5" pipe\tx')).toEqual([['5" pipe', 'x']])
  })
})

describe('grid', () => {
  it('moves and clamps at the edges', () => {
    expect(movePos({ row: 0, col: 0 }, 'up', dims)).toEqual({ row: 0, col: 0 })
    expect(movePos({ row: 3, col: 2 }, 'down', dims)).toEqual({ row: 3, col: 2 })
    expect(movePos({ row: 1, col: 1 }, 'right', dims)).toEqual({ row: 1, col: 2 })
    expect(movePos({ row: 1, col: 1 }, 'down', dims, true)).toEqual({ row: 3, col: 1 })
    expect(movePos({ row: 1, col: 1 }, 'left', dims, true)).toEqual({ row: 1, col: 0 })
  })

  it('collapses the selection on a plain move and keeps the anchor when extending', () => {
    const sel = { anchor: { row: 1, col: 1 }, focus: { row: 2, col: 2 } }
    expect(moveSelection(sel, 'up', dims)).toEqual({ anchor: { row: 1, col: 2 }, focus: { row: 1, col: 2 } })
    const ext = extendSelection({ anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } }, 'down', dims)
    expect(ext).toEqual({ anchor: { row: 1, col: 1 }, focus: { row: 2, col: 1 } })
    expect(rectOf(ext.anchor, ext.focus)).toEqual({ top: 1, bottom: 2, left: 1, right: 1 })
  })

  it('tabs across rows', () => {
    expect(tabPos({ row: 0, col: 1 }, dims, false)).toEqual({ row: 0, col: 2 })
    expect(tabPos({ row: 0, col: 2 }, dims, false)).toEqual({ row: 1, col: 0 })
    expect(tabPos({ row: 3, col: 2 }, dims, false)).toEqual({ row: 3, col: 2 })
    expect(tabPos({ row: 1, col: 0 }, dims, true)).toEqual({ row: 0, col: 2 })
    expect(tabPos({ row: 0, col: 0 }, dims, true)).toEqual({ row: 0, col: 0 })
  })

  it('lists the cells of a rectangle row by row', () => {
    expect(rectCells({ top: 0, bottom: 1, left: 1, right: 2 })).toEqual([
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 1 },
      { row: 1, col: 2 }
    ])
  })

  it('fills the whole selection with a single pasted value', () => {
    const res = placePaste({ top: 0, bottom: 1, left: 0, right: 1 }, [['x']], dims)
    expect(res.cells).toHaveLength(4)
    expect(res.clipped).toBe(0)
  })

  it('places a pasted block from the top left of the selection and clips it', () => {
    const res = placePaste({ top: 2, bottom: 2, left: 1, right: 1 }, [['a', 'b'], ['c', 'd'], ['e']], dims)
    // Column 2 is the last one, row 3 the last row: b is at (2,2), c at (3,1), d (3,2) fits, e is below the grid
    expect(res.cells.map((c) => [c.target.row, c.target.col, c.fromRow, c.fromCol])).toEqual([
      [2, 1, 0, 0],
      [2, 2, 0, 1],
      [3, 1, 1, 0],
      [3, 2, 1, 1]
    ])
    expect(res.clipped).toBe(1)
  })

  it('places nothing for an empty block', () => {
    expect(placePaste({ top: 0, bottom: 0, left: 0, right: 0 }, [], dims).cells).toEqual([])
  })

  it('fills down by repeating the selected rows', () => {
    const sel = { top: 0, bottom: 1, left: 0, right: 0 }
    const res = fillDown(sel, 4, { rows: 6, cols: 3 })
    expect(res.map((f) => [f.target.row, f.source.row])).toEqual([
      [2, 0],
      [3, 1],
      [4, 0]
    ])
  })

  it('copies a single row to every row below and covers several columns', () => {
    const res = fillDown({ top: 1, bottom: 1, left: 0, right: 1 }, 2, dims)
    expect(res).toEqual([
      { target: { row: 2, col: 0 }, source: { row: 1, col: 0 } },
      { target: { row: 2, col: 1 }, source: { row: 1, col: 1 } }
    ])
  })

  it('fills nothing when dragged up or inside the selection, and stops at the grid end', () => {
    expect(fillDown({ top: 1, bottom: 2, left: 0, right: 0 }, 2, dims)).toEqual([])
    expect(fillDown({ top: 1, bottom: 2, left: 0, right: 0 }, 0, dims)).toEqual([])
    expect(fillDown({ top: 1, bottom: 2, left: 0, right: 0 }, 99, dims)).toHaveLength(1)
    expect(extendRectDown({ top: 1, bottom: 2, left: 0, right: 0 }, 99, dims).bottom).toBe(3)
  })

  it('copies a rectangle through a reader', () => {
    const rows = copyRect({ top: 1, bottom: 2, left: 0, right: 1 }, (r, c) => `${r}${c}`)
    expect(rows).toEqual([
      ['10', '11'],
      ['20', '21']
    ])
  })
})

describe('values', () => {
  it('parses text, empty means clear', () => {
    expect(parseTextValue('  hi ')).toEqual({ ok: true, value: 'hi' })
    expect(parseTextValue('  ')).toEqual({ ok: true, value: null })
  })

  it('parses numbers', () => {
    expect(parseNumberValue('12.5')).toEqual({ ok: true, value: 12.5 })
    expect(parseNumberValue('-3')).toEqual({ ok: true, value: -3 })
    expect(parseNumberValue('')).toEqual({ ok: true, value: null })
    expect(parseNumberValue('abc')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseNumberValue('1,5')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseNumberValue('1.5', { integer: true })).toEqual({ ok: false, reason: 'invalid' })
    expect(parseNumberValue('-1', { min: 0 })).toEqual({ ok: false, reason: 'invalid' })
  })

  it('parses dates as the start of the local day', () => {
    const res = parseDateValue('2026-03-05')
    expect(res).toEqual({ ok: true, value: new Date(2026, 2, 5).getTime() })
    expect(parseDateValue('2026-03-05 14:30')).toEqual(res)
    expect(parseDateValue('2026/3/5')).toEqual(res)
    expect(parseDateValue('')).toEqual({ ok: true, value: null })
    expect(parseDateValue('2026-02-31')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseDateValue('tomorrow')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('understands @today with an offset', () => {
    const now = new Date(2026, 0, 31, 15, 0).getTime()
    expect(parseDateValue('@today+1d', now)).toEqual({ ok: true, value: new Date(2026, 1, 1).getTime() })
    expect(parseDateValue('@today', now)).toEqual({ ok: true, value: new Date(2026, 0, 31).getTime() })
  })

  it('formats dates', () => {
    expect(formatDateValue(new Date(2026, 2, 5, 18).getTime())).toBe('2026-03-05')
    expect(formatDateValue(null)).toBe('')
    expect(formatDateValue(undefined)).toBe('')
  })

  const options = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
    { id: 'c', label: 'Beta' }
  ]

  it('parses a single option by label, then by id', () => {
    expect(parseOptionValue(' alpha ', options)).toEqual({ ok: true, value: 'a' })
    expect(parseOptionValue('A', options)).toEqual({ ok: true, value: 'a' })
    expect(parseOptionValue('', options)).toEqual({ ok: true, value: null })
    expect(parseOptionValue('Gamma', options)).toEqual({ ok: false, reason: 'unknown' })
    expect(parseOptionValue('beta', options)).toEqual({ ok: false, reason: 'ambiguous' })
  })

  it('parses numeric ids', () => {
    expect(parseOptionValue('High', [{ id: 2, label: 'High' }])).toEqual({ ok: true, value: 2 })
  })

  it('parses several options and rejects the cell on an unknown one', () => {
    expect(parseMultiOptionValue('Alpha, alpha; ', options)).toEqual({ ok: true, value: ['a'] })
    expect(parseMultiOptionValue('', options)).toEqual({ ok: true, value: [] })
    expect(parseMultiOptionValue('Alpha, Nope', options)).toEqual({ ok: false, reason: 'unknown' })
    expect(formatMultiOptionValue(['a', 'b'], options)).toBe('Alpha, Beta')
  })
})

const target = (id: string): DocTarget => ({ _id: id, _class: 'cls', space: 'sp' })

describe('journal', () => {
  const doc = { _id: 'd1', title: 'Old', dueDate: undefined }

  it('records previous values, null when unset', () => {
    const op = updateOp(target('d1'), doc, { title: 'New', dueDate: 5 })
    expect(op).toEqual({
      kind: 'update',
      target: target('d1'),
      before: { title: 'Old', dueDate: null },
      after: { title: 'New', dueDate: 5 }
    })
    expect(isNoop(updateOp(target('d1'), doc, { title: 'Old' }))).toBe(true)
    expect(isNoop(updateOp(target('d1'), doc, { dueDate: null }))).toBe(true)
  })

  it('coalesces updates of one document keeping the first before and the last after', () => {
    const ops: EditOp[] = [
      { kind: 'update', target: target('d1'), before: { a: 1 }, after: { a: 2 } },
      { kind: 'update', target: target('d1'), before: { a: 2, b: 0 }, after: { a: 3, b: 1 } },
      { kind: 'update', target: target('d2'), before: { a: 1 }, after: { a: 1 } }
    ]
    expect(coalesceOps(ops)).toEqual([
      { kind: 'update', target: target('d1'), before: { a: 1, b: 0 }, after: { a: 3, b: 1 } }
    ])
  })

  it('inverts operations in reverse order', () => {
    const ops: EditOp[] = [
      { kind: 'update', target: target('d1'), before: { a: 1 }, after: { a: 2 } },
      { kind: 'add', target: target('t1'), attributes: { tag: 'x' } }
    ]
    expect(invertOps(ops)).toEqual([
      { kind: 'remove', target: target('t1'), attributes: { tag: 'x' } },
      { kind: 'update', target: target('d1'), before: { a: 2 }, after: { a: 1 } }
    ])
  })

  it('undoes and redoes batches', async () => {
    const journal = new EditJournal()
    const ran: EditOp[][] = []
    const run = async (ops: readonly EditOp[]): Promise<void> => {
      ran.push([...ops])
    }
    const batch = createBatch('b1', [
      { kind: 'update', target: target('d1'), before: { a: 1 }, after: { a: 2 } },
      { kind: 'update', target: target('d2'), before: { a: 1 }, after: { a: 2 } }
    ])
    expect(batch.count).toBe(2)
    journal.record(batch)
    expect(journal.canUndo).toBe(true)

    expect(await journal.undo(run, 'other')).toBeUndefined()
    expect(await journal.undo(run, 'b1')).toBe(batch)
    expect(ran[0][0]).toEqual({ kind: 'update', target: target('d2'), before: { a: 2 }, after: { a: 1 } })
    expect(journal.canUndo).toBe(false)
    expect(journal.canRedo).toBe(true)

    expect(await journal.redo(run)).toBe(batch)
    expect(ran[1]).toEqual(batch.ops)
    expect(journal.canUndo).toBe(true)
  })

  it('keeps the batch undoable when reverting fails and drops redo on a new batch', async () => {
    const journal = new EditJournal(2)
    journal.record(createBatch('b1', [{ kind: 'add', target: target('x'), attributes: {} }]))
    await expect(
      journal.undo(async () => {
        throw new Error('offline')
      })
    ).rejects.toThrow('offline')
    expect(journal.canUndo).toBe(true)

    await journal.undo(async () => {})
    expect(journal.canRedo).toBe(true)
    journal.record(createBatch('b2', [{ kind: 'add', target: target('y'), attributes: {} }]))
    expect(journal.canRedo).toBe(false)

    journal.record(createBatch('b3', [{ kind: 'add', target: target('z'), attributes: {} }]))
    journal.record(createBatch('b4', [{ kind: 'add', target: target('w'), attributes: {} }]))
    // The oldest batch fell off the limit of two
    expect(journal.lastBatch?.id).toBe('b4')
    journal.clear()
    expect(journal.canUndo).toBe(false)
  })

  it('ignores empty batches', () => {
    const journal = new EditJournal()
    journal.record(createBatch('e', []))
    expect(journal.canUndo).toBe(false)
  })
})

interface Item {
  _id: string
  title: string
  estimate?: number
  customFields?: Record<string, unknown>
}

const itemTarget = (item: Item): DocTarget => ({ _id: item._id, _class: 'item', space: 'sp' })

const columns: Record<string, CellColumn<Item>> = {
  title: {
    key: 'title',
    format: (d) => d.title,
    edit: (d, text) => {
      const t = text.trim()
      return t === '' ? { ok: false, reason: 'notClearable' } : { ok: true, value: [updateOp(itemTarget(d), d as any, { title: t })] }
    }
  },
  estimate: {
    key: 'estimate',
    clearable: true,
    format: (d) => (d.estimate === undefined ? '' : String(d.estimate)),
    edit: (d, text) => {
      const n = parseNumberValue(text)
      return n.ok ? { ok: true, value: [updateOp(itemTarget(d), d as any, { estimate: n.value })] } : n
    }
  },
  cfA: {
    key: 'cfA',
    clearable: true,
    format: () => '',
    edit: (d, text) => ({
      ok: true,
      value: [updateOp(itemTarget(d), d as any, { customFields: { ...d.customFields, a: text } })]
    })
  },
  cfB: {
    key: 'cfB',
    clearable: true,
    format: () => '',
    edit: (d, text) => ({
      ok: true,
      value: [updateOp(itemTarget(d), d as any, { customFields: { ...d.customFields, b: text } })]
    })
  },
  id: { key: 'id', format: (d) => d._id }
}
const adapter: Pick<CellAdapter<Item>, 'column'> = { column: (key) => columns[key] }

describe('planEdits', () => {
  const d1: Item = { _id: 'd1', title: 'One', estimate: 1 }
  const d2: Item = { _id: 'd2', title: 'Two' }

  it('applies valid cells and counts skipped ones', () => {
    const plan = planEdits(
      [
        { doc: d1, key: 'estimate', text: '5' },
        { doc: d2, key: 'estimate', text: 'abc' },
        { doc: d2, key: 'id', text: 'x' },
        { doc: d2, key: 'missing', text: 'x' },
        { doc: d2, key: 'title', text: 'Renamed' }
      ],
      adapter
    )
    expect(plan.applied).toBe(2)
    expect(plan.skipped).toBe(3)
    expect(plan.skippedBy).toEqual({ invalid: 1, readonly: 1, noColumn: 1 })
    expect(plan.items).toBe(2)
    expect(plan.ops).toHaveLength(2)
  })

  it('does not count cells that already hold the value', () => {
    const plan = planEdits([{ doc: d1, key: 'estimate', text: '1' }], adapter)
    expect(plan).toMatchObject({ applied: 0, unchanged: 1, skipped: 0, ops: [] })
  })

  it('combines several cells of one document so that none is lost', () => {
    const plan = planEdits(
      [
        { doc: d1, key: 'cfA', text: 'x' },
        { doc: d1, key: 'cfB', text: 'y' }
      ],
      adapter
    )
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        target: itemTarget(d1),
        before: { customFields: null },
        after: { customFields: { a: 'x', b: 'y' } }
      }
    ])
    expect(plan.applied).toBe(2)
    expect(plan.items).toBe(1)
  })

  it('clears clearable cells and rejects the others', () => {
    const plan = planClear(
      [
        { doc: d1, key: 'estimate' },
        { doc: d1, key: 'title' },
        { doc: d1, key: 'id' }
      ],
      adapter
    )
    expect(plan.applied).toBe(1)
    expect(plan.skippedBy).toEqual({ notClearable: 1, readonly: 1 })
    expect(plan.ops).toEqual([
      { kind: 'update', target: itemTarget(d1), before: { estimate: 1 }, after: { estimate: null } }
    ])
  })
})
