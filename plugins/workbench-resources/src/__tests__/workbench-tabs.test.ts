// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import { createQuery, getClient } from '@hcengineering/presentation'
import { getCurrentLocation, navigate } from '@hcengineering/ui'
import type { Location } from '@hcengineering/ui'
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
    locationToUrl: (loc: Location) => loc.path.join('/') + (loc.fragment === undefined ? '' : `#${loc.fragment}`),
    parseLocation: (url: URL) => ({ path: url.pathname.slice(1).split('/'), fragment: url.hash.slice(1) || undefined }),
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
const documentData = { objectId, objectClass, name: 'Document' }
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
  remove: jest.fn(async () => {})
}

function makeTab (id: string, location = 'workbench/workspace/app/document'): WorkbenchTab {
  return { _id: id, location, isPinned: false } as unknown as WorkbenchTab
}

async function flush (): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
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
