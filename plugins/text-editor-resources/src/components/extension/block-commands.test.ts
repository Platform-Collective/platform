/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import { markdownToMarkup, markupToMarkdown } from '@hcengineering/text-markdown'
import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { closeHistory } from '@tiptap/pm/history'
import { BLOCK_COMMAND_IDS, isBlockCommandAvailable, runBlockCommand } from './block-commands'

const editors: Editor[] = []
function fixture (content = '<p>before</p><p>/headingafter</p><p>last</p>', options = {}): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit.configure(options)],
    content
  })
  editors.push(editor)
  return editor
}
afterEach(() => {
  editors.splice(0).forEach((editor) => {
    editor.destroy()
  })
})

it.each([
  ['heading-1', 'heading', 1],
  ['heading-2', 'heading', 2],
  ['heading-3', 'heading', 3],
  ['bullet-list', 'bulletList', undefined],
  ['ordered-list', 'orderedList', undefined],
  ['blockquote', 'blockquote', undefined]
])('converts the invoked paragraph with %s, preserving surrounding text and undo/redo', (id, node, level) => {
  const editor = fixture()
  // before paragraph occupies positions 0..7; slash query is at 9..17.
  editor.commands.setTextSelection(17)
  editor.view.dispatch(closeHistory(editor.state.tr))
  expect(isBlockCommandAvailable(editor, id)).toBe(true)
  const initial = editor.getJSON()
  expect(runBlockCommand(editor, id, 9, { from: 9, to: 17 })).toBe(true)
  const result = editor.getJSON()
  expect(editor.state.doc.child(0).textContent).toBe('before')
  expect(editor.state.doc.child(1).type.name).toBe(node)
  expect(editor.state.doc.child(1).textContent).toBe('after')
  expect(editor.state.doc.child(2).textContent).toBe('last')
  if (level !== undefined) expect(editor.state.doc.child(1).attrs.level).toBe(level)
  expect(editor.commands.undo()).toBe(true)
  expect(editor.getJSON()).toEqual(initial)
  expect(editor.commands.redo()).toBe(true)
  expect(editor.getJSON()).toEqual(result)
})

it('hides and refuses disabled nodes and configured heading levels', () => {
  const editor = fixture('<p>/heading</p>', {
    heading: { levels: [2] },
    bulletList: false,
    orderedList: false,
    blockquote: false
  })
  const initial = editor.getJSON()
  expect(isBlockCommandAvailable(editor, 'heading-2')).toBe(true)
  for (const id of ['heading-1', 'heading-3', 'bullet-list', 'ordered-list', 'blockquote']) {
    expect(isBlockCommandAvailable(editor, id)).toBe(false)
    expect(runBlockCommand(editor, id, 1, { from: 1, to: 9 })).toBe(false)
  }
  expect(editor.getJSON()).toEqual(initial)
})

it('does not consume slash text for readonly or missing editors and contributed commands', () => {
  const editor = fixture('<p>/heading</p>')
  const initial = editor.getJSON()
  editor.setEditable(false)
  for (const id of BLOCK_COMMAND_IDS) expect(runBlockCommand(editor, id, 1, { from: 1, to: 9 })).toBe(false)
  expect(runBlockCommand(undefined, 'heading-1', 1)).toBe(false)
  editor.setEditable(true)
  expect(runBlockCommand(editor, 'subpage', 1)).toBe(false)
  expect(runBlockCommand(editor, 'callout', 1)).toBe(false)
  expect(editor.getJSON()).toEqual(initial)
})

it('preserves the slash text when the document schema refuses block conversion', () => {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ document: false }),
      Node.create({ name: 'doc', topNode: true, content: 'paragraph' })
    ],
    content: '<p>/heading</p>'
  })
  editors.push(editor)
  const initial = editor.getJSON()
  for (const id of BLOCK_COMMAND_IDS) {
    expect(isBlockCommandAvailable(editor, id)).toBe(true)
    expect(runBlockCommand(editor, id, 1, { from: 1, to: 9 })).toBe(false)
    expect(editor.getJSON()).toEqual(initial)
  }
})

