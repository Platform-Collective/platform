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

import { type Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'

import { serializePlainText } from '../plainTextCopy'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
    codeBlock: { group: 'block', content: 'text*', marks: '', code: true },
    horizontalRule: { group: 'block' },
    hardBreak: { group: 'inline', inline: true },
    reference: { group: 'inline', inline: true, atom: true, attrs: { id: {}, label: { default: null } } },
    bulletList: { group: 'block', content: 'listItems+' },
    orderedList: { group: 'block', content: 'listItems+', attrs: { start: { default: 1 } } },
    todoList: { group: 'block', content: 'listItems+' },
    listItem: { group: 'listItems', content: 'paragraph block*' },
    todoItem: { group: 'listItems', content: 'paragraph block*', attrs: { checked: { default: false } } },
    table: { group: 'block', content: 'tableRow+', tableRole: 'table' },
    tableRow: { content: '(tableCell | tableHeader)*', tableRole: 'row' },
    tableHeader: { content: 'block+', tableRole: 'header_cell' },
    tableCell: { content: 'block+', tableRole: 'cell' }
  },
  marks: { bold: {} }
})

const p = (...content: Array<ProseMirrorNode | string>): ProseMirrorNode =>
  schema.node(
    'paragraph',
    null,
    content.map((c) => (typeof c === 'string' ? schema.text(c) : c))
  )
const li = (...content: ProseMirrorNode[]): ProseMirrorNode => schema.node('listItem', null, content)
const doc = (...content: ProseMirrorNode[]): ProseMirrorNode => schema.node('doc', null, content)

const hardBreakSerializer = { hardBreak: () => '\n' }

function copyAll (node: ProseMirrorNode): string {
  return serializePlainText(node, 0, node.content.size, hardBreakSerializer)
}

describe('serializePlainText', () => {
  it('separates top level blocks with a blank line', () => {
    expect(copyAll(doc(schema.node('heading', null, [schema.text('Title')]), p('First'), p('Second')))).toBe(
      'Title\n\nFirst\n\nSecond'
    )
  })

  it('puts bullet list items on consecutive lines', () => {
    const d = doc(p('Intro'), schema.node('bulletList', null, [li(p('One')), li(p('Two')), li(p('Three'))]), p('End'))
    expect(copyAll(d)).toBe('Intro\n\n- One\n- Two\n- Three\n\nEnd')
  })

  it('numbers ordered list items from the start attribute', () => {
    const d = doc(schema.node('orderedList', { start: 3 }, [li(p('One')), li(p('Two'))]))
    expect(copyAll(d)).toBe('3. One\n4. Two')
  })

  it('marks checked and unchecked todo items', () => {
    const d = doc(
      schema.node('todoList', null, [
        schema.node('todoItem', { checked: true }, [p('Done')]),
        schema.node('todoItem', { checked: false }, [p('Open')])
      ])
    )
    expect(copyAll(d)).toBe('[x] Done\n[ ] Open')
  })

  it('indents nested lists and multi-line items', () => {
    const d = doc(
      schema.node('bulletList', null, [
        li(
          p('Parent'),
          schema.node('orderedList', null, [li(p('Child')), li(p('Line 1', schema.node('hardBreak'), 'Line 2'))])
        ),
        li(p('Sibling'))
      ])
    )
    expect(copyAll(d)).toBe('- Parent\n  1. Child\n  2. Line 1\n     Line 2\n- Sibling')
  })

  it('copies a selection inside a single list item without a marker', () => {
    const d = doc(schema.node('bulletList', null, [li(p('Hello world'))]))
    // doc > bulletList(0) > listItem(1) > paragraph(2) > text starts at 3
    expect(serializePlainText(d, 3 + 6, 3 + 11)).toBe('world')
  })

  it('keeps the list markers and numbering of a partial list selection', () => {
    const d = doc(schema.node('orderedList', null, [li(p('First')), li(p('Second')), li(p('Third'))]))
    let from = 0
    let to = 0
    d.descendants((node, pos) => {
      if (node.isText && node.text === 'Second') from = pos + 3
      if (node.isText && node.text === 'Third') to = pos + 2
    })
    expect(serializePlainText(d, from, to)).toBe('2. ond\n3. Th')
  })

  it('serializes tables row by row with tab separated cells', () => {
    const d = doc(
      schema.node('table', null, [
        schema.node('tableRow', null, [
          schema.node('tableHeader', null, [p('A')]),
          schema.node('tableHeader', null, [p('B')])
        ]),
        schema.node('tableRow', null, [
          schema.node('tableCell', null, [p('1')]),
          schema.node('tableCell', null, [p('2')])
        ])
      ])
    )
    expect(copyAll(d)).toBe('A\tB\n1\t2')
  })

  it('keeps references and code blocks, skips empty block leaves', () => {
    const d = doc(
      p('Hi ', schema.node('reference', { id: 'person-1', label: 'Jane' }), '!'),
      schema.node('horizontalRule'),
      schema.node('codeBlock', null, [schema.text('a\n  b')])
    )
    expect(copyAll(d)).toBe('Hi @Jane!\n\na\n  b')
  })
})
