// SPDX-License-Identifier: EPL-2.0

import type { Editor } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { ySyncPlugin } from 'y-prosemirror'
import { Doc, XmlElement, XmlText } from 'yjs'
import { captureEditorPosition } from '../relativePosition'

describe('captureEditorPosition', () => {
  it('resolves the saved Yjs position after an intervening insertion', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*', group: 'block' },
        text: { group: 'inline' }
      }
    })
    const ydoc = new Doc({ gc: false })
    const type = ydoc.getXmlFragment('content')
    const paragraph = new XmlElement('paragraph')
    const text = new XmlText('existing')
    paragraph.insert(0, [text])
    type.insert(0, [paragraph])

    const pmText = schema.text('existing')
    const pmParagraph = schema.node('paragraph', null, [pmText])
    const pmDoc = schema.node('doc', null, [pmParagraph])
    const mapping = new Map<any, any>([
      [type, pmDoc],
      [paragraph, pmParagraph],
      [text, [pmText]]
    ])
    let state = EditorState.create({ doc: pmDoc, plugins: [ySyncPlugin(type, { mapping })] })
    const editor = {
      get state () {
        return state
      }
    } as unknown as Editor
    const resolve = captureEditorPosition(editor, 1)
    expect(resolve()).toBe(1)

    text.insert(0, 'typed')
    state = state.apply(state.tr.insertText('typed', 1))
    const updatedText = schema.text('typedexisting')
    const updatedParagraph = schema.node('paragraph', null, [updatedText])
    mapping.set(text, [updatedText])
    mapping.set(paragraph, updatedParagraph)
    mapping.set(type, state.doc)

    expect(resolve()).toBe(6)
  })
})
