//
// Copyright © 2024 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//
import core, {
  type Class,
  concatLink,
  type Doc,
  generateId,
  getCurrentAccount,
  reduceCalls,
  type Ref,
  type Tx,
  type TxApplyIf,
  type TxRemoveDoc
} from '@hcengineering/core'
import notification, { notificationId } from '@hcengineering/notification'
import { type Asset, getMetadata, getResource, type IntlString, setMetadata, translate } from '@hcengineering/platform'
import presentation, {
  addTxListener,
  configurationStore,
  getClient,
  removeTxListener
} from '@hcengineering/presentation'
import {
  type AnyComponent,
  getCurrentLocation,
  languageStore,
  type Location,
  locationStorageKeyId,
  location as locationStore,
  locationToUrl,
  navigate,
  parseLocation
} from '@hcengineering/ui'
import view from '@hcengineering/view'
import { parseLinkId } from '@hcengineering/view-resources'
import { type Application, type LocationData, workbenchId, type WorkbenchTab } from '@hcengineering/workbench'
import { derived, get, writable } from 'svelte/store'

import setting from '@hcengineering/setting'
import workbench from './plugin'
import { locationWorkspaceStore } from './utils'

export const tabIdStore = writable<Ref<WorkbenchTab> | undefined>()
export const prevTabIdStore = writable<Ref<WorkbenchTab> | undefined>()
export const tabsStore = writable<WorkbenchTab[]>([])
export const currentTabStore = derived([tabIdStore, tabsStore], ([tabId, tabs]) => {
  return tabs.find((tab) => tab._id === tabId)
})

let prevTabId: Ref<WorkbenchTab> | undefined
tabIdStore.subscribe((value) => {
  prevTabIdStore.set(prevTabId)
  prevTabId = value
  saveTabToLocalStorage(value)
})

locationWorkspaceStore.subscribe((workspace) => {
  tabIdStore.set(getTabFromLocalStorage(workspace ?? ''))
})

// Keep the persisted input for diffUpdate while a deletion correction is shown optimistically.
const optimisticTabSources = new Map<Ref<WorkbenchTab>, WorkbenchTab>()

const syncTabLoc = reduceCalls(async (): Promise<void> => {
  const loc = getCurrentLocation()
  const workspace = get(locationWorkspaceStore)
  if (workspace == null || workspace === '') return
  const tab = get(currentTabStore)
  if (tab == null) return
  const tabId = tab._id
  if (tabId == null || tab._id !== tabId) return
  const tabLoc = getTabLocation(tab)
  const tabWs = tabLoc.path[1]
  if (workspace !== tabWs) {
    return
  }
  if (loc.path[2] === '' || loc.path[2] == null) return

  const url = locationToUrl(loc)
  const data = await getTabDataByLocation(loc)
  const name = data.name ?? (await translate(data.label, {}, get(languageStore)))
  const tabByName = get(tabsStore).find((t) => {
    if (t.name !== name) return false

    const tabLoc = getTabLocation(t)
    if (tabLoc.path[2] !== loc.path[2]) return false
    if (tabLoc.path[2] === notificationId) return true

    return tabLoc.path[3] === loc.path[3]
  })

  if (tab.name !== undefined && name !== tab.name && tab.isPinned) {
    if (get(tabIdStore) !== tab._id) return
    if (tabByName !== undefined) {
      selectTab(tabByName._id)
      return
    }

    const me = getCurrentAccount()
    const newTab: WorkbenchTab = {
      _id: generateId(),
      _class: workbench.class.WorkbenchTab,
      space: core.space.Workspace,
      location: url,
      name,
      attachedTo: me.uuid,
      isPinned: false,
      modifiedOn: Date.now(),
      modifiedBy: me.primarySocialId
    }
    console.log('Creating new tab when pinned location changed', { newLocation: url, pinnedLocation: tab.location })
    await getClient().createDoc(workbench.class.WorkbenchTab, core.space.Workspace, newTab, newTab._id)
    tabsStore.update((tabs) => [...tabs, newTab])
    selectTab(newTab._id)
  } else {
    // TODO: Fix this
    // if (
    //   tabByName !== undefined &&
    //   tabByName._id !== tab._id &&
    //   (loc.path[2] !== tabLoc.path[2] || loc.path[3] !== tabLoc.path[3])
    // ) {
    //   selectTab(tabByName._id)
    //   return
    // }

    const op = getClient().apply(undefined, undefined, true)
    const source = optimisticTabSources.get(tab._id) ?? tab
    await op.diffUpdate(source, { location: url, name })
    await op.commit()
    // An older sync must leave the comparison available for the queued current location.
    if (optimisticTabSources.get(tab._id) === source && locationToUrl(getCurrentLocation()) === url) {
      optimisticTabSources.delete(tab._id)
    }
  }
})

