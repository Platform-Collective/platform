// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import type { Doc, DocumentQuery } from '@hcengineering/core'
import type { Filter, FilterMode } from '@hcengineering/view'
import { createFilterQueryComposer } from '../filter/composer'
import { cancelFilterQuery } from '../filter/lifecycle'
import type { ResourceResolver } from '../filter/query-builder'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))

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
  value: [],
  index: 1
}
const mode = { result: 'test:function:Result' as FilterMode['result'] } as FilterMode

function deferred<T> (): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolveValue: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })
  return { promise, resolve: resolveValue }
}

describe('filter query composer', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    jest.mocked(Analytics.handleError).mockClear()
    consoleError.mockClear()
  })

  afterEach(() => {
    cancelFilterQuery(filter.index)
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  it.each(['mode', 'resource', 'result'] as const)(
    'reports a rejected %s and runs the queued composition',
    async (stage) => {
      const started = deferred<undefined>()
      const release = deferred<undefined>()
      const dispatched = deferred<DocumentQuery<Doc>>()
      const failure = new Error(`Failed ${stage}`)
      const fail = async (): Promise<never> => {
        started.resolve(undefined)
        await release.promise
        throw failure
      }
      const resolveResource = (async (): Promise<unknown> => {
        if (stage === 'resource') return await fail()
        return fail
      }) as unknown as ResourceResolver
      const compose = createFilterQueryComposer({
        resolveMode: async () => (stage === 'mode' ? await fail() : mode),
        resolveResource,
        refresh: jest.fn(),
        onChange: (query) => {
          dispatched.resolve(query)
        }
      })

      await compose({}, [filter])
      await started.promise
      const next: DocumentQuery<Doc> = { _class: 'test:class:Doc' as Doc['_class'] }
      await compose(next, [])
      release.resolve(undefined)

      expect(await dispatched.promise).toEqual(next)
      expect(Analytics.handleError).toHaveBeenCalledTimes(1)
      expect(Analytics.handleError).toHaveBeenCalledWith(failure)
      expect(consoleError).not.toHaveBeenCalled()
    }
  )

  it('reports a dispatch failure and runs the queued composition', async () => {
    const dispatched = deferred<DocumentQuery<Doc>>()
    const failure = new Error('Failed dispatch')
    const next: DocumentQuery<Doc> = { _class: 'test:class:Doc' as Doc['_class'] }
    const compose = createFilterQueryComposer({
      resolveMode: async () => mode,
      refresh: jest.fn(),
      onChange: (query) => {
        if (query._class === undefined) {
          void compose(next, [])
          throw failure
        }
        dispatched.resolve(query)
      }
    })

    await compose({}, [])

    expect(await dispatched.promise).toEqual(next)
    expect(Analytics.handleError).toHaveBeenCalledTimes(1)
    expect(Analytics.handleError).toHaveBeenCalledWith(failure)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
