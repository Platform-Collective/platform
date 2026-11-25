// SPDX-License-Identifier: EPL-2.0

import { getClient } from '@hcengineering/presentation'
import { captureEditorPosition } from '@hcengineering/text-editor-resources'
import { openDoc } from '@hcengineering/view-resources'
import type { Document } from '@hcengineering/document'
import type { Editor } from '@tiptap/core'
import { createSubpage } from '../utils'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/text-editor-resources', () => ({ captureEditorPosition: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('@hcengineering/view-resources', () => ({ openDoc: jest.fn(), accessDeniedStore: { set: jest.fn() } }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  translate: jest.fn(async () => 'Untitled')
}))

function makeParent (): Document {
  return Object.assign(Object.create(null), { _id: 'parent', space: 'teamspace' })
}

function makeEditor (): { editor: Editor, chain: any } {
  const chain: any = {
    focus: jest.fn(),
    insertContentAt: jest.fn(),
    run: jest.fn(() => true)
  }
  chain.focus.mockReturnValue(chain)
  chain.insertContentAt.mockReturnValue(chain)
  const editor = {
    state: {
      doc: {
        content: { size: 100 },
        resolve: jest.fn(() => ({ parent: { inlineContent: true } }))
      }
    },
    isDestroyed: false,
    chain: () => chain
  } as unknown as Editor
  return { editor, chain }
}

describe('subpage creation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(captureEditorPosition as jest.Mock).mockReturnValue(() => 6)
  })

  it('creates the document before inserting its link and navigates without waiting for a flush', async () => {
    let finishCreation: () => void = () => {}
    const pendingCreation = new Promise<void>((resolve) => {
      finishCreation = resolve
    })
    const child = { _id: 'child' }
    const client = {
      findAll: jest.fn(async () => []),
      createDoc: jest.fn(async () => {
        await pendingCreation
      }),
      findOne: jest.fn(async () => child),
      getHierarchy: jest.fn(() => ({}))
    }
    ;(getClient as jest.Mock).mockReturnValue(client)
    const flush = jest.fn(async () => {})
    const { editor, chain } = makeEditor()

    const creation = (createSubpage as (...args: any[]) => Promise<void>)(editor, 2, makeParent(), flush)
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    expect(captureEditorPosition).toHaveBeenCalledWith(editor, 2)
    expect(client.createDoc).toHaveBeenCalledTimes(1)
    expect(chain.insertContentAt).not.toHaveBeenCalled()

    finishCreation()
    await creation
    expect(chain.insertContentAt).toHaveBeenCalledWith(6, [
      {
        type: 'reference',
        attrs: { id: expect.any(String), objectclass: 'document:class:Document', label: 'Untitled' }
      },
      { type: 'text', text: ' ' }
    ])
    expect(flush).not.toHaveBeenCalled()
    expect(openDoc).toHaveBeenCalledWith({}, child)
    expect(chain.run.mock.invocationCallOrder[0]).toBeLessThan((openDoc as jest.Mock).mock.invocationCallOrder[0])
  })

  it('does not insert a link when document creation fails', async () => {
    const client = {
      findAll: jest.fn(async () => []),
      createDoc: jest.fn(async () => {
        throw new Error('creation failed')
      }),
      findOne: jest.fn()
    }
    ;(getClient as jest.Mock).mockReturnValue(client)
    const { editor, chain } = makeEditor()

    await createSubpage(editor, 2, makeParent())
    expect(chain.insertContentAt).not.toHaveBeenCalled()
    expect(openDoc).not.toHaveBeenCalled()
  })
})