locationStore.subscribe(() => {
  void syncTabLoc()
})

export function syncWorkbenchTab (): void {
  const workspace = get(locationWorkspaceStore)
  tabIdStore.set(getTabFromLocalStorage(workspace ?? ''))
}

function getTabIdLocalStorageKey (workspace: string): string | undefined {
  const me = getCurrentAccount()
  if (me == null || workspace === '') return undefined
  return `workbench.${workspace}.${me.uuid}.tab`
}

function getTabFromLocalStorage (workspace: string): Ref<WorkbenchTab> | undefined {
  const localStorageKey = getTabIdLocalStorageKey(workspace)
  if (localStorageKey === undefined) return undefined

  const tab = window.localStorage.getItem(localStorageKey)
  if (tab == null || tab === '') return undefined

  return tab as Ref<WorkbenchTab>
}

function saveTabToLocalStorage (_id: Ref<WorkbenchTab> | undefined): void {
  const workspace = get(locationWorkspaceStore)
  if (workspace == null || workspace === '') return

  const localStorageKey = getTabIdLocalStorageKey(workspace)
  if (localStorageKey === undefined) return
  window.localStorage.setItem(localStorageKey, _id ?? '')
}

export function selectTab (_id: Ref<WorkbenchTab>): void {
  tabIdStore.set(_id)
}

export function getTabLocation (tab: Pick<WorkbenchTab, 'location'>): Location {
  const base = `${window.location.protocol}//${window.location.host}`
  const front = getMetadata(presentation.metadata.FrontUrl) ?? base
  const url = new URL(concatLink(front, tab.location))

  return parseLocation(url)
}

export async function OpenInNewTab (loc: Location): Promise<void> {
  const client = getClient()
  const data = await getTabDataByLocation(loc)
  const name = data.name ?? (await translate(data.label, {}, get(languageStore)))
  const url = locationToUrl(loc)
  await client.createDoc(workbench.class.WorkbenchTab, core.space.Workspace, {
    attachedTo: getCurrentAccount().uuid,
    location: url,
    isPinned: false,
    name
  })
}

export async function closeTab (tab: WorkbenchTab): Promise<void> {
  const tabs = get(tabsStore)
  const index = tabs.findIndex((t) => t._id === tab._id)
  if (index === -1) return

  tabsStore.update((tabs) => tabs.filter((t) => t._id !== tab._id))
  if (get(tabIdStore) === tab._id) {
    let newTab: WorkbenchTab | undefined = tabs[index - 1] ?? tabs[index + 1]
    tabIdStore.set(newTab?._id)
    newTab = get(tabsStore).find((t) => t._id === newTab?._id)
    if (newTab !== undefined) {
      navigate(getTabLocation(newTab))
    }
  }

  const client = getClient()
  await client.remove(tab)
}

export async function closeCurrentTab (): Promise<void> {
  const tab = get(currentTabStore)
  if (tab == null) {
    return
  }
  if (canCloseTab(tab)) {
    await closeTab(tab)
  }
}

