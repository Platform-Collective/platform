// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import { createQuery, getClient } from '@hcengineering/presentation'
import { getCurrentLocation, navigate } from '@hcengineering/ui'
import type { Location, ResolvedLocation } from '@hcengineering/ui'
import { parseLinkId } from '@hcengineering/view-resources'
import type { LocationData, WorkbenchTab } from '@hcengineering/workbench'
import { get } from 'svelte/store'
import { closeTab, getTabDataByLocation, tabIdStore, tabsStore, watchTabDocuments } from '../workbench'

jest.mock(
  '@hcengineering/core',
  () => ({
    __esModule: true,
    default: { space: { Workspace: 'workspace' }, metadata: { DisablePermissions: 'permissions' } },
    concatLink: (base: string, path: string) => `${base}/${path}`,
    getCurrentAccount: () => ({ uuid: 'account' }),
    reduceCalls: (fn: () => Promise<void>) => fn
  }),
  { virtual: true }
)
jest.mock(
  '@hcengineering/notification',
  () => ({
    __esModule: true,
    default: { string: { Inbox: 'Inbox' } },
    notificationId: 'notification'
  }),
  { virtual: true }
)
jest.mock(
  '@hcengineering/platform',
  () => ({
    getMetadata: jest.fn(),
    setMetadata: jest.fn(),
    getResource: jest.fn(),
    translate: jest.fn(async (label: string) => label)
  }),
  { virtual: true }
)
jest.mock(
  '@hcengineering/presentation',
  () => ({
    __esModule: true,
    default: { metadata: { FrontUrl: 'front' } },
    configurationStore: jest.requireActual<typeof import('svelte/store')>('svelte/store').writable(new Map()),
    getClient: jest.fn(),
    createQuery: jest.fn()
  }),
  { virtual: true }
)
jest.mock(
  '@hcengineering/ui',
  () => ({
    getCurrentLocation: jest.fn(() => ({ path: ['workbench', 'workspace'] })),
    languageStore: jest.requireActual<typeof import('svelte/store')>('svelte/store').writable('en'),
    location: jest.requireActual<typeof import('svelte/store')>('svelte/store').writable(undefined),
    locationStorageKeyId: 'location',
    locationToUrl: (loc: Location) => {
      const entries = Object.entries(loc.query ?? {}).map(([key, value]) => [key, value ?? ''])
      const query = entries.length === 0 ? '' : `?${new URLSearchParams(entries).toString()}`
      return loc.path.join('/') + query + (loc.fragment === undefined ? '' : `#${loc.fragment}`)
    },
    parseLocation: (url: URL) => {
      const query: Record<string, string> = {}
      url.searchParams.forEach((value, key) => {
        query[key] = value
      })
      return {
        path: url.pathname.slice(1).split('/'),
        query: url.search === '' ? undefined : query,
        fragment: url.hash.slice(1) || undefined
      }
    },
    navigate: jest.fn()
  }),
  { virtual: true }
)
jest.mock(
  '@hcengineering/view',
  () => ({
    __esModule: true,
    default: { mixin: { ObjectTitle: 'title', LinkIdProvider: 'link' } }
  }),
  { virtual: true }
)
jest.mock('@hcengineering/view-resources', () => ({ parseLinkId: jest.fn() }), { virtual: true })
jest.mock('@hcengineering/workbench', () => ({ workbenchId: 'workbench' }), { virtual: true })
jest.mock(
  '@hcengineering/setting',
  () => ({
    __esModule: true,
    default: { ids: { DisablePermissionsConfiguration: 'permissions' } }
  }),
  { virtual: true }
)
jest.mock('../plugin', () => ({
  __esModule: true,
  default: { class: { Application: 'application', WorkbenchTab: 'tab' }, string: { Tab: 'Tab' } }
}))
jest.mock('../utils', () => ({
  locationWorkspaceStore: jest.requireActual<typeof import('svelte/store')>('svelte/store').writable(undefined)
}))

interface TestQuery {
  query: jest.Mock
  unsubscribe: jest.Mock
  emit: (docs: Doc[]) => void
}

