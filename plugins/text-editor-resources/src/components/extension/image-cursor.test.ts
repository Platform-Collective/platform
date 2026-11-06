// SPDX-License-Identifier: EPL-2.0

import { Schema } from '@tiptap/pm/model'
import { EditorState, NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { moveCursorBeforeSelectedLeadingImage } from './image-cursor'

function createSchema (): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'inline*', group: 'block' },
      text: { group: 'inline' },
      image: { atom: true, group: 'inline', inline: true, selectable: true }
    }
  })
}

describe('moveCursorBeforeSelectedLeadingImage', () => {
  it('moves the cursor before a selected leading image so typing preserves the image', () => {
    const schema = createSchema()
    const image = schema.nodes.image.create()
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, [image])])
    const state = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, 1) })
    let transaction: Transaction | undefined

    expect(moveCursorBeforeSelectedLeadingImage(state, (tr) => (transaction = tr))).toBe(true)
    expect(transaction?.selection).toBeInstanceOf(TextSelection)
    expect(transaction?.selection.from).toBe(1)

    const stateBeforeTyping = state.apply(transaction as Transaction)
    const stateAfterTyping = stateBeforeTyping.apply(stateBeforeTyping.tr.insertText('Before '))

    expect(stateAfterTyping.doc.child(0).childCount).toBe(2)
    expect(stateAfterTyping.doc.child(0).lastChild?.type.name).toBe('image')
  })

  it('does not change a selection that is not before the node', () => {
    const schema = createSchema()
    const paragraph = schema.nodes.paragraph.create(null, [schema.text('text'), schema.nodes.image.create()])
    const doc = schema.nodes.doc.create(null, [paragraph])
    const state = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, 5) })

    expect(moveCursorBeforeSelectedLeadingImage(state)).toBe(false)
  })

  it('does not intercept ArrowUp for a leading image outside the first block', () => {
    const schema = createSchema()
    const image = schema.nodes.image.create()
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(),
      schema.nodes.paragraph.create(null, [image])
    ])
    const state = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, 3) })

    expect(moveCursorBeforeSelectedLeadingImage(state)).toBe(false)
  })
})
