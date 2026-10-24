// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref } from '@hcengineering/core'
import type { Location } from '@hcengineering/ui'
import type { Filter } from '@hcengineering/view'
import { get } from 'svelte/store'
import { filterStore, navigationFilterStore, setFilters } from '../filter'

jest.mock('@hcengineering/core', () => ({}))
jest.mock('@hcengineering/platform', () => ({}))
jest.mock('@hcengineering/presentation', () => ({}))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('../plugin', () => ({}))

const location: Location = { path: ['workbench', 'workspace', 'tracker', 'all-issues'] }
const issueClass = 'tracker:class:Issue' as Ref<Class<Doc>>
const filters = [
  { index: 1, key: { key: 'attachedTo' }, value: ['parent'], modes: [], mode: 'in' }
] as unknown as Filter[]

describe('navigation filter requests', () => {
  beforeEach(() => {
    filterStore.set([])
    navigationFilterStore.set(undefined)
  })

  it('queues the destination and class without changing or saving outgoing filters', () => {
    const onRemove = jest.fn()
    const outgoing = [{ ...filters[0], onRemove }]
    filterStore.set(outgoing)
    const subscriber = jest.fn()
    const unsubscribe = filterStore.subscribe(subscriber)
    subscriber.mockClear()
    setFilters(filters, location, issueClass)
    expect(get(navigationFilterStore)).toEqual({ location, filters, _class: issueClass })
    expect(get(filterStore)).toBe(outgoing)
    expect(subscriber).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('keeps the latest navigation request, including a reset with no known destination class', () => {
    setFilters(filters, location, issueClass)
    setFilters([], location)
    expect(get(navigationFilterStore)).toEqual({ location, filters: [], _class: undefined })
  })

  it('still applies ordinary filter changes immediately and releases previous filters', () => {
    const onRemove = jest.fn()
    filterStore.set([{ ...filters[0], onRemove }])
    setFilters(filters)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(get(filterStore)).toBe(filters)
    expect(get(navigationFilterStore)).toBeUndefined()
  })
})