const objectId = 'document' as Ref<Doc>
const objectClass = 'document-class' as Ref<Class<Doc>>
const documentData: LocationData = { objectId, objectClass, name: 'Document' }
const resolver = jest.fn<Promise<LocationData>, [Location]>()
const queries: TestQuery[] = []
const application = {
  alias: 'app',
  label: 'App',
  locationDataResolver: resolver as typeof resolver | undefined,
  locationResolver: undefined as jest.Mock | undefined
}
const client = {
  getModel: () => ({ findAllSync: (cls: string) => (cls === 'application' ? [application] : []) }),
  getHierarchy: () => ({ hasClass: () => true, classHierarchyMixin: () => undefined }),
  createDoc: jest.fn(async () => 'new-tab'),
  update: jest.fn(async () => {}),
  remove: jest.fn(async () => {})
}

function makeTab (id: string, location = 'workbench/workspace/app/document'): WorkbenchTab {
  return { _id: id, location, isPinned: false } as unknown as WorkbenchTab
}

async function flush (): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { protocol: 'https:', host: 'localhost' } }
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: jest.fn(() => null), setItem: jest.fn() }
  })
})

beforeEach(() => {
  jest.clearAllMocks()
  queries.length = 0
  tabsStore.set([])
  tabIdStore.set(undefined)
  application.locationDataResolver = resolver
  application.locationResolver = undefined
  resolver.mockReset().mockResolvedValue(documentData)
  jest.mocked(getClient).mockReturnValue(client as unknown as ReturnType<typeof getClient>)
  jest.mocked(getResource).mockImplementation(async (resource) => resource)
  jest.mocked(parseLinkId).mockResolvedValue(objectId)
  jest.mocked(getCurrentLocation).mockReturnValue({ path: ['workbench', 'workspace'] })
  jest.mocked(createQuery).mockImplementation(() => {
    const entry: TestQuery = { query: jest.fn(), unsubscribe: jest.fn(), emit: () => {} }
    entry.query.mockImplementation((_class: Ref<Class<Doc>>, _query: unknown, callback: TestQuery['emit']) => {
      entry.emit = callback
    })
    queries.push(entry)
    return entry as unknown as ReturnType<typeof createQuery>
  })
})

