// SPDX-License-Identifier: EPL-2.0

import {
  isPanelSectionCollapsed,
  panelSectionStorageKey,
  setPanelSectionCollapsed,
  type SectionStorage
} from '../control-panel-sections'

function memoryStorage (): SectionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    }
  }
}

const brokenStorage: SectionStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
  removeItem: () => {
    throw new Error('blocked')
  }
}

describe('panel section collapse state', () => {
  it('is expanded by default', () => {
    expect(isPanelSectionCollapsed('dates', memoryStorage())).toBe(false)
  })

  it('remembers a collapsed section in browser storage and forgets it when expanded again', () => {
    const storage = memoryStorage()
    setPanelSectionCollapsed('dates', true, storage)
    expect(storage.data.get(panelSectionStorageKey('dates'))).toBe('1')
    expect(isPanelSectionCollapsed('dates', storage)).toBe(true)
    expect(isPanelSectionCollapsed('planning', storage)).toBe(false)

    setPanelSectionCollapsed('dates', false, storage)
    expect(storage.data.has(panelSectionStorageKey('dates'))).toBe(false)
    expect(isPanelSectionCollapsed('dates', storage)).toBe(false)
  })

  it('uses one key per section, independent of the issue', () => {
    expect(panelSectionStorageKey('details')).toBe('tracker.issuePanel.section.details.collapsed')
    expect(panelSectionStorageKey('mixin:tracker:mixin:Custom')).toBe(
      'tracker.issuePanel.section.mixin:tracker:mixin:Custom.collapsed'
    )
  })

  it('falls back to expanded and never throws when storage is unavailable', () => {
    expect(isPanelSectionCollapsed('details', brokenStorage)).toBe(false)
    expect(() => {
      setPanelSectionCollapsed('details', true, brokenStorage)
    }).not.toThrow()
    expect(isPanelSectionCollapsed('details', undefined)).toBe(false)
  })
})