it('converts the first list paragraph to a heading with the native fallback', () => {
  const editor = fixture('<ul><li><p>/headingafter</p></li><li><p>sibling</p></li></ul>')
  editor.commands.setTextSelection(3)
  const initial = editor.getJSON()
  expect(runBlockCommand(editor, 'heading-1', 3, { from: 3, to: 11 })).toBe(true)
  expect(editor.state.doc.firstChild?.type.name).toBe('heading')
  expect(editor.state.doc.firstChild?.textContent).toBe('after')
  expect(editor.state.doc.lastChild?.textContent).toBe('sibling')
  expect(editor.commands.undo()).toBe(true)
  expect(editor.getJSON()).toEqual(initial)
})

it.each(['bullet-list', 'ordered-list'])('handles %s inside an existing list without losing its sibling', (id) => {
  const editor = fixture('<ul><li><p>/listafter</p></li><li><p>sibling</p></li></ul>')
  editor.commands.setTextSelection(8)
  const initial = editor.getJSON()
  expect(runBlockCommand(editor, id, 3, { from: 3, to: 8 })).toBe(true)
  expect(editor.state.doc.textContent).toBe('aftersibling')
  expect(editor.getHTML()).not.toContain('/list')
  if (id === 'ordered-list') expect(editor.state.doc.firstChild?.type.name).toBe('orderedList')
  else expect(editor.state.doc.firstChild?.type.name).toBe('paragraph')
  const result = editor.getJSON()
  expect(editor.commands.undo()).toBe(true)
  expect(editor.getJSON()).toEqual(initial)
  expect(editor.commands.redo()).toBe(true)
  expect(editor.getJSON()).toEqual(result)
})

it('preflights at the target position, independently of the current selection', () => {
  const editor = fixture('<p>outside</p><ul><li><p>/heading</p></li></ul>')
  editor.commands.setTextSelection(1)
  expect(runBlockCommand(editor, 'heading-1', 12, { from: 12, to: 20 })).toBe(true)
  expect(editor.state.doc.firstChild?.type.name).toBe('paragraph')
  expect(editor.state.doc.firstChild?.textContent).toBe('outside')
  expect(editor.state.doc.child(1).type.name).toBe('heading')
  expect(editor.state.doc.child(1).textContent).toBe('')
  editor.commands.setTextSelection(10)
  expect(runBlockCommand(editor, 'heading-2', 1)).toBe(true)
  expect(editor.state.doc.firstChild?.type.name).toBe('heading')
  expect(editor.state.doc.firstChild?.textContent).toBe('outside')
  expect(editor.state.doc.child(1).attrs.level).toBe(1)
})

it.each([
  ['heading-1', 'heading'],
  ['heading-2', 'heading'],
  ['heading-3', 'heading'],
  ['bullet-list', 'bulletList'],
  ['ordered-list', 'orderedList'],
  ['blockquote', 'blockquote']
])('round-trips %s through the existing Markdown converter', (id, node) => {
  const editor = fixture('<p>roundtrip</p>')
  expect(runBlockCommand(editor, id, 1)).toBe(true)
  const markup = editor.getJSON() as Parameters<typeof markupToMarkdown>[0]
  const markdown = markupToMarkdown(markup)
  expect(markdown).toContain('roundtrip')
  editor.commands.setContent(markdownToMarkup(markdown))
  expect(editor.state.doc.firstChild?.type.name).toBe(node)
  expect(editor.state.doc.textContent).toBe('roundtrip')
  if (id.startsWith('heading-')) expect(editor.state.doc.firstChild?.attrs.level).toBe(Number(id.slice(-1)))
})

it('normalizes side-menu paragraph boundaries independently of the current selection', () => {
  const editor = fixture('<p>first</p><p>second</p>')
  editor.commands.setTextSelection(8)
  expect(runBlockCommand(editor, 'heading-1', 0)).toBe(true)
  expect(editor.state.doc.child(0).type.name).toBe('heading')
  expect(editor.state.doc.child(0).attrs.level).toBe(1)
  expect(editor.state.doc.child(0).textContent).toBe('first')
  expect(editor.state.doc.child(1).type.name).toBe('paragraph')
  editor.commands.setTextSelection(1)
  expect(runBlockCommand(editor, 'heading-2', 7)).toBe(true)
  expect(editor.state.doc.child(0).attrs.level).toBe(1)
  expect(editor.state.doc.child(1).type.name).toBe('heading')
  expect(editor.state.doc.child(1).attrs.level).toBe(2)
  expect(editor.state.doc.child(1).textContent).toBe('second')
})