describe('tab document subscriptions', () => {
  let unwatch: () => void

  afterEach(() => {
    unwatch?.()
  })

  it.each([
    { kind: 'issue', appPath: 'tracker/project/issues' },
    { kind: 'talent', appPath: 'recruit/talents' },
    { kind: 'company', appPath: 'recruit/organizations' },
    { kind: 'application', appPath: 'recruit/candidates' }
  ])('keeps the active list tab when its $kind panel document is deleted', async ({ appPath }) => {
    application.locationDataResolver = undefined
    const location = `workbench/workspace/${appPath}?filter=mine`
    const tab = makeTab('panel', `${location}#panel|LINK-1|document-class`)
    const unrelated = makeTab('unrelated', 'workbench/workspace/notification')
    const listLocation: Location = {
      path: ['workbench', 'workspace', ...appPath.split('/')],
      query: { filter: 'mine' }
    }
    tabsStore.set([tab, unrelated])
    tabIdStore.set(tab._id)
    jest.mocked(getCurrentLocation).mockReturnValue({ ...listLocation, fragment: 'panel|LINK-1|document-class' })
    unwatch = watchTabDocuments()
    await flush()

    queries[0].emit([{ _id: objectId } as unknown as Doc])
    queries[0].emit([])
    queries[0].emit([])
    await flush()

    expect(client.update).toHaveBeenCalledTimes(1)
    expect(client.update).toHaveBeenCalledWith(tab, { location, name: 'App' })
    expect(get(tabsStore)).toEqual([{ ...tab, location, name: 'App' }, unrelated])
    expect(get(tabIdStore)).toBe(tab._id)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({ ...listLocation, fragment: undefined })
    expect(client.remove).not.toHaveBeenCalled()
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(queries[0].unsubscribe).toHaveBeenCalledTimes(1)
    expect(queries[1].unsubscribe).not.toHaveBeenCalled()
  })

  it.each([false, true])('dismisses a resolver panel with active=%s without closing its tab', async (active) => {
    resolver.mockImplementation(async (loc) => (loc.fragment === undefined ? { name: 'List' } : documentData))
    const location = 'workbench/workspace/app/list'
    const tab = makeTab('panel', `${location}#panel|document|document-class`)
    const unrelated = makeTab('unrelated', 'workbench/workspace/app/other')
    tabsStore.set([tab, unrelated])
    const activeTab = active ? tab : unrelated
    tabIdStore.set(activeTab._id)
    jest.mocked(getCurrentLocation).mockReturnValue({
      path: ['workbench', 'workspace', 'app', active ? 'list' : 'other'],
      fragment: active ? 'panel|document|document-class' : undefined
    })
    unwatch = watchTabDocuments()
    await flush()

    queries[0].emit([{ _id: objectId } as unknown as Doc])
    queries[0].emit([])
    await flush()

    expect(client.update).toHaveBeenCalledWith(tab, { location, name: 'List' })
    expect(get(tabsStore)).toEqual([{ ...tab, location, name: 'List' }, unrelated])
    expect(get(tabIdStore)).toBe(activeTab._id)
    expect(navigate).toHaveBeenCalledTimes(active ? 1 : 0)
    expect(client.remove).not.toHaveBeenCalled()
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(queries[1].unsubscribe).not.toHaveBeenCalled()
  })

  it('keeps a final pinned tab when only its panel document was deleted', async () => {
    application.locationDataResolver = undefined
    const location = 'workbench/workspace/app/list'
    const tab = { ...makeTab('last', `${location}#panel|document|document-class`), isPinned: true }
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    unwatch = watchTabDocuments()
    await flush()

    queries[0].emit([{ _id: objectId } as unknown as Doc])
    queries[0].emit([])
    await flush()

    expect(get(tabsStore)).toEqual([{ ...tab, location, name: 'App' }])
    expect(get(tabIdStore)).toBe(tab._id)
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
  })

  it('clears an inactive fragment panel while keeping the unrelated active tab untouched', async () => {
    application.locationDataResolver = undefined
    const location = 'workbench/workspace/recruit/talents'
    const tab = makeTab('panel', `${location}#panel|document|document-class`)
    const activeTab = makeTab('active', 'workbench/workspace/tracker/project/issues')
    tabsStore.set([tab, activeTab])
    tabIdStore.set(activeTab._id)
    unwatch = watchTabDocuments()
    await flush()

    queries[0].emit([{ _id: objectId } as unknown as Doc])
    queries[0].emit([])
    await flush()

    expect(client.update).toHaveBeenCalledTimes(1)
    expect(client.update).toHaveBeenCalledWith(tab, { location, name: 'App' })
    expect(get(tabsStore)).toEqual([{ ...tab, location, name: 'App' }, activeTab])
    expect(get(tabIdStore)).toBe(activeTab._id)
    expect(navigate).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(queries[1].unsubscribe).not.toHaveBeenCalled()
  })

  it('keeps a different document in the path when the fragment document is deleted', async () => {
    const underlyingDocument = { objectId: 'underlying' as Ref<Doc>, objectClass, name: 'Underlying' }
    resolver.mockImplementation(async (loc) => (loc.fragment === undefined ? underlyingDocument : documentData))
    const location = 'workbench/workspace/app/underlying'
    const tab = makeTab('panel', `${location}#panel|document|document-class`)
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    unwatch = watchTabDocuments()
    await flush()

    queries[0].emit([{ _id: objectId } as unknown as Doc])
    queries[0].emit([])
    await flush()

    expect(get(tabsStore)).toEqual([{ ...tab, location, name: 'Underlying' }])
    expect(client.update).toHaveBeenCalledWith(tab, { location, name: 'Underlying' })
    expect(client.remove).not.toHaveBeenCalled()
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(queries[1].query).toHaveBeenCalledWith(
      objectClass,
      { _id: underlyingDocument.objectId },
      expect.any(Function)
    )
  })

  it.each([false, true])('returns an active document tab to the app root with pinned=%s', async (isPinned) => {
    resolver.mockImplementation(async (loc) => (loc.path.length === 3 ? { name: 'Home' } : documentData))
    const tab: WorkbenchTab = {
      ...makeTab('document', 'workbench/workspace/app/document?filter=mine#panel|document|document-class'),
      isPinned
    }
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    unwatch = watchTabDocuments()
    await flush()

    queries[0].emit([{ _id: objectId } as unknown as Doc])
    // Real resolvers can no longer look up the document after deletion.
    resolver.mockResolvedValue({})
    queries[0].emit([])
    queries[0].emit([])
    await flush()

    expect(client.update).toHaveBeenCalledTimes(1)
    expect(client.update).toHaveBeenCalledWith(tab, { location: 'workbench/workspace/app', name: 'Home' })
    expect(get(tabsStore)).toEqual([{ ...tab, location: 'workbench/workspace/app', name: 'Home' }])
    expect(get(tabIdStore)).toBe(tab._id)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({ path: ['workbench', 'workspace', 'app'] })
    expect(client.remove).not.toHaveBeenCalled()
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(queries[0].unsubscribe).toHaveBeenCalledTimes(1)
  })

  it.each([
    { kind: 'issue', app: 'tracker', document: 'ISSUE-1', fragment: undefined },
    { kind: 'talent', app: 'recruit', document: 'candidate-document', fragment: 'panel|LINK-1|document-class' },
    { kind: 'company', app: 'recruit', document: 'company-document', fragment: undefined },
    { kind: 'application', app: 'recruit', document: 'APP-1', fragment: undefined }
  ])('returns the active $kind short-link tab to its app root after deletion', async ({ app, document, fragment }) => {
    application.locationDataResolver = undefined
    const resolveLocation = jest.fn(async (loc: Location): Promise<ResolvedLocation | undefined> => {
      if (loc.path.length === 3) return undefined
      return {
        loc: { path: ['workbench', 'workspace'], fragment: 'panel|LINK-1|document-class' },
        defaultLocation: { path: ['workbench', 'workspace', app, 'list'] }
      }
    })
    application.locationResolver = resolveLocation
    const suffix = fragment === undefined ? '' : `#${fragment}`
    const tab = makeTab('document', `workbench/workspace/${app}/${document}?filter=mine${suffix}`)
    const unrelated = makeTab('unrelated', 'workbench/workspace/notification')
    tabsStore.set([tab, unrelated])
    tabIdStore.set(tab._id)
    unwatch = watchTabDocuments()
    await flush()

    queries[0].emit([{ _id: objectId } as unknown as Doc])
    resolveLocation.mockResolvedValue(undefined)
    queries[0].emit([])
    queries[0].emit([])
    await flush()

    const location = `workbench/workspace/${app}`
    expect(client.update).toHaveBeenCalledTimes(1)
    expect(client.update).toHaveBeenCalledWith(tab, { location, name: 'App' })
    expect(get(tabsStore)).toEqual([{ ...tab, location, name: 'App' }, unrelated])
    expect(get(tabIdStore)).toBe(tab._id)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({ path: ['workbench', 'workspace', app] })
    expect(client.remove).not.toHaveBeenCalled()
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(queries[0].unsubscribe).toHaveBeenCalledTimes(1)
    expect(queries[1].unsubscribe).not.toHaveBeenCalled()
  })

  it('closes an inactive document short-link tab whose path resolver generates the panel fragment', async () => {
    application.locationDataResolver = undefined
    application.locationResolver = jest.fn(async () => ({
      loc: { path: ['workbench', 'workspace'], fragment: 'panel|LINK-1|document-class' }
    }))
    const tab = makeTab('document', 'workbench/workspace/app/LINK-1#panel|LINK-1|document-class')
    const unrelated = makeTab('unrelated', 'workbench/workspace/app/other')
    tabsStore.set([tab, unrelated])
    tabIdStore.set(unrelated._id)
    unwatch = watchTabDocuments()
    await flush()

    queries[0].emit([{ _id: objectId } as unknown as Doc])
    queries[0].emit([])
    await flush()

    expect(client.remove).toHaveBeenCalledWith(tab)
    expect(client.update).not.toHaveBeenCalled()
    expect(get(tabsStore)).toEqual([unrelated])
    expect(get(tabIdStore)).toBe(unrelated._id)
    expect(navigate).not.toHaveBeenCalled()
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(queries[0].unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('replaces the final fragment-only tab when no underlying application view remains', async () => {
    application.locationDataResolver = undefined
    const tab = makeTab('document', 'workbench/workspace#panel|document|document-class')
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    unwatch = watchTabDocuments()
    await flush()

    queries[0].emit([{ _id: objectId } as unknown as Doc])
    queries[0].emit([])
    await flush()

    expect(client.remove).toHaveBeenCalledWith(tab)
    expect(client.update).not.toHaveBeenCalled()
    expect(client.createDoc).toHaveBeenCalledTimes(1)
    expect(get(tabIdStore)).toBe('new-tab')
    expect(navigate).toHaveBeenCalledWith({
      path: ['workbench', 'workspace', 'notification'],
      query: undefined,
      fragment: undefined
    })
  })

  it('closes an inactive tab when its document is deleted from another tab', async () => {
    const deletedTab = makeTab('deleted')
    const activeTab = makeTab('active', 'workbench/workspace/app/other')
    tabsStore.set([deletedTab, activeTab])
    tabIdStore.set(activeTab._id)
    unwatch = watchTabDocuments()
    await flush()

    expect(queries[0].query).toHaveBeenCalledWith(objectClass, { _id: objectId }, expect.any(Function))
    queries[0].emit([{ _id: objectId } as unknown as Doc])
    queries[0].emit([])
    await flush()

    expect(client.remove).toHaveBeenCalledWith(deletedTab)
    expect(get(tabsStore)).toEqual([activeTab])
    expect(get(tabIdStore)).toBe(activeTab._id)
    expect(navigate).not.toHaveBeenCalled()
    expect(queries[0].unsubscribe).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('uses active=%s at deletion time after switching tabs', async (active) => {
    resolver.mockImplementation(async (loc) => (loc.path.length === 3 ? { name: 'Home' } : documentData))
    const tab = makeTab('document')
    const other = makeTab('other')
    tabsStore.set([tab, other])
    tabIdStore.set(active ? other._id : tab._id)
    unwatch = watchTabDocuments()
    await flush()

    queries[0].emit([{ _id: objectId } as unknown as Doc])
    tabIdStore.set(active ? tab._id : other._id)
    queries[0].emit([])
    await flush()

    expect(get(tabIdStore)).toBe(active ? tab._id : other._id)
    if (active) {
      expect(client.update).toHaveBeenCalledWith(tab, { location: 'workbench/workspace/app', name: 'Home' })
      expect(get(tabsStore)).toEqual([{ ...tab, location: 'workbench/workspace/app', name: 'Home' }, other])
      expect(navigate).toHaveBeenCalledWith({ path: ['workbench', 'workspace', 'app'] })
      expect(client.remove).not.toHaveBeenCalled()
    } else {
      expect(client.remove).toHaveBeenCalledWith(tab)
      expect(get(tabsStore)).toEqual([other])
      expect(client.update).not.toHaveBeenCalled()
      expect(navigate).not.toHaveBeenCalled()
    }
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('ignores an initially missing document and closes only once after it disappears', async () => {
    tabsStore.set([makeTab('deleted'), makeTab('other')])
    unwatch = watchTabDocuments()
    await flush()
    queries[0].emit([])
    expect(client.remove).not.toHaveBeenCalled()
    queries[0].emit([{ _id: objectId } as unknown as Doc])
    queries[0].emit([])
    queries[0].emit([])
    await flush()
    expect(client.remove).toHaveBeenCalledTimes(1)
  })

  it('replaces a subscription on navigation and ignores callbacks for the previous location', async () => {
    const tab = makeTab('tab')
    tabsStore.set([tab, makeTab('other')])
    unwatch = watchTabDocuments()
    await flush()
    queries[0].emit([{ _id: objectId } as unknown as Doc])
    tabsStore.set([{ ...tab, location: 'workbench/workspace/app/next' }, makeTab('other')])
    await flush()
    expect(queries[0].unsubscribe).toHaveBeenCalledTimes(1)
    expect(queries).toHaveLength(3)
    queries[0].emit([])
    expect(client.remove).not.toHaveBeenCalled()
  })

  it('keeps subscriptions when only the cached tab name changes', async () => {
    const tab = makeTab('tab')
    tabsStore.set([tab])
    unwatch = watchTabDocuments()
    await flush()
    tabsStore.set([{ ...tab, name: 'Renamed' }])
    expect(queries).toHaveLength(1)
    expect(queries[0].unsubscribe).not.toHaveBeenCalled()
  })

  it('does not query application tabs without a document', async () => {
    resolver.mockResolvedValue({ name: 'App' })
    tabsStore.set([makeTab('app')])
    unwatch = watchTabDocuments()
    await flush()
    expect(queries[0].query).not.toHaveBeenCalled()
  })

  it('unsubscribes on destruction and ignores pending location resolution', async () => {
    let resolveLocation: (data: LocationData) => void = () => {}
    resolver.mockReturnValue(
      new Promise((resolve) => {
        resolveLocation = resolve
      })
    )
    tabsStore.set([makeTab('tab')])
    unwatch = watchTabDocuments()
    unwatch()
    resolveLocation(documentData)
    await flush()
    expect(queries[0].unsubscribe).toHaveBeenCalledTimes(1)
    expect(queries[0].query).not.toHaveBeenCalled()
    tabsStore.set([makeTab('new')])
    expect(queries).toHaveLength(1)
  })

  it('ignores pending fragment-free resolution after the tab navigates elsewhere', async () => {
    let resolvePath: (data: LocationData) => void = () => {}
    resolver.mockImplementation(async (loc) => {
      if (loc.fragment !== undefined) return documentData
      return await new Promise<LocationData>((resolve) => {
        resolvePath = resolve
      })
    })
    const tab = makeTab('panel', 'workbench/workspace/app/list#panel|document|document-class')
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    unwatch = watchTabDocuments()
    await flush()

    const nextTab = { ...tab, location: 'workbench/workspace/app/next' }
    tabsStore.set([nextTab])
    resolvePath({ name: 'List' })
    await flush()

    expect(queries[0].unsubscribe).toHaveBeenCalledTimes(1)
    expect(queries[0].query).not.toHaveBeenCalled()
    expect(get(tabsStore)).toEqual([nextTab])
    expect(client.update).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ignores pending app-root resolution after the tab navigates elsewhere', async () => {
    let resolveRoot: (data: LocationData) => void = () => {}
    resolver.mockImplementation(async (loc) => {
      if (loc.path.length > 3) return documentData
      return await new Promise<LocationData>((resolve) => {
        resolveRoot = resolve
      })
    })
    const tab = makeTab('document')
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    unwatch = watchTabDocuments()
    await flush()

    const nextTab: WorkbenchTab = { ...tab, location: 'workbench/workspace/app/next' }
    tabsStore.set([nextTab])
    resolveRoot({ name: 'Home' })
    await flush()

    expect(queries[0].unsubscribe).toHaveBeenCalledTimes(1)
    expect(queries[0].query).not.toHaveBeenCalled()
    expect(get(tabsStore)).toEqual([nextTab])
    expect(client.update).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('tab document resolution', () => {
  it('preserves the document identity returned by an application resolver', async () => {
    expect(await getTabDataByLocation({ path: ['workbench', 'workspace', 'app'] })).toMatchObject(documentData)
  })

  it('uses the resolved location to identify documents behind application routes', async () => {
    application.locationDataResolver = undefined
    application.locationResolver = jest.fn(async () => ({
      loc: { path: ['workbench', 'workspace', 'app'], fragment: 'panel|LINK-1|document-class' }
    }))
    expect(await getTabDataByLocation({ path: ['workbench', 'workspace', 'app', 'LINK-1'] })).toMatchObject({
      objectId,
      objectClass
    })
    expect(parseLinkId).toHaveBeenCalledWith([], 'LINK-1', objectClass)
  })

  it('resolves fragment link IDs even without a title provider', async () => {
    application.locationDataResolver = undefined
    const loc = { path: ['workbench', 'workspace', 'app'], fragment: 'panel|LINK-1|document-class' }
    expect(await getTabDataByLocation(loc)).toMatchObject({ objectId, objectClass })
    expect(parseLinkId).toHaveBeenCalledWith([], 'LINK-1', objectClass)
  })
})

describe('closing tabs', () => {
  it('selects the adjacent tab when the active document tab closes', async () => {
    const previous = makeTab('previous')
    const tab = makeTab('active')
    tabsStore.set([previous, tab])
    tabIdStore.set(tab._id)
    await closeTab(tab)
    expect(get(tabIdStore)).toBe(previous._id)
    expect(navigate).toHaveBeenCalledWith({ path: ['workbench', 'workspace', 'app', 'document'] })
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('opens a default tab before deleting the final tab, including a pinned tab', async () => {
    const tab = { ...makeTab('last'), isPinned: true }
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    await closeTab(tab)
    expect(client.createDoc).toHaveBeenCalledWith('tab', 'workspace', {
      attachedTo: 'account',
      location: 'workbench/workspace/notification',
      isPinned: false,
      name: 'Inbox'
    })
    expect(get(tabIdStore)).toBe('new-tab')
    expect(navigate).toHaveBeenCalledWith({ path: ['workbench', 'workspace', 'notification'] })
    expect(client.remove).toHaveBeenCalledWith(tab)
    expect(client.createDoc.mock.invocationCallOrder[0]).toBeLessThan(client.remove.mock.invocationCallOrder[0])
  })
})
