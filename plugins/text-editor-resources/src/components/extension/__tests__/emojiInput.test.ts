/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import { emojiRegex } from '@hcengineering/emoji'
import { Editor, Extension, InputRule, Node } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'

import { emojiRangeStart, handleEmoji } from '../emojiInput'

const TestEmoji = Node.create({
  name: 'emoji',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes () {
    return { emoji: { default: '' }, kind: { default: 'unicode' }, image: { default: null } }
  },
  parseHTML () {
    return [{ tag: 'span[data-type="emoji"]' }]
  },
  renderHTML ({ node }) {
    return ['span', { 'data-type': 'emoji' }, node.attrs.emoji]
  },
  renderText ({ node }) {
    return node.attrs.emoji
  }
})

// The unicode emoji input rule of the emoji extension
const TestEmojiInput = Extension.create({
  name: 'testEmojiInput',
  addInputRules () {
    return [
      new InputRule({
        find: emojiRegex,
        handler: ({ state, range, match, commands }) => {
          handleEmoji(state, range, match, commands, (emoji) => emoji)
        }
      })
    ]
  }
})

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

let editor: Editor | undefined

function createEditor (text: string): Editor {
  editor = new Editor({
    extensions: [StarterKit, TestEmoji, TestEmojiInput],
    // JSON content: an HTML string would drop the trailing space the emoji rule depends on
    content: { type: 'doc', content: [{ type: 'paragraph', content: text === '' ? [] : [{ type: 'text', text }] }] }
  })
  editor.commands.focus('end')
  return editor
}

// Returns the paragraph as [text runs and emoji nodes]
function paragraphParts (editor: Editor): string[] {
  const parts: string[] = []
  editor.state.doc.firstChild?.forEach((node) => {
    parts.push(node.type.name === 'emoji' ? `<emoji ${node.attrs.emoji}>` : (node.text ?? ''))
  })
  return parts
}

function allText (editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', (node) => node.attrs.emoji ?? '')
}

// What the Windows emoji picker (Win+.) does in Chromium: the emoji is committed by an IME composition, the
// DOM change lands in the document while composing and tiptap re-runs the input rules after compositionend
async function insertByComposition (editor: Editor, emoji: string): Promise<void> {
  const view = editor.view
  const { from, to } = view.state.selection
  view.dispatch(view.state.tr.insertText(emoji, from, to))
  const event = new Event('compositionend')
  view.someProp('handleDOMEvents', (handlers) => {
    const handler = handlers.compositionend as ((view: EditorView, event: Event) => boolean) | undefined
    handler?.(view, event)
    return undefined
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// insertText / keypress delivering the whole surrogate pair at once (beforeinput insertText)
function insertByTextInput (editor: Editor, text: string): void {
  const view = editor.view
  const { from, to } = view.state.selection
  const handled = view.someProp('handleTextInput', (f) => f(view, from, to, text, () => view.state.tr)) ?? false
  if (!handled) view.dispatch(view.state.tr.insertText(text, from, to))
}

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('emojiRangeStart', () => {
  it('keeps the leading whitespace and the characters before it', () => {
    // typed: the last character is not in the document yet
    expect(emojiRangeStart({ from: 9, to: 10 }, ' ✅', '✅')).toBe(10)
    // insertText of a surrogate pair: none of the emoji is in the document yet
    expect(emojiRangeStart({ from: 9, to: 10 }, ' 👍', '👍')).toBe(10)
    // after compositionend: the whole emoji is in the document already
    expect(emojiRangeStart({ from: 7, to: 10 }, ' 👍', '👍')).toBe(8)
    // at the start of the line there is no whitespace
    expect(emojiRangeStart({ from: 1, to: 3 }, '👍', '👍')).toBe(1)
  })
})

describe('emoji input rule', () => {
  it('converts an emoji from the Windows emoji picker (composition) without a lone surrogate', async () => {
    const editor = createEditor('Thanks ')
    await insertByComposition(editor, '👍')

    expect(allText(editor)).not.toMatch(loneSurrogate)
    expect(allText(editor)).not.toContain('�')
    expect(paragraphParts(editor)).toEqual(['Thanks ', '<emoji 👍>'])
  })

  it('converts a composed emoji at the start of the line', async () => {
    const editor = createEditor('')
    await insertByComposition(editor, '👍')

    expect(allText(editor)).not.toMatch(loneSurrogate)
    expect(paragraphParts(editor)).toEqual(['<emoji 👍>'])
  })

  it('converts an emoji inserted as one text input and keeps the space before it', () => {
    const editor = createEditor('Thanks ')
    insertByTextInput(editor, '👍')

    expect(allText(editor)).not.toMatch(loneSurrogate)
    expect(paragraphParts(editor)).toEqual(['Thanks ', '<emoji 👍>'])
  })

  it('still converts a typed single code unit emoji', () => {
    const editor = createEditor('done ')
    insertByTextInput(editor, '✅')

    expect(paragraphParts(editor)).toEqual(['done ', '<emoji ✅>'])
  })

  it('leaves an emoji after a word as text', async () => {
    const editor = createEditor('Thanks')
    await insertByComposition(editor, '👍')

    expect(paragraphParts(editor)).toEqual(['Thanks👍'])
  })
})
