// SPDX-License-Identifier: EPL-2.0

import type { Location } from '@hcengineering/ui'
import type { Filter } from '@hcengineering/view'
import { createFilterPersistence, makeFilterStorageKey } from '../filter-persistence'

const location: Location = { path: ['workbench', 'workspace', 'tracker', 'all-issues'] }
const key = makeFilterStorageKey(location, 'issue')
const otherKey = makeFilterStorageKey({ path: ['workbench', 'workspace', 'recruit', 'talents'] }, 'issue')
const filters = [{ index: 1, key: { key: 'status' }, value: ['open'], modes: [], mode: 'in' }] as unknown as Filter[]

function createStorage (): {
  getItem: jest.Mock<string | null, [string]>
  setItem: jest.Mock<void, [string, string]>
} {
  const values = new Map<string, string>()
  return {
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      values.set(key, value)
    })
  }
}

describe('filter persistence', () => {
  it('reuses legacy workspace/application/class keys without growing per visited path', () => {
    expect(key).toBe('filter/workbench/workspace/trackerissue')
    expect(makeFilterStorageKey(location)).toBe('filter/workbench/workspace/tracker')
    expect(otherKey).not.toBe(key)
    expect(makeFilterStorageKey({ path: ['workbench', 'other', 'tracker', 'all-issues'] }, 'issue')).not.toBe(key)
    expect(makeFilterStorageKey(location, 'task')).not.toBe(key)
    expect(makeFilterStorageKey({ path: [...location.path, 'child'] }, 'issue')).toBe(key)
    expect(makeFilterStorageKey({ path: [...location.path.slice(0, 3), 'my-issues'] }, 'issue')).toBe(key)
    expect(makeFilterStorageKey({ path: ['workbench', 'a/b', 'tracker'] }, 'issue')).toBe(
      'filter/workbench/a%2Fb/trackerissue'
    )
  })

  it('ignores transient query and fragment without mutating the location', () => {
    const loc = { ...location, path: [...location.path], query: { search: 'text' }, fragment: 'panel' }
    const snapshot = JSON.stringify(loc)
    expect(makeFilterStorageKey(loc, 'issue')).toBe(key)
    expect(JSON.stringify(loc)).toBe(snapshot)
  })

  it('restores unsaved filters after navigation and a new instance (reload)', () => {
    const storage = createStorage()
    const restore = jest.fn()
    const persistence = createFilterPersistence(storage, restore)
    persistence.load(key, false)
    persistence.save(key, filters, false)
    persistence.load(otherKey, false)
    expect(restore).toHaveBeenLastCalledWith([])
    persistence.load(key, false)
    expect(restore).toHaveBeenLastCalledWith(filters)
    createFilterPersistence(storage, restore).load(key, false)
    expect(restore).toHaveBeenLastCalledWith(filters)
  })

  it('does not save the previous view filters into a new location during navigation', () => {
    const storage = createStorage()
    const persistence = createFilterPersistence(storage, jest.fn())
    persistence.load(key, false)
    persistence.save(key, filters, false)
    persistence.save(otherKey, filters, false)
    expect(storage.getItem(otherKey)).toBeNull()
    expect(storage.getItem(key)).toBe(JSON.stringify(filters))
  })

  it('does not save stale global filters before the initial restore', () => {
    const storage = createStorage()
    const persistence = createFilterPersistence(storage, jest.fn())
    persistence.save(key, filters, false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('does not write restored filters back through a synchronous store subscription', () => {
    const storage = createStorage()
    storage.setItem(key, JSON.stringify(filters))
    const persistence = createFilterPersistence(storage, (value) => {
      persistence.save(key, value, false)
    })
    storage.setItem.mockClear()
    persistence.load(key, false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('does not reload the same location when selection or transient URL state changes', () => {
    const restore = jest.fn()
    const storage = createStorage()
    storage.setItem(key, JSON.stringify(filters))
    const persistence = createFilterPersistence(storage, restore)
    persistence.load(key, false)
    restore.mockClear()
    persistence.load(key, false)
    persistence.load(key, true)
    persistence.load(key, false)
    expect(restore).not.toHaveBeenCalled()
  })

  it('persists the explicit clear action across reloads', () => {
    const storage = createStorage()
    const restore = jest.fn()
    const persistence = createFilterPersistence(storage, restore)
    persistence.load(key, false)
    persistence.save(key, filters, false)
    persistence.save(key, [], false)
    createFilterPersistence(storage, restore).load(key, false)
    expect(restore).toHaveBeenLastCalledWith([])
  })

  it('leaves saved-view filters alone and preserves the unsaved draft', () => {
    const storage = createStorage()
    storage.setItem(key, JSON.stringify(filters))
    const restore = jest.fn()
    const persistence = createFilterPersistence(storage, restore)
    persistence.load(key, true)
    persistence.save(key, [], true)
    expect(restore).not.toHaveBeenCalled()
    expect(storage.getItem(key)).toBe(JSON.stringify(filters))
  })

  it('restores the draft when leaving a saved view within the same application and class', () => {
    const storage = createStorage()
    storage.setItem(key, JSON.stringify(filters))
    const restore = jest.fn()
    const persistence = createFilterPersistence(storage, restore)
    persistence.load(key, true, undefined, 'saved-view-path')
    persistence.save(key, [], true)
    persistence.load(key, false, undefined, 'other-path')
    expect(restore).toHaveBeenLastCalledWith(filters)
  })

  it.each(['before restore', 'after restore', 'after remount'])('applies navigation filters %s', (timing) => {
    const storage = createStorage()
    const restore = jest.fn()
    let persistence = createFilterPersistence(storage, restore)
    persistence.load(otherKey, false)
    if (timing !== 'before restore') persistence.load(key, false)
    if (timing === 'after remount') persistence = createFilterPersistence(storage, restore)
    persistence.load(key, false, filters)
    expect(restore).toHaveBeenLastCalledWith(filters)
    expect(storage.getItem(key)).toBe(JSON.stringify(filters))
    restore.mockClear()
    persistence.load(key, false)
    expect(restore).not.toHaveBeenCalled()
    createFilterPersistence(storage, restore).load(key, false)
    expect(restore).toHaveBeenLastCalledWith(filters)
  })

  it('lets navigation override a saved view and persists an explicit navigation reset', () => {
    const storage = createStorage()
    const restore = jest.fn()
    const persistence = createFilterPersistence(storage, restore)
    persistence.load(key, true)
    persistence.load(key, true, filters)
    expect(restore).toHaveBeenLastCalledWith(filters)
    expect(storage.getItem(key)).toBe(JSON.stringify(filters))
    persistence.load(key, false, [])
    createFilterPersistence(storage, restore).load(key, false)
    expect(restore).toHaveBeenLastCalledWith([])
  })

  it.each(['{invalid', '{}', 'null'])('falls back to no filters for invalid storage: %s', (value) => {
    const storage = createStorage()
    storage.setItem(key, value)
    const restore = jest.fn()
    expect(() => {
      createFilterPersistence(storage, restore).load(key, false)
    }).not.toThrow()
    expect(restore).toHaveBeenLastCalledWith([])
  })

  it('keeps filters usable when browser storage is unavailable or full', () => {
    const storage = {
      getItem: () => {
        throw new Error('Storage unavailable')
      },
      setItem: () => {
        throw new Error('Storage full')
      }
    }
    const restore = jest.fn()
    const persistence = createFilterPersistence(storage, restore)
    expect(() => {
      persistence.load(key, false)
    }).not.toThrow()
    expect(restore).toHaveBeenLastCalledWith([])
    expect(() => {
      persistence.save(key, filters, false)
    }).not.toThrow()
    expect(() => {
      persistence.load(key, false, filters)
    }).not.toThrow()
    expect(restore).toHaveBeenLastCalledWith(filters)
  })
})
