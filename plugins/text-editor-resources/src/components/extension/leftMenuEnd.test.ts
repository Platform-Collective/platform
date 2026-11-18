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

import { type Node, Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { hasInsertSlotAtEnd, prepareInsertAtEnd } from './leftMenuEnd'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    codeBlock: { group: 'block', content: 'text*', code: true },
    text: {}
  }
})

function docOf (...blocks: Array<[name: 'paragraph' | 'codeBlock', text: string]>): Node {
  return schema.node(
    'doc',
    null,
    blocks.map(([name, text]) => schema.node(name, null, text !== '' ? [schema.text(text)] : []))
  )
}

describe('hasInsertSlotAtEnd', () => {
  it('is true only when the document ends with an empty paragraph', () => {
    expect(hasInsertSlotAtEnd(docOf(['codeBlock', 'code'], ['paragraph', '']))).toBe(true)
    expect(hasInsertSlotAtEnd(docOf(['paragraph', 'text']))).toBe(false)
    expect(hasInsertSlotAtEnd(docOf(['paragraph', 'text'], ['codeBlock', 'code']))).toBe(false)
    expect(hasInsertSlotAtEnd(docOf(['codeBlock', '']))).toBe(false)
  })
})

describe('prepareInsertAtEnd', () => {
  it('appends an empty paragraph after a trailing block and returns the position before it', () => {
    const doc = docOf(['paragraph', 'text'], ['codeBlock', 'code'])
    const tr = EditorState.create({ schema, doc }).tr
    const pos = prepareInsertAtEnd(tr)

    expect(tr.docChanged).toBe(true)
    expect(pos).toBe(doc.content.size)
    expect(tr.doc.childCount).toBe(3)
    expect(tr.doc.nodeAt(pos)?.type.name).toBe('paragraph')
    expect(tr.doc.nodeAt(pos)?.content.size).toBe(0)
  })

  it('appends an empty paragraph after a non-empty trailing paragraph', () => {
    const doc = docOf(['paragraph', 'text'])
    const tr = EditorState.create({ schema, doc }).tr
    const pos = prepareInsertAtEnd(tr)

    expect(pos).toBe(doc.content.size)
    expect(tr.doc.childCount).toBe(2)
    expect(tr.doc.child(0).textContent).toBe('text')
  })

  it('reuses an existing empty trailing paragraph without changing the document', () => {
    const doc = docOf(['codeBlock', 'code'], ['paragraph', ''])
    const tr = EditorState.create({ schema, doc }).tr
    const pos = prepareInsertAtEnd(tr)

    expect(tr.docChanged).toBe(false)
    expect(pos).toBe(doc.child(0).nodeSize)
    expect(tr.doc.nodeAt(pos)?.type.name).toBe('paragraph')
  })
})
