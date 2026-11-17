// SPDX-License-Identifier: EPL-2.0

import { getClient } from '@hcengineering/presentation'
import { openDoc } from '@hcengineering/view-resources'
import type { Document } from '@hcengineering/document'
import type { Editor } from '@tiptap/core'
import { Fragment, Schema } from '@tiptap/pm/model'
import { EditorState, type Plugin, type PluginKey, type Transaction } from '@tiptap/pm/state'
import { createSubpage } from '../utils'

function makeParent (): Document {
  return Object.assign(Object.create(null), { _id: 'parent', space: 'teamspace' })
}

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('@hcengineering/view-resources', () => ({ openDoc: jest.fn(), accessDeniedStore: { set: jest.fn() } }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  translate: jest.fn(async () => 'Untitled')
}))

// Use real document/step mappings while keeping navigation and persistence at their boundaries.
function makeEditor (text = 'existing'): { editor: Editor, chain: any, pluginCount: () => number } {
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'inline*', group: 'block' },
      text: { group: 'inline' },
      reference: { inline: true, group: 'inline', atom: true, attrs: { id: {}, objectclass: {}, label: {} } }
    }
  })
  let state = EditorState.create({
    doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])])
  })
  let transaction: Transaction
  const dispatch = (tr: Transaction): void => {
    state = state.applyTransaction(tr).state
  }
  const chain: any = {
    focus: jest.fn(),
    insertContentAt: jest.fn((pos: number, content: any[]) => {
      transaction.insert(pos, Fragment.fromArray(content.map((node) => schema.nodeFromJSON(node))))
      return chain
    }),
    command: jest.fn((command: (props: { tr: Transaction }) => boolean) => {
      command({ tr: transaction })
      return chain
    }),
    run: jest.fn(() => {
      dispatch(transaction)
      return true
    })
  }
  chain.focus.mockReturnValue(chain)
  const editor = {
    get state () {
      return state
    },
    isDestroyed: false,
    chain: () => {
      transaction = state.tr
      return chain
    },
    view: { dispatch },
    registerPlugin: (plugin: Plugin) => {
      state = state.reconfigure({ plugins: [...state.plugins, plugin] })
    },
    unregisterPlugin: (key: PluginKey) => {
      state = state.reconfigure({ plugins: state.plugins.filter((plugin) => plugin.spec.key !== key) })
    }
  } as unknown as Editor
  return { editor, chain, pluginCount: () => state.plugins.length }
}

describe('subpage navigation during slow collaboration', () => {
  it('keeps the parent editor mounted until its inserted reference is acknowledged', async () => {
    let acknowledge: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      acknowledge = resolve
    })
    const flush = jest.fn(async () => {
      await pending
    })
    const parent = { _id: 'parent', space: 'teamspace' }
    const client = {
      findAll: jest.fn(async () => []),
      createDoc: jest.fn(async () => {}),
      findOne: jest.fn(async () => ({ _id: 'child' })),
      getHierarchy: jest.fn(() => ({}))
    }
    ;(getClient as jest.Mock).mockReturnValue(client)
    ;(openDoc as jest.Mock).mockClear()
    const { editor, chain, pluginCount } = makeEditor()

    const creation = createSubpage(editor, 2, parent as Document, flush)
    // Resolve the already-settled create/find promises, leaving only collaboration pending.
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    try {
      expect(chain.insertContentAt).toHaveBeenCalled()
      expect(client.createDoc).toHaveBeenCalled()
      expect(flush).toHaveBeenCalledTimes(1)
      expect(openDoc).not.toHaveBeenCalled()
    } finally {
      acknowledge?.()
      await creation
    }
    expect(openDoc).toHaveBeenCalledTimes(1)
    expect(pluginCount()).toBe(0)
  })

  it.each(['delete', 'replace'])(
    'preserves original leading whitespace after a concurrent separator %s',
    async (edit) => {
      let rejectCreation: (error: Error) => void = () => {}
      const pending = new Promise<void>((_resolve, reject) => {
        rejectCreation = reject
      })
      const client = {
        findAll: jest.fn(async () => []),
        createDoc: jest.fn(() => pending),
        findOne: jest.fn()
      }
      ;(getClient as jest.Mock).mockReturnValue(client)
      const { editor, pluginCount } = makeEditor(' existing')
      const creation = createSubpage(editor, 1, makeParent())
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      expect(client.createDoc).toHaveBeenCalledTimes(1)
      expect(editor.state.doc.textContent).toBe('  existing')
      const tr = editor.state.tr.delete(2, 3)
      if (edit === 'replace') tr.insertText(' ', 2)
      editor.view.dispatch(tr)
      rejectCreation(new Error('creation failed'))
      await creation
      expect(editor.state.doc.textContent).toBe(edit === 'replace' ? '  existing' : ' existing')
      expect(editor.state.doc.firstChild?.childCount).toBe(1)
      expect(pluginCount()).toBe(0)
    }
  )

  it('maps the owned separator through intervening text insertions before rollback', async () => {
    let rejectCreation: (error: Error) => void = () => {}
    const pending = new Promise<void>((_resolve, reject) => {
      rejectCreation = reject
    })
    const client = { findAll: jest.fn(async () => []), createDoc: jest.fn(() => pending), findOne: jest.fn() }
    ;(getClient as jest.Mock).mockReturnValue(client)
    const { editor, pluginCount } = makeEditor(' existing')
    const creation = createSubpage(editor, 1, makeParent())
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    expect(client.createDoc).toHaveBeenCalledTimes(1)
    editor.view.dispatch(editor.state.tr.insertText('typed', 1))
    rejectCreation(new Error('creation failed'))
    await creation
    expect(editor.state.doc.textContent).toBe('typed existing')
    expect(pluginCount()).toBe(0)
  })
})
