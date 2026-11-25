// SPDX-License-Identifier: EPL-2.0

import { CONTENT_NOTICE_KEY, CONTENT_NOTICE_MAP } from '@hcengineering/collaborator-client'
import type { MeasureContext } from '@hcengineering/core'
import { Doc } from 'yjs'
import type { Context } from '../../context'
import type { RpcMethodParams } from '../rpc'
import { updateContent } from './updateContent'

function makeContext (): MeasureContext {
  return {
    withSync: <T>(_name: string, _params: Record<string, unknown>, fn: () => T): T => fn(),
    with: async <T>(
      _name: string,
      _params: Record<string, unknown>,
      fn: (ctx: MeasureContext) => Promise<T> | T
    ): Promise<T> => await fn({} as unknown as MeasureContext)
  } as unknown as MeasureContext
}

describe('updateContent', () => {
  it('publishes the notice in the same document transaction as the content', async () => {
    const target = new Doc()
    const source = new Doc()
    const notice = { type: 'document-restored', params: { title: 'Snapshot', name: 'Restorer' } }
    const disconnect = jest.fn(async () => {})
    const transact = jest.fn(async (fn: (document: Doc) => void) => {
      fn(target)
    })
    const openDirectConnection = jest.fn(async () => ({ transact, disconnect }))
    const params = {
      hocuspocus: { openDirectConnection },
      transformer: { toYdoc: () => source }
    } as unknown as RpcMethodParams

    await updateContent(
      makeContext(),
      {} as unknown as Context,
      'workspace|Document|doc|content',
      { content: { content: '' }, notice },
      params
    )

    expect(target.getMap(CONTENT_NOTICE_MAP).get(CONTENT_NOTICE_KEY)).toEqual(notice)
    expect(transact).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
