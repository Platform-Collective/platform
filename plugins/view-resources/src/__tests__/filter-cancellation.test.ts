// SPDX-License-Identifier: EPL-2.0

import type { Doc, DocumentQuery } from '@hcengineering/core'
import type { Filter, FilterMode } from '@hcengineering/view'
import { FilterQueryLifetime, cancelFilterQuery } from '../filter/lifecycle'
import { makeFilterQuery, makeFilterQueryWithLifetime, type ResourceResolver } from '../filter/query-builder'

const mockResult = async (filter: Filter): Promise<{ $in: unknown }> => ({ $in: filter.value })
const mockMode = { result: 'test:function:Result' as FilterMode['result'] } as FilterMode
const filter: Filter = {
  key: {
    _class: 'test:class:Doc' as Filter['key']['_class'],
    key: 'value',
    attribute: undefined as Filter['key']['attribute'],
    label: 'test:string:Value' as Filter['key']['label'],
    component: 'test:component:Filter' as Filter['key']['component']
  },
  mode: 'test:filter:Mode' as Filter['mode'],
  modes: [],
  value: ['test:value:Current'],
  index: 1
}

function deferred<T> (): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolveValue: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })
  return { promise, resolve: resolveValue }
}

describe('filter query cancellation', () => {
  afterEach(() => {
    cancelFilterQuery(filter.index)
  })

  it('captures an already-cancelled lifetime for an unowned index', () => {
    expect(FilterQueryLifetime.capture(filter.index).isActive()).toBe(false)

    FilterQueryLifetime.register([filter.index])
    expect(FilterQueryLifetime.capture(filter.index).isActive()).toBe(true)

    cancelFilterQuery(filter.index)
    expect(FilterQueryLifetime.capture(filter.index).isActive()).toBe(false)
  })

  it.each(['mode', 'resource'] as const)('cancels during %s lookup without reviving a reused index', async (stage) => {
    const lookup = deferred<undefined>()
    const pendingMode = deferred<FilterMode>()
    const pendingResource = deferred<typeof mockResult>()
    const lifetime = FilterQueryLifetime.register([filter.index])
    const refresh = jest.fn()
    const resolveMode = jest.fn(async (): Promise<FilterMode> => {
      if (stage === 'mode') {
        lookup.resolve(undefined)
        return await pendingMode.promise
      }
      return mockMode
    })
    const resolveResource = jest.fn(async (): Promise<typeof mockResult> => {
      lookup.resolve(undefined)
      return await pendingResource.promise
    }) as unknown as ResourceResolver
    const currentResource = (async (): Promise<typeof mockResult> => mockResult) as unknown as ResourceResolver
    const pending = makeFilterQueryWithLifetime(
      {},
      [filter],
      resolveMode,
      resolveResource,
      undefined,
      refresh,
      lifetime
    )
    await lookup.promise

    cancelFilterQuery(filter.index)
    expect(await pending).toBeUndefined()

    FilterQueryLifetime.register([filter.index])
    const replacement = { ...filter, value: ['test:value:Replacement'] }
    const next: DocumentQuery<Doc> = await makeFilterQuery({}, [replacement], async () => mockMode, currentResource)
    expect(next).toEqual({ value: { $in: ['test:value:Replacement'] } })

    pendingMode.resolve(mockMode)
    pendingResource.resolve(mockResult)
    expect(await pending).toBeUndefined()
    expect(refresh).not.toHaveBeenCalled()
  })
})