export async function createTab (): Promise<void> {
  const loc = getCurrentLocation()
  const client = getClient()
  let defaultUrl = `${workbenchId}/${loc.path[1]}/${notificationId}`

  try {
    const last = localStorage.getItem(`${locationStorageKeyId}_${notificationId}`)
    const lastLocation: Location | undefined = last != null ? JSON.parse(last) : undefined
    if (lastLocation != null && lastLocation.path[1] === loc.path[1] && lastLocation.path[2] === notificationId) {
      defaultUrl = locationToUrl(lastLocation)
    }
  } catch (e) {
    // ignore
  }

  const name = await translate(notification.string.Inbox, {}, get(languageStore))
  const tab = await client.createDoc(workbench.class.WorkbenchTab, core.space.Workspace, {
    attachedTo: getCurrentAccount().uuid,
    location: defaultUrl,
    isPinned: false,
    name
  })

  selectTab(tab)
  navigate(getTabLocation({ location: defaultUrl }))
}

export function canCloseTab (tab: WorkbenchTab): boolean {
  const tabs = get(tabsStore)
  return tabs.length > 1 && tabs.some((t) => t._id === tab._id)
}

export async function pinTab (tab: WorkbenchTab): Promise<void> {
  const client = getClient()
  await client.update(tab, { isPinned: true })
}

export async function unpinTab (tab: WorkbenchTab): Promise<void> {
  const client = getClient()
  await client.update(tab, { isPinned: false })
}

// Documents opened by tab locations, remembered whenever a location is resolved for the
// tab bar or the location sync. Matching removals against them needs no extra queries.
const tabDocuments = new Map<string, Ref<Doc>>()
const maxTabDocuments = 200

// Tabs of this window whose document was removed while they were in the background:
// they are only changed once this window shows them again.
const removedTabDocuments = new Map<Ref<WorkbenchTab>, { location: string, objectId: Ref<Doc> }>()

function rememberTabDocument (loc: Location, objectId: Ref<Doc> | undefined): void {
  // Keep the last known identity when the resolver stops finding a deleted document.
  if (objectId === undefined) return
  const url = locationToUrl(loc)
  tabDocuments.set(url, objectId)
  if (tabDocuments.size <= maxTabDocuments) return
  const used = new Set(get(tabsStore).map((tab) => locationToUrl(getTabLocation(tab))))
  used.add(locationToUrl(getCurrentLocation()))
  for (const key of tabDocuments.keys()) {
    if (!used.has(key)) tabDocuments.delete(key)
  }
}

async function getLocationWithoutDocument (loc: Location, objectId: Ref<Doc>): Promise<Location> {
  if (loc.fragment != null && loc.fragment !== '' && loc.path[2] != null && loc.path[2] !== '') {
    // The document is open in a panel: keep the view below it unless that shows the same document.
    const location: Location = { ...loc, fragment: undefined }
    const known = tabDocuments.get(locationToUrl(location))
    const below =
      loc.path[3] === objectId
        ? objectId
        : (known ?? (await getTabDataByLocation(location).catch((): undefined => undefined))?.objectId)
    if (below !== objectId) return location
  }
  return getApplicationLocation(loc)
}

function getApplicationLocation (loc: Location): Location {
  if (loc.path[2] == null || loc.path[2] === '') {
    return { path: [workbenchId, loc.path[1], notificationId] }
  }
  return { path: loc.path.slice(0, 3) }
}

// Opening an application restores its last location, which may still be the removed document.
function forgetApplicationLocation (loc: Location): void {
  const app = loc.path[2]
  if (app == null || app === '' || loc.path[3] == null) return
  const key = `${locationStorageKeyId}_${app}`
  try {
    const last = localStorage.getItem(key)
    const stored: Location | undefined = last != null ? JSON.parse(last) : undefined
    if (stored?.path?.[1] === loc.path[1] && stored?.path?.[3] === loc.path[3]) {
      localStorage.removeItem(key)
    }
  } catch {
    // ignore unreadable entries
  }
}

