// SPDX-License-Identifier: EPL-2.0

import { getClient } from '@hcengineering/presentation'
import { openDoc } from '@hcengineering/view-resources'
import type { Document } from '@hcengineering/document'
import type { Editor } from '@tiptap/core'
import { createSubpage } from '../utils'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('@hcengineering/view-resources', () => ({ openDoc: jest.fn(), accessDeniedStore: { set: jest.fn() } }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  translate: jest.fn(async () => 'Untitled')
}))

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
    const chain = { focus: jest.fn(), insertContentAt: jest.fn(), run: jest.fn() }
    chain.focus.mockReturnValue(chain)
    chain.insertContentAt.mockReturnValue(chain)
    const editor = {
      state: { doc: { content: { size: 20 }, resolve: () => ({ parent: { inlineContent: true } }) } },
      chain: () => chain
    } as unknown as Editor

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
  })
})
