//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { buildViewTsv } from '@hcengineering/tracker'

import { buildExportColumns, exportColumnId, type ExportEnv } from '../columns'

const entry = (key: string, displayKey?: string): any => ({
  key,
  ...(displayKey !== undefined ? { displayProps: { key: displayKey } } : {})
})

const issue = (props: Record<string, any> = {}): any => ({
  _id: 'i1',
  title: 'Fix login',
  identifier: 'PROJ-1',
  status: 'st1',
  kind: 'k1',
  comments: 3,
  estimation: 0,
  parents: [],
  modifiedOn: Date.UTC(2026, 1, 3, 4, 5, 6),
  createdOn: Date.UTC(2026, 0, 2),
  ...props
})

function env (): ExportEnv {
  const formats: Record<string, (i: any) => string> = {
    priority: () => 'High',
    status: (i) => (i.status === 'st1' ? 'Todo' : 'Done'),
    assignee: () => 'Alice',
    labels: () => 'bug, ui',
    dueDate: () => '2026-03-01',
    estimation: () => '2',
    cf_sprint: () => 'Sprint 4'
  }
  return {
    cell: (key) => (formats[key] !== undefined ? { format: formats[key] } : undefined),
    label: (id) => `L:${id}`,
    taskTypeName: (kind) => `Type ${kind}`,
    issueUrl: (i) => `https://huly.test/tracker/${i.identifier}`,
    draftLabel: 'Draft',
    headers: { title: 'Title', identifier: 'Identifier', url: 'URL' }
  }
}

describe('exportColumnId', () => {
  it('uses the key of the display properties, then the attribute', () => {
    expect(exportColumnId('comments')).toBe('comments')
    expect(exportColumnId(entry('', 'status'))).toBe('status')
    expect(exportColumnId(entry('assignee'))).toBe('assignee')
    expect(exportColumnId(entry('assignee', 'a2'))).toBe('a2')
  })

  it('has no id for spacers', () => {
    expect(exportColumnId(entry(''))).toBeUndefined()
    expect(exportColumnId('')).toBeUndefined()
  })
})

describe('buildExportColumns', () => {
  it('starts with title, identifier and url', () => {
    const columns = buildExportColumns([], env())
    expect(columns.map((c) => c.header)).toEqual(['Title', 'Identifier', 'URL'])
    expect(columns.map((c) => c.value(issue()))).toEqual(['Fix login', 'PROJ-1', 'https://huly.test/tracker/PROJ-1'])
  })

  it('writes "Draft" as the identifier of a draft item', () => {
    const [, identifier] = buildExportColumns([], env())
    expect(identifier.value(issue({ isDraft: true, identifier: 'PROJ-Draft' }))).toBe('Draft')
  })

  it('follows the order of the view and skips what is not a field', () => {
    const config = [
      entry('', 'priority'),
      entry('', 'issue'),
      entry('', 'status'),
      entry('', 'title'),
      entry('', ''),
      entry('', 'extension-area'),
      entry('labels'),
      entry('assignee'),
      entry('', 'dueDate'),
      entry('', 'cf_sprint'),
      entry('', 'cf_gone')
    ]
    const columns = buildExportColumns(config, env())
    expect(columns.map((c) => c.id)).toEqual([
      'title',
      'identifier',
      'url',
      'priority',
      'status',
      'labels',
      'assignee',
      'dueDate',
      'cf_sprint'
    ])
    const row = columns.map((c) => c.value(issue()))
    expect(row.slice(3)).toEqual(['High', 'Todo', 'bug, ui', 'Alice', '2026-03-01', 'Sprint 4'])
  })

  it('writes each column once', () => {
    const columns = buildExportColumns([entry('', 'status'), entry('', 'status')], env())
    expect(columns.filter((c) => c.id === 'status')).toHaveLength(1)
  })

  it('writes the estimation as a number and nothing for no estimate', () => {
    const column = buildExportColumns([entry('', 'estimation')], env()).find((c) => c.id === 'estimation')
    expect(column?.value(issue({ estimation: 0 }))).toBe('')
    expect(column?.value(issue({ estimation: 4.5 }))).toBe(4.5)
  })

  it('writes task type, counters, parent and times', () => {
    const config = [entry('', 'kind'), entry('comments'), entry('attachedTo'), entry('modifiedOn'), entry('createdOn')]
    const columns = buildExportColumns(config, env())
    const values = columns.slice(3).map((c) => c.value(issue({ parents: [{ identifier: 'PROJ-9' }] })))
    expect(values).toEqual(['Type k1', 3, 'PROJ-9', '2026-02-03T04:05:06.000Z', '2026-01-02T00:00:00.000Z'])
  })

  it('gives a whole file through the tsv builder', () => {
    const columns = buildExportColumns([entry('', 'status'), entry('labels')], env())
    const rows = [issue(), issue({ _id: 'i2', title: '=evil\tx', identifier: 'PROJ-2', status: 'st2' })]
    const tsv = buildViewTsv(
      columns,
      rows.map((r) => columns.map((c) => c.value(r)))
    )
    expect(tsv.split('\n')).toEqual([
      'Title\tIdentifier\tURL\tL:status\tL:labels',
      'Fix login\tPROJ-1\thttps://huly.test/tracker/PROJ-1\tTodo\tbug, ui',
      "'=evil x\tPROJ-2\thttps://huly.test/tracker/PROJ-2\tDone\tbug, ui",
      ''
    ])
  })
})
