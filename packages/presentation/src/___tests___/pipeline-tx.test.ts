// SPDX-License-Identifier: EPL-2.0

import core, { generateId, TxFactory } from '@hcengineering/core'
import type { Client, Doc } from '@hcengineering/core'
import { addEventListener, PlatformEvent, removeEventListener, unknownError } from '@hcengineering/platform'
import { OptimizeQueryMiddleware, PresentationPipelineImpl } from '../pipeline'

describe('presentation transaction errors', () => {
  const error = new Error('Offline')
  const tx = new TxFactory(core.account.System).createTxRemoveDoc(
    core.class.Doc,
    core.space.Workspace,
    generateId<Doc>()
  )
  const write = jest.fn(async () => {
    throw error
  })
  const transport: Partial<Client> = { tx: write }
  const pipeline = PresentationPipelineImpl.create(transport as Client, [
    (client, next) => OptimizeQueryMiddleware.create(client, next)
  ])

  it('allows callers to handle a transport rejection without turning it into a successful result', async () => {
    await expect(pipeline.txOrThrow(tx)).rejects.toBe(error)
    expect(write).toHaveBeenCalledWith(tx)
  })

  it('continues to report errors as platform status for existing callers', async () => {
    const listener = jest.fn(async () => {})
    const trace = jest.spyOn(console, 'trace').mockImplementation(() => {})
    addEventListener(PlatformEvent, listener)
    try {
      await expect(pipeline.tx(tx)).resolves.toEqual({})
      expect(listener).toHaveBeenCalledWith(PlatformEvent, unknownError(error))
    } finally {
      removeEventListener(PlatformEvent, listener)
      trace.mockRestore()
    }
  })
})