/** Move a tab shown in this window away from its removed document. */
async function leaveRemovedDocument (
  tab: WorkbenchTab,
  loc: Location,
  objectId: Ref<Doc>,
  expectedLocation = loc
): Promise<void> {
  const currentUrl = locationToUrl(getCurrentLocation())
  const expectedUrl = locationToUrl(expectedLocation)
  const tabLocation = get(tabsStore).find((t) => t._id === tab._id)?.location
  const target = await getLocationWithoutDocument(loc, objectId)
  const data = await getTabDataByLocation(target)
  const name = data.name ?? (await translate(data.label, {}, get(languageStore)))
  // A location resolver or title provider can finish after the user has moved on.
  const shownUrl = locationToUrl(getCurrentLocation())
  const currentTab = get(tabsStore).find((t) => t._id === tab._id)
  if (get(tabIdStore) !== tab._id || currentTab?.isPinned !== false || currentTab.location !== tabLocation) return
  if (shownUrl !== currentUrl && shownUrl !== expectedUrl) return
  if (target.path.length <= 3) forgetApplicationLocation(loc)
  const location = locationToUrl(target)
  if (!optimisticTabSources.has(tab._id)) optimisticTabSources.set(tab._id, tab)
  tabsStore.update((tabs) => tabs.map((t) => (t._id === tab._id ? { ...t, location, name } : t)))
  if (get(tabIdStore) === tab._id && !navigate(target)) {
    // Selecting another tab can keep the same URL, so no location event is emitted.
    void syncTabLoc()
  }
  // The location event, or the explicit sync above, persists the active tab's location and name.
}

function onRemovedDocuments (removed: Set<Ref<Doc>>): void {
  const currentTabId = get(tabIdStore)
  for (const tab of get(tabsStore)) {
    if (tab.isPinned) continue
    const active = tab._id === currentTabId
    const loc = active ? getCurrentLocation() : getTabLocation(tab)
    const objectId = tabDocuments.get(locationToUrl(loc))
    if (objectId === undefined || !removed.has(objectId)) continue
    if (active) {
      void leaveRemovedDocument(tab, loc, objectId).catch(console.error)
    } else {
      removedTabDocuments.set(tab._id, { location: tab.location, objectId })
    }
  }
}

function onTabShown (tabId: Ref<WorkbenchTab> | undefined): void {
  if (tabId === undefined) return
  const removed = removedTabDocuments.get(tabId)
  if (removed === undefined) return
  removedTabDocuments.delete(tabId)
  const tab = get(tabsStore).find((t) => t._id === tabId)
  // Another window may have moved the tab already.
  if (tab === undefined || tab.isPinned || tab.location !== removed.location) return
  const loc = getTabLocation(tab)
  // Move synchronously before the tab bar or closeTab reads the destination.
  const target =
    loc.fragment != null && loc.fragment !== '' ? { ...loc, fragment: undefined } : getApplicationLocation(loc)
  if (target.path.length <= 3) forgetApplicationLocation(loc)
  if (!optimisticTabSources.has(tab._id)) optimisticTabSources.set(tab._id, tab)
  tabsStore.update((tabs) => tabs.map((t) => (t._id === tab._id ? { ...t, location: locationToUrl(target) } : t)))
  void leaveRemovedDocument(tab, loc, removed.objectId, target).catch(console.error)
}

/**
 * Handle tabs whose document is removed, e.g. from another tab or by another user.
 * Tabs are stored per account and shared by all windows, so a window only changes a tab
 * it shows: the active tab right away, a background tab once it is opened here. Such a
 * tab returns to the view it was opened from instead of being deleted, and pinned tabs
 * are left alone, so a pinned location can still point at a deleted document.
 */
