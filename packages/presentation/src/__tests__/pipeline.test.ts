// SPDX-License-Identifier: EPL-2.0

import type { Class, Client, Doc, Ref } from '@hcengineering/core'
import { OptimizeQueryMiddleware } from '../pipeline'

describe('OptimizeQueryMiddleware.findAll', () => {
  const _class = 'test:class:Doc' as Ref<Class<Doc>>

  async function sentQuery (query: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const findAll = jest.fn(async () => [])
    const client = { findAll } as unknown as Client
    await OptimizeQueryMiddleware.create(client).findAll(_class, query)
    const call = findAll.mock.calls[0] as unknown[] | undefined
    return call?.[1] as Record<string, unknown> | undefined
  }

  it('shortens a one-value $in to the bare value', async () => {
    expect(await sentQuery({ milestone: { $in: ['sprint-1'] } })).toEqual({ milestone: 'sprint-1' })
  })

  it('sends null for a one-value $in whose value is undefined', async () => {
    const sent = await sentQuery({ milestone: { $in: [undefined] } })
    // toStrictEqual tells null from undefined: an undefined condition is dropped before it reaches the server.
    expect(sent).toStrictEqual({ milestone: null })
  })

  it('keeps null for a one-value $in whose value is null', async () => {
    expect(await sentQuery({ milestone: { $in: [null] } })).toStrictEqual({ milestone: null })
  })

  it('leaves a longer $in with an empty entry as it is', async () => {
    const query = { milestone: { $in: [undefined, 'sprint-0'] } }
    expect(await sentQuery(query)).toStrictEqual(query)
  })

  it('turns a one-value $nin into $ne', async () => {
    expect(await sentQuery({ milestone: { $nin: [undefined] } })).toStrictEqual({ milestone: { $ne: undefined } })
  })

  it('answers an empty $in without asking the server', async () => {
    expect(await sentQuery({ milestone: { $in: [] } })).toBeUndefined()
  })
})
