/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import { Editor, Node, type NodeViewRenderer } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { runBlockCommand } from './block-commands'
import { TodoItemExtension, TodoListExtension } from './todo/todo'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('../node-view', () => ({ SvelteNodeViewRenderer: jest.fn() }))
jest.mock('./todo/ToDoItemNodeView.svelte', () => ({ __esModule: true, default: {} }))
jest.mock('./todo/ToDoListNodeView.svelte', () => ({ __esModule: true, default: {} }))
jest.mock('../../utils', () => ({
  getDataAttribute: (name: string, options: object) => ({
    ...options,
    parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`)
  })
}))

const editors: Editor[] = []

// Match CommonListKitFactory's schema while using the real application commands.
const APP_LISTS_STARTER_KIT = StarterKit.extend({
  addExtensions () {
    const extensions = StarterKit.config.addExtensions?.call({
      name: StarterKit.name,
      options: StarterKit.options,
      storage: StarterKit.storage,
      parent: undefined
    })
    return (extensions ?? []).map((extension) => {
      if (!(extension instanceof Node)) return extension
      if (extension.name === 'listItem') return extension.extend({ group: 'listItems' })
      if (extension.name === 'bulletList' || extension.name === 'orderedList') {
        return extension.extend({ content: 'listItems+' })
      }
      return extension
    })
  }
})

function plainNodeView (tag: string): NodeViewRenderer {
  return () => {
    const dom = document.createElement(tag)
    return { dom, contentDOM: dom }
  }
}

function fixture (content: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      APP_LISTS_STARTER_KIT,
      TodoItemExtension.extend({ addNodeView: () => plainNodeView('li') }),
      TodoListExtension.extend({ addNodeView: () => plainNodeView('ul') })
    ],
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
  ['ul', 'ordered-list', 'orderedList'],
  ['ol', 'bullet-list', 'bulletList']
])('switches an existing %s with the application list commands', (tag, id, node) => {
  const editor = fixture(`<${tag}><li><p>sibling</p></li><li><p>/listafter</p></li></${tag}>`)
  editor.commands.setTextSelection(19)
  const initial = editor.getJSON()
  expect(runBlockCommand(editor, id, 14, { from: 14, to: 19 })).toBe(true)
  expect(editor.state.doc.firstChild?.type.name).toBe(node)
  expect(editor.state.doc.firstChild?.childCount).toBe(2)
  expect(editor.state.doc.firstChild?.child(0).textContent).toBe('sibling')
  expect(editor.state.doc.firstChild?.child(1).textContent).toBe('after')
  const result = editor.getJSON()
  expect(editor.commands.undo()).toBe(true)
  expect(editor.getJSON()).toEqual(initial)
  expect(editor.commands.redo()).toBe(true)
  expect(editor.getJSON()).toEqual(result)
})

it('lifts an existing list item with the application list commands', () => {
  const editor = fixture('<ol><li><p>sibling</p></li><li><p>/listafter</p></li></ol>')
  editor.commands.setTextSelection(19)
  const initial = editor.getJSON()
  expect(runBlockCommand(editor, 'ordered-list', 14, { from: 14, to: 19 })).toBe(true)
  expect(editor.state.doc.childCount).toBe(2)
  expect(editor.state.doc.firstChild?.type.name).toBe('orderedList')
  expect(editor.state.doc.firstChild?.textContent).toBe('sibling')
  expect(editor.state.doc.lastChild?.type.name).toBe('paragraph')
  expect(editor.state.doc.lastChild?.textContent).toBe('after')
  expect(editor.commands.undo()).toBe(true)
  expect(editor.getJSON()).toEqual(initial)
})

it('refuses list-item conversion outside a list', () => {
  const editor = fixture('<p>/list</p>')
  editor.commands.setTextSelection(1)
  const initial = editor.getJSON()
  expect(editor.commands.convertListItems('listItem')).toBe(false)
  expect(editor.getJSON()).toEqual(initial)
})
