// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref } from '@hcengineering/core'
import type { Location } from '@hcengineering/ui'
import type { Filter } from '@hcengineering/view'
import { resolvedLocationStore } from '@hcengineering/ui'
import { get } from 'svelte/store'
import { filterStore, navigationFilterStore, setFilters, takeNavigationFilters } from '../filter'

jest.mock('@hcengineering/core', () => ({}))
jest.mock('@hcengineering/platform', () => ({}))
jest.mock('@hcengineering/presentation', () => ({}))
jest.mock('@hcengineering/ui', () => ({
  resolvedLocationStore: jest.requireActual<typeof import('svelte/store')>('svelte/store').writable({
    path: ['workbench', 'workspace']
  })
}))
jest.mock('../plugin', () => ({}))

const location: Location = { path: ['workbench', 'workspace', 'tracker', 'all-issues'] }
const issueClass = 'tracker:class:Issue' as Ref<Class<Doc>>
const filters = [
  { index: 1, key: { key: 'attachedTo' }, value: ['parent'], modes: [], mode: 'in' }
] as unknown as Filter[]

describe('navigation filter requests', () => {
  const resolved = resolvedLocationStore

  beforeEach(() => {
    filterStore.set([])
    navigationFilterStore.set(undefined)
    resolved.set({ path: ['workbench', 'workspace', 'tracker', 'my-issues'] })
  })

  it('queues the destination and class without changing or saving outgoing filters', () => {
    const onRemove = jest.fn()
    const outgoing = [{ ...filters[0], onRemove }]
    filterStore.set(outgoing)
    const subscriber = jest.fn()
    const unsubscribe = filterStore.subscribe(subscriber)
    subscriber.mockClear()
    setFilters(filters, location, issueClass)
    expect(get(navigationFilterStore)).toMatchObject({ location, filters, _class: issueClass })
    expect(get(filterStore)).toBe(outgoing)
    expect(subscriber).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('keeps the latest navigation request, including a reset with no known destination class', () => {
    setFilters(filters, location, issueClass)
    setFilters([], location)
    expect(get(navigationFilterStore)).toMatchObject({ location, filters: [], _class: undefined })
  })

  it('still applies ordinary filter changes immediately and releases previous filters', () => {
    const onRemove = jest.fn()
    filterStore.set([{ ...filters[0], onRemove }])
    setFilters(filters)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(get(filterStore)).toBe(filters)
    expect(get(navigationFilterStore)).toBeUndefined()
  })

  it('hands the filters to the destination view once', () => {
    setFilters(filters, location, issueClass)
    resolved.set(location)
    expect(takeNavigationFilters(location, issueClass)).toBe(filters)
    expect(takeNavigationFilters(location, issueClass)).toBeUndefined()
  })

  it('does not hand the filters to a view of another location or class', () => {
    setFilters(filters, location, issueClass)
    const otherView: Location = { path: ['workbench', 'workspace', 'tracker', 'my-issues'] }
    expect(takeNavigationFilters(otherView, issueClass)).toBeUndefined()
    expect(takeNavigationFilters(location, 'other' as Ref<Class<Doc>>)).toBeUndefined()
    expect(takeNavigationFilters(location, issueClass)).toBe(filters)
  })

  it('drops filters that no view picked up once the destination is left', () => {
    setFilters(filters, location, issueClass)
    resolved.set(location)
    resolved.set({ path: ['workbench', 'workspace', 'tracker', 'my-issues'] })
    expect(get(navigationFilterStore)).toBeUndefined()
    resolved.set(location)
    expect(takeNavigationFilters(location, issueClass)).toBeUndefined()
  })

  it('keeps queued filters while the navigation to the destination is still pending', () => {
    setFilters(filters, location, issueClass)
    resolved.set({ path: ['workbench', 'workspace', 'tracker', 'my-issues'], fragment: 'panel' })
    expect(get(navigationFilterStore)).toBeDefined()
    resolved.set({ ...location, query: { mode: 'list' } })
    expect(takeNavigationFilters(location, issueClass)).toBe(filters)
  })
})
