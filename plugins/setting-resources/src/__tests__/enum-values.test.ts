// SPDX-License-Identifier: EPL-2.0

import type { Class, Enum, PersonId, Ref, Space, TxResult } from '@hcengineering/core'
import { createEnumValueAdder } from '../utils/enum-values'

function deferredUpdate (): {
  promise: Promise<TxResult>
  resolve: (result: TxResult) => void
  reject: (error: Error) => void
} {
  let resolveUpdate!: (result: TxResult) => void
  let rejectUpdate!: (error: Error) => void
  const promise = new Promise<TxResult>((resolve, reject) => {
    resolveUpdate = resolve
    rejectUpdate = reject
  })
  return { promise, resolve: resolveUpdate, reject: rejectUpdate }
}

function createEnumValue (): Enum {
  return {
    _id: 'test-enum' as Ref<Enum>,
    _class: 'core:class:Enum' as Ref<Class<Enum>>,
    space: 'core:space:Model' as Ref<Space>,
    modifiedOn: 0,
    modifiedBy: 'test-user' as PersonId,
    name: 'Test enum',
    enumValues: ['Original']
  }
}

describe('enum option add', () => {
  it('writes once when Enter is followed by blur before the update and query echo', async () => {
    const pending = deferredUpdate()
    const client = { update: jest.fn(() => pending.promise) }
    const add = createEnumValueAdder(client)
    const value = createEnumValue()

    const enter = add(value, 'Added')
    const blur = add(value, 'Added')

    expect(client.update).toHaveBeenCalledTimes(1)
    expect(client.update).toHaveBeenCalledWith(value, { $push: { enumValues: 'Added' } })
    await expect(blur).resolves.toBe(false)
    // Keep the query result stale until after both event handlers have run.
    expect(value.enumValues).toEqual(['Original'])
    pending.resolve({})
    await expect(enter).resolves.toBe(true)
  })

  it('allows another option after the previous update completes', async () => {
    const client = { update: jest.fn(async () => ({})) }
    const add = createEnumValueAdder(client)
    const value = createEnumValue()

    await expect(add(value, 'First')).resolves.toBe(true)
    await expect(add(value, 'Second')).resolves.toBe(true)

    expect(client.update).toHaveBeenCalledTimes(2)
    expect(client.update).toHaveBeenLastCalledWith(value, { $push: { enumValues: 'Second' } })
  })

  it('releases the guard after a rejected update so the option can be retried', async () => {
    const pending = deferredUpdate()
    const client = { update: jest.fn(() => pending.promise) }
    const add = createEnumValueAdder(client)
    const value = createEnumValue()
    const error = new Error('Update failed')

    const first = add(value, 'Added')
    const rejected = expect(first).rejects.toBe(error)
    await expect(add(value, 'Added')).resolves.toBe(false)
    pending.reject(error)
    await rejected

    client.update.mockResolvedValue({})
    await expect(add(value, 'Added')).resolves.toBe(true)
    expect(client.update).toHaveBeenCalledTimes(2)
  })

  it('does not write empty or already stored options', async () => {
    const client = { update: jest.fn(async () => ({})) }
    const add = createEnumValueAdder(client)
    const value = createEnumValue()

    await expect(add(value, '')).resolves.toBe(false)
    await expect(add(value, '  ')).resolves.toBe(false)
    await expect(add(value, 'Original')).resolves.toBe(false)
    await expect(add(value, '  Original  ')).resolves.toBe(false)
    expect(client.update).not.toHaveBeenCalled()
  })
})
