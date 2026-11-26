// SPDX-License-Identifier: EPL-2.0
import { SortingOrder, type Ref } from '@hcengineering/core'
import { type IntlString } from '@hcengineering/platform'
import { type Viewlet, type ViewOptions, type ViewOptionsModel } from '@hcengineering/view'
import { defaultOptions, getDefaultViewOptions, getViewOptions, noCategory, viewOptionStore } from '../viewOptions'

jest.mock('@hcengineering/core', () => ({ SortingOrder: { Ascending: 1, Descending: -1 } }), { virtual: true })
jest.mock('@hcengineering/platform', () => ({}), { virtual: true })
jest.mock('@hcengineering/presentation', () => ({}), { virtual: true })
jest.mock(
  '@hcengineering/ui',
  () => ({
    getCurrentResolvedLocation: () => ({ path: ['workbench', 'test', 'tracker'], fragment: 'issue', query: {} }),
    locationToUrl: (location: { path: string[] }) => '/' + location.path.join('/')
  }),
  { virtual: true }
)
jest.mock('../plugin', () => ({}))
jest.mock('../utils', () => ({}))

describe('viewlet model defaults and saved preferences', () => {
  const model: ViewOptionsModel = {
    groupBy: ['status', 'kind', 'assignee'],
    orderBy: [['rank', SortingOrder.Ascending]],
    other: [{ key: 'showColors', type: 'toggle', defaultValue: true, label: 'view:string:ShowColors' as IntlString }]
  }
  const viewlet = {
    _id: 'tracker:viewlet:SubIssues' as Ref<Viewlet>,
    variant: 'subissue',
    viewOptions: model
  } as unknown as Viewlet
  const storage = new Map<string, string>()
  const storageKey = 'viewOptions:tracker:viewlet:SubIssues-subissue:/workbench/test/tracker'
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  beforeEach(() => {
    storage.clear()
    viewOptionStore.set(new Map())
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (key: string) => storage.get(key) ?? null }
    })
  })

  afterAll(() => {
    if (originalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage')
    } else {
      Object.defineProperty(globalThis, 'localStorage', originalStorage)
    }
  })

  it('groups sub-issues by status with rank ordering and model toggles on clean storage', () => {
    const options = getViewOptions(viewlet, new Map(), getDefaultViewOptions(viewlet.viewOptions))

    expect(options).toEqual({
      groupBy: ['status'],
      orderBy: ['rank', SortingOrder.Ascending],
      showColors: true
    })
    expect(storage.size).toBe(0)
  })

  it('uses generic defaults when there is no model', () => {
    expect(getDefaultViewOptions()).toEqual(defaultOptions)
    expect(getViewOptions(undefined, new Map(), getDefaultViewOptions())).toEqual(defaultOptions)
  })

  it('falls back to generic grouping and ordering when the model lists are empty', () => {
    expect(getDefaultViewOptions({ groupBy: [], orderBy: [], other: [] })).toEqual(defaultOptions)
  })

  it('preserves explicitly saved No grouping from localStorage', () => {
    const saved: ViewOptions = {
      groupBy: [noCategory],
      orderBy: ['priority', SortingOrder.Descending],
      showColors: false
    }
    storage.set(storageKey, JSON.stringify(saved))

    expect(getViewOptions(viewlet, new Map(), getDefaultViewOptions(model))).toEqual(saved)
  })

  it('preserves cached preferences over model defaults and localStorage', () => {
    const saved: ViewOptions = { groupBy: ['assignee'], orderBy: ['rank', SortingOrder.Descending] }
    storage.set(storageKey, JSON.stringify(defaultOptions))

    expect(getViewOptions(viewlet, new Map([[storageKey, saved]]), getDefaultViewOptions(model))).toBe(saved)
  })
})
