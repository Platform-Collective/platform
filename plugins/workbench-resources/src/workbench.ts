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
  type Ref
} from '@hcengineering/core'
import notification, { notificationId } from '@hcengineering/notification'
import { type Asset, getMetadata, getResource, type IntlString, setMetadata, translate } from '@hcengineering/platform'
import presentation, { configurationStore, createQuery, getClient, type LiveQuery } from '@hcengineering/presentation'
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
    await op.diffUpdate(tab, { location: url, name })
    await op.commit()
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

  if (tabs.length === 1) {
    await createTab()
  }

  tabsStore.update((tabs) => tabs.filter((t) => t._id !== tab._id))
  if (get(tabIdStore) === tab._id) {
    const newTab = tabs[index - 1] ?? tabs[index + 1]
    tabIdStore.set(newTab?._id)
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

interface TabDocumentQuery {
  location: string
  query: LiveQuery
}

/** Watch all tabs, including those without a rendered tab presenter. */
export function watchTabDocuments (): () => void {
  const queries = new Map<Ref<WorkbenchTab>, TabDocumentQuery>()
  const unsubscribe = tabsStore.subscribe((tabs) => {
    for (const [id, entry] of queries) {
      if (!tabs.some((tab) => tab._id === id && tab.location === entry.location)) {
        entry.query.unsubscribe()
        queries.delete(id)
      }
    }
    for (const tab of tabs) {
      if (queries.has(tab._id)) continue
      const entry = { location: tab.location, query: createQuery(true) }
      queries.set(tab._id, entry)
      void getTabDataByLocation(getTabLocation(tab))
        .then((data) => {
          if (queries.get(tab._id) !== entry || data.objectId === undefined || data.objectClass === undefined) return
          let existed = false
          entry.query.query(data.objectClass, { _id: data.objectId }, (docs) => {
            if (queries.get(tab._id) !== entry) return
            if (docs.length > 0) {
              existed = true
            } else if (existed) {
              existed = false
              void closeTab(tab).catch(console.error)
            }
          })
        })
        .catch(console.error)
    }
  })
  return () => {
    unsubscribe()
    for (const entry of queries.values()) entry.query.unsubscribe()
    queries.clear()
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