export function watchTabDocuments (): () => void {
  const listener = (txes: Tx[]): void => {
    const removed = new Set<Ref<Doc>>()
    const collect = (tx: Tx): void => {
      if (tx._class === core.class.TxRemoveDoc) removed.add((tx as TxRemoveDoc<Doc>).objectId)
      // Deletions made through apply() arrive wrapped.
      if (tx._class === core.class.TxApplyIf) (tx as TxApplyIf).txes.forEach(collect)
    }
    txes.forEach(collect)
    if (removed.size > 0) onRemovedDocuments(removed)
  }
  addTxListener(listener)
  const unsubscribe = tabIdStore.subscribe(onTabShown)
  return () => {
    removeTxListener(listener)
    unsubscribe()
    removedTabDocuments.clear()
    optimisticTabSources.clear()
  }
}

export async function getTabDataByLocation (loc: Location): Promise<{
  objectId?: Ref<Doc>
  objectClass?: Ref<Class<Doc>>
  name?: string
  label: IntlString
  icon?: Asset
  iconComponent?: AnyComponent
  iconProps?: Record<string, any>
}> {
  const client = getClient()
  const appAlias = loc.path[2]
  const application = client.getModel().findAllSync<Application>(workbench.class.Application, { alias: appAlias })[0]

  let name: string | undefined
  let label: IntlString | undefined
  let icon: Asset | undefined
  let iconComponent: AnyComponent | undefined
  let iconProps: Record<string, any> | undefined
  let objectId: Ref<Doc> | undefined
  let objectClass: Ref<Class<Doc>> | undefined

  if (application?.locationDataResolver != null) {
    const resolver = await getResource(application.locationDataResolver)
    const data = await resolver(loc)
    objectId = data.objectId
    objectClass = data.objectClass
    if (loc.fragment != null && loc.fragment !== '') {
      const panel = await getDefaultTabData(loc)
      if (panel.objectId !== undefined) {
        objectId = panel.objectId
        objectClass = panel.objectClass
      }
    }
    name = data.name
    label = data.nameIntl ?? application.label ?? workbench.string.Tab
    iconComponent = data.iconComponent
    icon = data.icon ?? application.icon
    iconProps = data.iconProps
  } else {
    const special = loc.path[3]
    const specialLabel = application?.navigatorModel?.specials?.find((s) => s.id === special)?.label
    const resolvedLoc = await getResolvedLocation(loc, application)
    const data = await getDefaultTabData(resolvedLoc)
    name = data.name
    objectId = data.objectId
    objectClass = data.objectClass
    label = specialLabel ?? application?.label ?? workbench.string.Tab
    icon = application?.icon
  }

  rememberTabDocument(loc, objectId)
  return { name, label, icon, iconComponent, iconProps, objectId, objectClass }
}

async function getResolvedLocation (loc: Location, app?: Application): Promise<Location> {
  if (app?.locationResolver === undefined) return loc

  const resolver = await getResource(app.locationResolver)
  return (await resolver(loc))?.loc ?? loc
}

async function getDefaultTabData (loc: Location): Promise<LocationData> {
  if (loc.fragment == null) return {}
  const client = getClient()
  const hierarchy = client.getHierarchy()
  const [, id, _class] = decodeURIComponent(loc.fragment).split('|')
  if (_class == null || !hierarchy.hasClass(_class as Ref<Class<Doc>>)) return {}

  const mixin = hierarchy.classHierarchyMixin(_class as Ref<Class<Doc>>, view.mixin.ObjectTitle)
  try {
    const linkProviders = client.getModel().findAllSync(view.mixin.LinkIdProvider, {})
    const _id = await parseLinkId(linkProviders, id, _class as Ref<Class<Doc>>)
    const titleProvider = mixin === undefined ? undefined : await getResource(mixin.titleProvider)
    const name = await titleProvider?.(client, _id)
    return { name, objectId: _id, objectClass: _class as Ref<Class<Doc>> }
  } catch (err: any) {
    console.error(err)
  }
  return {}
}

configurationStore.subscribe((config) => {
  const arePermissionsDisabled = config.get(setting.ids.DisablePermissionsConfiguration)?.enabled ?? false
  setMetadata(core.metadata.DisablePermissions, arePermissionsDisabled)
})
