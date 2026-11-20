/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import { Editor } from '@tiptap/core'
import { ServerKit } from '../../kits/server-kit'

describe('callout keyboard shortcuts', () => {
  it('does not split a callout when Backspace is pressed in a middle empty paragraph', () => {
    const editor = new Editor({
      extensions: [ServerKit],
      content: '<div data-type="callout"><p>First</p><p></p><p>Last</p></div>'
    })
    let emptyPosition = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) emptyPosition = pos + 1
    })
    expect(emptyPosition).toBeGreaterThan(0)
    editor.commands.setTextSelection(emptyPosition)
    editor.commands.keyboardShortcut('Backspace')
    expect(editor.getJSON().content?.filter((node) => node.type === 'callout')).toHaveLength(1)
    editor.destroy()
  })
})
