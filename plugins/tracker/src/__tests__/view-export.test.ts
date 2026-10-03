//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { buildViewTsv, formatTsvCell, orderRowsByGroups, viewExportFileName, type GroupLevel } from '../viewExport'

describe('formatTsvCell', () => {
  it('writes empty values as nothing', () => {
    expect(formatTsvCell(undefined)).toBe('')
    expect(formatTsvCell(null)).toBe('')
    expect(formatTsvCell('')).toBe('')
    expect(formatTsvCell(Number.NaN)).toBe('')
  })

  it('writes numbers, booleans and ISO dates', () => {
    expect(formatTsvCell(12.5)).toBe('12.5')
    expect(formatTsvCell(0)).toBe('0')
    expect(formatTsvCell(true)).toBe('true')
    expect(formatTsvCell(new Date(Date.UTC(2026, 0, 15, 10, 30)))).toBe('2026-01-15T10:30:00.000Z')
    expect(formatTsvCell(new Date(Number.NaN))).toBe('')
  })

  it('joins lists with a comma and a space and skips empty items', () => {
    expect(formatTsvCell(['bug', 'ui', ''])).toBe('bug, ui')
    expect(formatTsvCell([['a', 'b'], null, 'c'])).toBe('a, b, c')
    expect(formatTsvCell([])).toBe('')
  })

  it('replaces tabs and line breaks so that a row stays one line', () => {
    expect(formatTsvCell('a\tb')).toBe('a b')
    expect(formatTsvCell('line 1\r\nline 2\nline 3\rline 4')).toBe('line 1 line 2 line 3 line 4')
    expect(formatTsvCell('x\u2028y')).toBe('x y')
    expect(formatTsvCell(['one\ttwo', 'three\nfour'])).toBe('one two, three four')
  })

  it('keeps unicode as it is', () => {
    expect(formatTsvCell('Привет, мир 你好 🚀')).toBe('Привет, мир 你好 🚀')
  })

  it('neutralises formulas with a quote, but not numbers', () => {
    expect(formatTsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(formatTsvCell('+1 555')).toBe("'+1 555")
    expect(formatTsvCell('-2+3')).toBe("'-2+3")
    expect(formatTsvCell('@cmd')).toBe("'@cmd")
    // The text after a separator is moved to the start of the cell before the check
    expect(formatTsvCell('\t=HYPERLINK("x")').startsWith("' ")).toBe(false)
    expect(formatTsvCell('=a\t=b')).toBe("'=a =b")
    expect(formatTsvCell(-5)).toBe('-5')
    expect(formatTsvCell('1 - 2')).toBe('1 - 2')
    expect(formatTsvCell('2026-01-15')).toBe('2026-01-15')
  })

  it('can leave formulas alone', () => {
    expect(formatTsvCell('=1+1', false)).toBe('=1+1')
  })
})

describe('buildViewTsv', () => {
  const columns = [{ header: 'Title' }, { header: 'Status' }, { header: 'Labels' }]

  it('writes the header row and one line per row', () => {
    const tsv = buildViewTsv(columns, [
      ['Fix login', 'Todo', ['bug', 'auth']],
      ['Write docs', 'Done', []]
    ])
    expect(tsv).toBe('Title\tStatus\tLabels\nFix login\tTodo\tbug, auth\nWrite docs\tDone\t\n')
  })

  it('writes only the header for no rows', () => {
    expect(buildViewTsv(columns, [])).toBe('Title\tStatus\tLabels\n')
  })

  it('pads short rows and ignores extra cells', () => {
    expect(buildViewTsv(columns, [['only title'], ['a', 'b', 'c', 'd']])).toBe(
      'Title\tStatus\tLabels\nonly title\t\t\na\tb\tc\n'
    )
  })

  it('keeps every row on one line whatever the values hold', () => {
    const tsv = buildViewTsv(columns, [['multi\nline\ttitle', '=cmd|calc', 'a\r\nb']])
    const lines = tsv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe("multi line title\t'=cmd|calc\ta b")
    expect(lines[1].split('\t')).toHaveLength(3)
  })

  it('neutralises formulas in headers and cells, unless asked not to', () => {
    expect(buildViewTsv([{ header: '=h' }], [['=v']])).toBe("'=h\n'=v\n")
    expect(buildViewTsv([{ header: '=h' }], [['=v']], { escapeFormulas: false })).toBe('=h\n=v\n')
  })

  it('builds a large export quickly and completely', () => {
    const rows: Array<Array<string | number>> = []
    for (let i = 0; i < 50000; i++) rows.push([`Item ${i}`, 'Todo', i])
    const started = Date.now()
    const tsv = buildViewTsv(columns, rows)
    const lines = tsv.split('\n')
    expect(lines).toHaveLength(50002)
    expect(lines[50000]).toBe('Item 49999\tTodo\t49999')
    expect(lines[50001]).toBe('')
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('viewExportFileName', () => {
  it('joins project and view', () => {
    expect(viewExportFileName('Platform', 'Current iteration')).toBe('Platform - Current iteration.tsv')
  })

  it('removes characters that file systems refuse', () => {
    expect(viewExportFileName('A/B: C', 'x*y?"z"')).toBe('A B C - x y z.tsv')
    expect(viewExportFileName('', '')).toBe('view.tsv')
    expect(viewExportFileName('   ', 'Board')).toBe('Board.tsv')
  })
})

describe('orderRowsByGroups', () => {
  interface Row {
    id: string
    status?: string
    team?: string
    tags?: string[]
  }
  const status: GroupLevel<Row> = {
    categories: ['todo', 'doing', 'done', undefined],
    valueOf: (r) => r.status
  }

  it('returns the rows as they are without grouping', () => {
    const rows: Row[] = [{ id: 'a' }, { id: 'b' }]
    expect(orderRowsByGroups(rows, [])).toEqual(rows)
    expect(orderRowsByGroups(rows, [])).not.toBe(rows)
  })

  it('shows group after group in the order of the categories, keeping the order inside a group', () => {
    const rows: Row[] = [
      { id: '1', status: 'done' },
      { id: '2', status: 'todo' },
      { id: '3' },
      { id: '4', status: 'todo' },
      { id: '5', status: 'doing' },
      { id: '6', status: 'done' }
    ]
    expect(orderRowsByGroups(rows, [status]).map((r) => r.id)).toEqual(['2', '4', '5', '1', '6', '3'])
  })

  it('groups by a category that stands for several values', () => {
    const rows: Row[] = [
      { id: '1', status: 's-b' },
      { id: '2', status: 's-a' },
      { id: '3', status: 's-c' }
    ]
    const level: GroupLevel<Row> = {
      categories: [{ name: 'Open', values: [{ _id: 's-a' }, { _id: 's-b' }] }, { name: 'Closed', values: [{ _id: 's-c' }] }],
      valueOf: (r) => r.status
    }
    expect(orderRowsByGroups(rows, [level]).map((r) => r.id)).toEqual(['1', '2', '3'])
  })

  it('nests the next level inside the first', () => {
    const rows: Row[] = [
      { id: '1', status: 'done', team: 'b' },
      { id: '2', status: 'todo', team: 'b' },
      { id: '3', status: 'done', team: 'a' },
      { id: '4', status: 'todo', team: 'a' }
    ]
    const team: GroupLevel<Row> = { categories: ['a', 'b'], valueOf: (r) => r.team }
    expect(orderRowsByGroups(rows, [status, team]).map((r) => r.id)).toEqual(['4', '2', '3', '1'])
  })

  it('puts a row with several values in its first group only', () => {
    const rows: Row[] = [
      { id: '1', tags: ['x', 'y'] },
      { id: '2', tags: ['y'] },
      { id: '3', tags: [] }
    ]
    const tags: GroupLevel<Row> = { categories: ['y', 'x', undefined], valueOf: (r) => r.tags }
    const ordered = orderRowsByGroups(rows, [tags])
    expect(ordered.map((r) => r.id)).toEqual(['1', '2', '3'])
  })

  it('puts rows that fit no group at the end, without losing any', () => {
    const rows: Row[] = [
      { id: '1', status: 'unknown' },
      { id: '2', status: 'todo' }
    ]
    expect(orderRowsByGroups(rows, [status]).map((r) => r.id)).toEqual(['2', '1'])
  })

  it('handles a big list', () => {
    const rows: Row[] = []
    for (let i = 0; i < 50000; i++) rows.push({ id: String(i), status: i % 2 === 0 ? 'done' : 'todo' })
    const ordered = orderRowsByGroups(rows, [status])
    expect(ordered).toHaveLength(50000)
    expect(ordered[0].status).toBe('todo')
    expect(ordered[49999].status).toBe('done')
  })
})
