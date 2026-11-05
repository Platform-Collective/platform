// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref, Tx } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import { addTxListener, createQuery, getClient, removeTxListener } from '@hcengineering/presentation'
import { getCurrentLocation, location as locationStore, navigate } from '@hcengineering/ui'
import type { Location } from '@hcengineering/ui'
import { parseLinkId } from '@hcengineering/view-resources'
import type { LocationData, WorkbenchTab } from '@hcengineering/workbench'
import { get, type Writable } from 'svelte/store'
import {
  currentTabStore,
  closeTab,
  getTabDataByLocation,
  getTabLocation,
  tabIdStore,
  tabsStore,
  watchTabDocuments
} from '../workbench'
import { locationWorkspaceStore } from '../utils'

jest.mock(
  '@hcengineering/core',
  () => ({
    __esModule: true,
    default: {
      space: { Workspace: 'workspace' },
      metadata: { DisablePermissions: 'permissions' },
      class: { TxRemoveDoc: 'core:class:TxRemoveDoc', TxApplyIf: 'core:class:TxApplyIf' }
    },
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
    createQuery: jest.fn(),
    addTxListener: jest.fn(),
    removeTxListener: jest.fn()
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
const workspaceStore = locationWorkspaceStore as Writable<string | undefined>
const testLocationStore = locationStore as Writable<Location>
const application = {
  alias: 'app',
  label: 'App',
  locationDataResolver: resolver as typeof resolver | undefined,
  locationResolver: undefined as jest.Mock | undefined
}
const client = {
  getModel: () => ({ findAllSync: (cls: string) => (cls === 'application' ? [application] : []) }),
  getHierarchy: () => ({ hasClass: (cls: string) => cls === objectClass, classHierarchyMixin: () => undefined }),
  createDoc: jest.fn(async () => 'new-tab'),
  update: jest.fn(async () => {}),
  apply: () => ({ diffUpdate: client.diffUpdate, commit: client.commit }),
  diffUpdate: jest.fn(async () => {}),
  commit: jest.fn(async () => {}),
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

const storage = {
  getItem: jest.fn<string | null, [string]>(() => null),
  setItem: jest.fn(),
  removeItem: jest.fn()
}

beforeAll(() => {
  // The shared mock snapshots derived stores. Keep this one live for location-sync assertions.
  Object.defineProperty(currentTabStore, '_getValue', {
    configurable: true,
    value: () => get(tabsStore).find((tab) => tab._id === get(tabIdStore))
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { protocol: 'https:', host: 'localhost' }, localStorage: storage }
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  })
})

beforeEach(() => {
  jest.clearAllMocks()
  queries.length = 0
  tabsStore.set([])
  workspaceStore.set(undefined)
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

describe('tabs of removed documents', () => {
  let unwatch: () => void
  let listener: ((txes: Tx[]) => void) | undefined

  beforeEach(() => {
    listener = undefined
    jest.mocked(addTxListener).mockImplementation((l) => {
      listener = l
    })
    unwatch = watchTabDocuments()
  })

  afterEach(() => {
    unwatch?.()
  })

  function removeDocs (...ids: string[]): void {
    must(listener)(ids.map((objectId) => ({ _class: 'core:class:TxRemoveDoc', objectId }) as unknown as Tx))
  }

  function must<T> (value: T | undefined): T {
    if (value === undefined) throw new Error('missing value')
    return value
  }

  async function resolveTab (tab: WorkbenchTab): Promise<void> {
    // The tab presenter resolves every tab; this remembers its document.
    await getTabDataByLocation(getTabLocation(tab))
  }

  it('makes no queries of its own: only locations resolved for the tab bar are matched', async () => {
    const tab = makeTab('background')
    const active = makeTab('active', 'workbench/workspace/app/other')
    tabsStore.set([tab, active])
    tabIdStore.set(active._id)
    await flush()

    expect(createQuery).not.toHaveBeenCalled()
    expect(resolver).not.toHaveBeenCalled()
    expect(addTxListener).toHaveBeenCalledTimes(1)

    removeDocs(objectId)
    await flush()
    expect(client.update).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
  })

  it('leaves background tabs in place, so other windows keep their tabs', async () => {
    const tab = makeTab('background')
    const active = makeTab('active', 'workbench/workspace/app/other')
    tabsStore.set([tab, active])
    tabIdStore.set(active._id)
    await resolveTab(tab)

    removeDocs(objectId)
    removeDocs(objectId)
    await flush()

    expect(client.remove).not.toHaveBeenCalled()
    expect(client.update).not.toHaveBeenCalled()
    expect(get(tabsStore)).toEqual([tab, active])
    expect(navigate).not.toHaveBeenCalled()
  })

  it('returns a background tab to its application when it is opened in this window', async () => {
    resolver.mockImplementation(async (loc) => (loc.path.length === 3 ? { name: 'Home' } : documentData))
    const tab = makeTab('background')
    const active = makeTab('active', 'workbench/workspace/app/other')
    tabsStore.set([tab, active])
    tabIdStore.set(active._id)
    await resolveTab(tab)
    removeDocs(objectId)
    await flush()

    tabIdStore.set(tab._id)
    await flush()

    expect(client.update).not.toHaveBeenCalled()
    expect(client.update).not.toHaveBeenCalled()
    expect(get(tabsStore)).toEqual([{ ...tab, location: 'workbench/workspace/app', name: 'Home' }, active])
    expect(navigate).toHaveBeenCalledWith({ path: ['workbench', 'workspace', 'app'] })
    expect(client.remove).not.toHaveBeenCalled()

    tabIdStore.set(active._id)
    tabIdStore.set(tab._id)
    await flush()
    expect(client.update).not.toHaveBeenCalled()
  })

  it('moves a background tab to its application as soon as it is selected, before the click navigates', async () => {
    resolver.mockImplementation(async (loc) => (loc.path.length === 3 ? { name: 'Home' } : documentData))
    const tab = makeTab('background')
    const active = makeTab('active', 'workbench/workspace/app/other')
    tabsStore.set([tab, active])
    tabIdStore.set(active._id)
    await resolveTab(tab)
    removeDocs(objectId)
    await flush()

    tabIdStore.set(tab._id)

    // The tab bar reads the tab location right after selecting it.
    expect(get(tabsStore).find((t) => t._id === tab._id)?.location).toBe('workbench/workspace/app')
  })

  it('strips a background panel synchronously when selecting it', async () => {
    resolver.mockResolvedValue(documentData)
    const tab = makeTab('background-panel', 'workbench/workspace/app/list#panel|document|document-class')
    const active = makeTab('active')
    tabsStore.set([tab, active])
    tabIdStore.set(active._id)
    await resolveTab(tab)
    removeDocs(objectId)

    tabIdStore.set(tab._id)

    expect(get(tabsStore).find((t) => t._id === tab._id)?.location).toBe('workbench/workspace/app/list')
  })

  it('re-reads the corrected adjacent tab when closing the active tab', async () => {
    resolver.mockImplementation(async (loc) => (loc.path.length === 3 ? { name: 'Home' } : documentData))
    const previous = makeTab('previous-removed')
    const active = makeTab('active')
    tabsStore.set([previous, active])
    tabIdStore.set(active._id)
    await resolveTab(previous)
    removeDocs(objectId)

    await closeTab(active)

    expect(navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        path: ['workbench', 'workspace', 'app', 'document']
      })
    )
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ path: ['workbench', 'workspace', 'app'] }))
  })

  it('does not override navigation while the destination title is loading', async () => {
    const tab = makeTab('slow-active')
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    jest.mocked(getCurrentLocation).mockReturnValue(getTabLocation(tab))
    await resolveTab(tab)
    let complete: (data: LocationData) => void = () => {}
    resolver.mockImplementation(
      async () =>
        await new Promise<LocationData>((resolve) => {
          complete = resolve
        })
    )

    removeDocs(objectId)
    await flush()
    const elsewhere = { path: ['workbench', 'workspace', 'app', 'elsewhere'] }
    jest.mocked(getCurrentLocation).mockReturnValue(elsewhere)
    tabsStore.set([{ ...tab, location: 'workbench/workspace/app/elsewhere' }])
    complete({ name: 'Home' })
    await flush()

    expect(navigate).not.toHaveBeenCalled()
    expect(client.update).not.toHaveBeenCalled()
    expect(get(tabsStore)[0].location).toBe('workbench/workspace/app/elsewhere')
  })

  it('does not change a background tab that moved to another location before it is opened', async () => {
    const tab = makeTab('background')
    const active = makeTab('active', 'workbench/workspace/app/other')
    tabsStore.set([tab, active])
    tabIdStore.set(active._id)
    await resolveTab(tab)
    removeDocs(objectId)
    tabsStore.set([{ ...tab, location: 'workbench/workspace/app/elsewhere' }, active])

    tabIdStore.set(tab._id)
    await flush()

    expect(client.update).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('returns the active tab to its application', async () => {
    resolver.mockImplementation(async (loc) => (loc.path.length === 3 ? { name: 'Home' } : documentData))
    const tab = makeTab('active')
    const other = makeTab('other', 'workbench/workspace/app/other')
    tabsStore.set([tab, other])
    tabIdStore.set(tab._id)
    jest.mocked(getCurrentLocation).mockReturnValue({ path: ['workbench', 'workspace', 'app', 'document'] })
    await getTabDataByLocation(getCurrentLocation())

    removeDocs(objectId)
    await flush()

    expect(client.update).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith({ path: ['workbench', 'workspace', 'app'] })
    expect(get(tabIdStore)).toBe(tab._id)
    expect(client.remove).not.toHaveBeenCalled()
    expect(client.createDoc).not.toHaveBeenCalled()
  })

  it('persists the active tab through location sync without an extra update', async () => {
    workspaceStore.set('workspace')
    const tab = makeTab('sync-active')
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    jest.mocked(getCurrentLocation).mockReturnValue(getTabLocation(tab))
    await resolveTab(tab)
    resolver.mockResolvedValue({ name: 'Home' })
    jest.mocked(navigate).mockImplementation((loc) => {
      jest.mocked(getCurrentLocation).mockReturnValue(loc)
      testLocationStore.set(loc)
      return true
    })

    removeDocs(objectId)
    await flush()

    expect(client.update).not.toHaveBeenCalled()
    expect(client.diffUpdate).toHaveBeenCalledTimes(1)
    expect(client.diffUpdate).toHaveBeenCalledWith(expect.objectContaining({ _id: tab._id }), {
      location: 'workbench/workspace/app',
      name: 'Home'
    })
    expect(client.commit).toHaveBeenCalledTimes(1)
    jest.mocked(navigate).mockReset()
  })

  it('keeps the list of the active tab when the document of its panel is removed', async () => {
    application.locationDataResolver = undefined
    const location = 'workbench/workspace/recruit/talents?filter=mine'
    const tab = makeTab('panel', `${location}#panel|LINK-1|document-class`)
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    const current: Location = {
      path: ['workbench', 'workspace', 'recruit', 'talents'],
      query: { filter: 'mine' },
      fragment: 'panel|LINK-1|document-class'
    }
    jest.mocked(getCurrentLocation).mockReturnValue(current)
    await getTabDataByLocation(current)
    jest.mocked(parseLinkId).mockRejectedValue(new Error('not found'))

    removeDocs(objectId)
    await flush()

    expect(client.update).not.toHaveBeenCalled()
    expect(get(tabsStore)[0]).toMatchObject({ location, name: 'App' })
    expect(navigate).toHaveBeenCalledWith({ ...current, fragment: undefined })
    expect(client.remove).not.toHaveBeenCalled()
  })

  it('keeps a different document in the path when the document of the panel is removed', async () => {
    const underlying = { objectId: 'underlying' as Ref<Doc>, objectClass, name: 'Underlying' }
    resolver.mockImplementation(async (loc) => (loc.fragment === undefined ? underlying : documentData))
    const location = 'workbench/workspace/app/underlying'
    const tab = makeTab('panel', `${location}#panel|document|document-class`)
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    const current = getTabLocation(tab)
    jest.mocked(getCurrentLocation).mockReturnValue(current)
    await getTabDataByLocation(current)

    removeDocs(objectId)
    await flush()

    expect(client.update).not.toHaveBeenCalled()
    expect(get(tabsStore)[0]).toMatchObject({ location, name: 'Underlying' })
    expect(navigate).toHaveBeenCalledWith({ ...current, fragment: undefined })
  })

  it('leaves pinned tabs untouched', async () => {
    const pinned = { ...makeTab('pinned'), isPinned: true }
    const background = { ...makeTab('pinned-background'), isPinned: true }
    tabsStore.set([pinned, background])
    tabIdStore.set(pinned._id)
    jest.mocked(getCurrentLocation).mockReturnValue(getTabLocation(pinned))
    await resolveTab(pinned)

    removeDocs(objectId)
    tabIdStore.set(background._id)
    await flush()

    expect(client.update).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('matches only the document a tab was opened for, not other ids in its location', async () => {
    resolver.mockResolvedValue({ name: 'Inbox' })
    const inbox = makeTab('inbox', `workbench/workspace/app/${objectId}?message=other-${objectId}#x|${objectId}|y`)
    tabsStore.set([inbox])
    tabIdStore.set(inbox._id)
    jest.mocked(getCurrentLocation).mockReturnValue(getTabLocation(inbox))
    await resolveTab(inbox)

    removeDocs(objectId)
    await flush()

    expect(client.update).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('forgets the remembered application location of the removed document', async () => {
    resolver.mockImplementation(async (loc) => (loc.path.length === 3 ? { name: 'Home' } : documentData))
    const tab = makeTab('active')
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    const current = { path: ['workbench', 'workspace', 'app', 'document'] }
    jest.mocked(getCurrentLocation).mockReturnValue(current)
    await getTabDataByLocation(current)
    // Opening the application restores its last location, which would lead back to the document.
    storage.getItem.mockImplementation((key) => (key === 'location_app' ? JSON.stringify(current) : null))

    removeDocs(objectId)
    await flush()

    expect(storage.removeItem).toHaveBeenCalledWith('location_app')
    expect(navigate).toHaveBeenCalledWith({ path: ['workbench', 'workspace', 'app'] })
  })

  it('keeps the remembered application location of another document', async () => {
    resolver.mockImplementation(async (loc) => (loc.path.length === 3 ? { name: 'Home' } : documentData))
    const tab = makeTab('active')
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    const current = { path: ['workbench', 'workspace', 'app', 'document'] }
    jest.mocked(getCurrentLocation).mockReturnValue(current)
    await getTabDataByLocation(current)
    const other = JSON.stringify({ path: ['workbench', 'workspace', 'app', 'other'] })
    storage.getItem.mockImplementation((key) => (key === 'location_app' ? other : null))

    removeDocs(objectId)
    await flush()

    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('sees removals made through apply()', async () => {
    resolver.mockImplementation(async (loc) => (loc.path.length === 3 ? { name: 'Home' } : documentData))
    const tab = makeTab('active')
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    jest.mocked(getCurrentLocation).mockReturnValue({ path: ['workbench', 'workspace', 'app', 'document'] })
    await getTabDataByLocation(getCurrentLocation())

    const inner = { _class: 'core:class:TxRemoveDoc', objectId }
    must(listener)([{ _class: 'core:class:TxApplyIf', txes: [inner] } as unknown as Tx])
    await flush()

    expect(client.update).not.toHaveBeenCalled()
  })

  it('stops listening when the workbench is destroyed', () => {
    unwatch()
    expect(removeTxListener).toHaveBeenCalledWith(listener)
  })
})

describe('tab document resolution', () => {
  it('preserves the document identity returned by an application resolver', async () => {
    expect(await getTabDataByLocation({ path: ['workbench', 'workspace', 'app'] })).toMatchObject(documentData)
  })

  it('identifies a panel when the application resolver only returns its view label', async () => {
    resolver.mockResolvedValue({ name: 'Inbox' })
    const loc = { path: ['workbench', 'workspace', 'app', 'list'], fragment: 'panel|LINK-1|document-class' }
    expect(await getTabDataByLocation(loc)).toMatchObject({ name: 'Inbox', objectId, objectClass })
    expect(parseLinkId).toHaveBeenCalledWith([], 'LINK-1', objectClass)
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

  it('does not open another tab when the final tab is closed', async () => {
    const tab = makeTab('last')
    tabsStore.set([tab])
    tabIdStore.set(tab._id)
    await closeTab(tab)
    expect(client.createDoc).not.toHaveBeenCalled()
    expect(client.remove).toHaveBeenCalledWith(tab)
  })
})
