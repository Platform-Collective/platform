/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { withBlockCommands } from './block-commands-config'
import { inlineCommandsConfig } from '../extensions'

jest.mock('@hcengineering/text-editor', () => ({
  __esModule: true,
  default: { string: new Proxy({}, { get: (_, key) => String(key) }), icon: {} }
}))
jest.mock('@hcengineering/ui', () => ({ IconScribble: {} }))
jest.mock('@hcengineering/view', () => ({ __esModule: true, default: { icon: {} } }))
jest.mock('../InlineCommandsList.svelte', () => ({ __esModule: true, default: {} }))
jest.mock('../node-view', () => ({ SvelteRenderer: jest.fn() }))

let editor: Editor
beforeEach(() => {
  editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content: '<p>/Heading</p>' })
})
afterEach(() => {
  editor.destroy()
})

it('offers all six blocks and filters exclusions alongside existing commands', async () => {
  const config = inlineCommandsConfig(jest.fn(), ['heading-2', 'ordered-list', 'image'])
  const items = await config.suggestion?.items?.({ editor, query: '' })
  const ids = items?.map((item) => item.id)
  expect(ids).toEqual(
    expect.arrayContaining(['heading-1', 'heading-3', 'bullet-list', 'blockquote', 'table', 'todo-list'])
  )
  for (const id of ['heading-2', 'ordered-list', 'image']) expect(ids).not.toContain(id)
})

it('does not offer unsupported nodes from a restricted editor', async () => {
  editor.destroy()
  editor = new Editor({
    extensions: [StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false })]
  })
  const config = inlineCommandsConfig(jest.fn())
  const items = await config.suggestion?.items?.({ editor, query: '' })
  expect(items?.map((item) => item.id)).not.toEqual(expect.arrayContaining(['heading-1']))
  expect(
    items?.filter((item) =>
      ['heading-1', 'heading-2', 'heading-3', 'bullet-list', 'ordered-list', 'blockquote'].includes(item.id)
    )
  ).toEqual([])
})

it('preserves the query on cancel and does not dispatch a readonly or excluded command', () => {
  const handleSelect = jest.fn()
  const config = inlineCommandsConfig(handleSelect, ['heading-1'])
  const invoke = (props: { id: string } | null): void => {
    config.suggestion?.command?.({ editor, range: { from: 1, to: 9 }, props })
  }
  invoke(null)
  invoke({ id: 'heading-1' })
  editor.setEditable(false)
  invoke({ id: 'heading-2' })
  expect(editor.state.doc.textContent).toBe('/Heading')
  expect(handleSelect).not.toHaveBeenCalled()
})

it('handles new blocks in one transaction and keeps legacy callbacks', () => {
  const handleSelect = jest.fn()
  const config = inlineCommandsConfig(handleSelect)
  config.suggestion?.command?.({ editor, range: { from: 1, to: 9 }, props: { id: 'heading-2' } })
  expect(editor.state.doc.firstChild?.type.name).toBe('heading')
  expect(editor.state.doc.firstChild?.attrs.level).toBe(2)
  expect(editor.state.doc.textContent).toBe('')
  expect(handleSelect).not.toHaveBeenCalled()
  editor.commands.setContent('<p>/table</p>')
  config.suggestion?.command?.({ editor, range: { from: 1, to: 7 }, props: { id: 'table' } })
  expect(handleSelect).toHaveBeenCalledWith('table', 1, expect.any(HTMLElement))
  expect(editor.state.doc.textContent).toBe('')
})

it('preserves async host contributions and forwards their command unchanged', async () => {
  const command = jest.fn()
  const config = withBlockCommands(
    {
      suggestion: {
        items: async () => [
          { id: 'subpage', label: 'Subpage' },
          { id: 'callout', label: 'Callout' }
        ],
        command
      }
    },
    ['heading-3']
  )
  const items = await config.suggestion?.items?.({ editor, query: '' })
  expect(items?.map((item) => item.id)).toEqual([
    'subpage',
    'callout',
    'heading-1',
    'heading-2',
    'bullet-list',
    'ordered-list',
    'blockquote'
  ])
  const props = { editor, range: { from: 1, to: 9 }, props: { id: 'subpage' } }
  config.suggestion?.command?.(props)
  expect(command).toHaveBeenCalledWith(props)
  expect(editor.state.doc.textContent).toBe('/Heading')
})

it('keeps reserved block IDs unique when a host contributes the same ID', async () => {
  const config = withBlockCommands(
    {
      suggestion: {
        items: async () => [
          { id: 'subpage', label: 'Subpage' },
          { id: 'heading-1', label: 'Host heading' }
        ]
      }
    },
    []
  )
  const items = await config.suggestion?.items?.({ editor, query: '' })
  expect(items?.filter((item) => item.id === 'heading-1')).toHaveLength(1)
  expect(items?.find((item) => item.id === 'heading-1')?.label).toBe('Heading1')
  expect(items?.some((item) => item.id === 'subpage')).toBe(true)
})

it('does not let a host bypass block exclusions or disabled nodes', async () => {
  const original = {
    suggestion: {
      items: async () => [
        { id: 'subpage', label: 'Subpage' },
        { id: 'heading-1', label: 'Host heading' }
      ]
    }
  }
  const excluded = withBlockCommands(original, ['heading-1'])
  const excludedItems = await excluded.suggestion?.items?.({ editor, query: '' })
  expect(excludedItems?.some((item) => item.id === 'heading-1')).toBe(false)
  editor.destroy()
  editor = new Editor({ extensions: [StarterKit.configure({ heading: false })] })
  const restricted = withBlockCommands(original, [])
  const restrictedItems = await restricted.suggestion?.items?.({ editor, query: '' })
  expect(restrictedItems?.some((item) => item.id === 'heading-1')).toBe(false)
  expect(restrictedItems?.some((item) => item.id === 'subpage')).toBe(true)
})
