// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref } from '@hcengineering/core'
import type { Location } from '@hcengineering/ui'
import type { Filter } from '@hcengineering/view'
import { resolvedLocationStore } from '@hcengineering/ui'
import { get } from 'svelte/store'
import { createFilterPersistence, makeFilterStorageKey } from '../filter-persistence'
import { filterStore, navigationFilterStore, setFilters, takeNavigationFilters } from '../filter'

jest.mock('@hcengineering/core', () => ({}))
jest.mock('@hcengineering/platform', () => ({}))
jest.mock('@hcengineering/presentation', () => ({}))
jest.mock('@hcengineering/ui', () => {
  const { writable } = jest.requireActual('svelte/store')
  return { resolvedLocationStore: writable({ path: ['workbench', 'workspace'] }) }
})
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

it('drops an unclaimed request when the router resolves a different destination', () => {
  navigationFilterStore.set(undefined)
  resolvedLocationStore.set({ path: ['workbench', 'workspace', 'tracker', 'origin'] })
  setFilters(filters, location, issueClass)
  resolvedLocationStore.set({ path: ['workbench', 'workspace', 'tracker', 'resolved-id'] })
  expect(get(navigationFilterStore)).toBeUndefined()
  resolvedLocationStore.set(location)
  expect(takeNavigationFilters(location, issueClass)).toBeUndefined()
})

it.each([filters, []])('preserves navigation filters across destination controller handoff', (override) => {
  navigationFilterStore.set(undefined)
  resolvedLocationStore.set({ path: ['workbench', 'workspace', 'tracker', 'my-issues'] })
  const key = makeFilterStorageKey(location, issueClass)
  const draft = [{ ...filters[0], value: ['draft'] }] as unknown as Filter[]
  const values = new Map([[key, JSON.stringify(draft)]])
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: jest.fn((key: string, value: string) => values.set(key, value)),
    removeItem: jest.fn((key: string) => values.delete(key))
  }
  const restore = jest.fn(setFilters)
  const outgoing = createFilterPersistence(storage, restore)
  outgoing.load('origin', false)
  setFilters(override, location, issueClass)
  resolvedLocationStore.set(location)
  // The outgoing component sees the resolved target before the new one mounts.
  outgoing.load(key, false, takeNavigationFilters(location, issueClass))
  const destination = createFilterPersistence(storage, restore)
  destination.load(key, false, takeNavigationFilters(location, issueClass))
  expect(restore).toHaveBeenLastCalledWith(override)
  expect(get(navigationFilterStore)).toBeUndefined()
  // Svelte can deliver these subscribers after load() has returned.
  outgoing.save(key, override, false)
  destination.save(key, override, false)
  expect(values.get(key)).toBe(JSON.stringify(draft))
  expect(storage.setItem).not.toHaveBeenCalled()
  expect(storage.removeItem).not.toHaveBeenCalled()

  // Even a destination without a filter component expires the one-visit override.
  resolvedLocationStore.set({ path: ['workbench', 'workspace', 'time'] })
  resolvedLocationStore.set(location)
  createFilterPersistence(storage, restore).load(key, false, takeNavigationFilters(location, issueClass))
  expect(restore).toHaveBeenLastCalledWith(draft)
})
