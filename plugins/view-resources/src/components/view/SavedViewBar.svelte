<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import core, { Class, Doc, getCurrentAccount, Ref, Space, WithLookup } from '@hcengineering/core'
  import { getMetadata, translate } from '@hcengineering/platform'
  import presentation, { copyTextToClipboard, createQuery, getClient, MessageBox } from '@hcengineering/presentation'
  import {
    Action,
    addNotification,
    Button,
    getCurrentResolvedLocation,
    Icon,
    IconAdd,
    locationToUrl,
    Menu,
    NotificationSeverity,
    eventToHTMLElement,
    resolvedLocationStore,
    showPopup,
    themeStore,
    tooltip
  } from '@hcengineering/ui'
  import view, {
    BuildModelKey,
    FilteredView,
    ViewOptions,
    Viewlet,
    ViewletDescriptor,
    ViewletPreference
  } from '@hcengineering/view'
  import { onDestroy } from 'svelte'
  import { Writable, writable } from 'svelte/store'
  import { filterStore, setFilters } from '../../filter'
  import viewPlugin from '../../plugin'
  import {
    compareViews,
    DEFAULT_VIEW_ID,
    duplicateViewName,
    getEffectiveViewConfig,
    isViewDirty,
    nextOrder,
    nextViewName,
    orderForMove,
    parseStoredFilters,
    viewFromLink,
    viewIdFromQuery,
    viewLinkQuery,
    type ViewColumns,
    type ViewConfigLayer
  } from '../../savedViews'
  import { restrictionStore, setActiveViewletId } from '../../utils'
  import { getViewletDefaultOptions, getViewOptions, setViewOptions, viewOptionStore } from '../../viewOptions'
  import EditBoxPopup from '../EditBoxPopup.svelte'
  import SimpleNotification from '../SimpleNotification.svelte'

  export let space: Ref<Space>
  export let _class: Ref<Class<Doc>>
  // The viewlet that is displayed right now
  export let viewlet: WithLookup<Viewlet> | undefined
  export let viewletQuery: Record<string, any>
  // Descriptors the user can choose from as view layout (e.g. Table and Board)
  export let layouts: Array<Ref<ViewletDescriptor>>
  // Host specific filter state that is saved with the view (e.g. custom field filters)
  export let extra: Writable<any[]> | undefined = undefined
  // GitHub-style filter string of the view (bind it); saved with the view and part of its unsaved-changes state
  export let filterQuery: string = ''
  // Columns of the active view; undefined until it is known
  export let config: ViewColumns | undefined = undefined
  // Id of the active view (bind it), e.g. to keep per-view state of the viewer
  export let activeViewId: string | undefined = undefined
  // View options a new view of the layout starts with, on top of the defaults of the layout
  export let newViewOptions: ((layout: WithLookup<Viewlet>) => Partial<ViewOptions> | undefined) | undefined = undefined
  // Further entries of the menu of a view tab, for what only the host can do with the view (e.g. export its data)
  export let tabActions: ((tab: { id: string, name: string, active: boolean }) => Action[]) | undefined = undefined

  const client = getClient()
  const noExtra = writable<any[]>([])
  $: extraStore = extra ?? noExtra

  interface Tab {
    _id: string
    name: string
    doc?: FilteredView
  }

  // ---- data ----
  const viewsQuery = createQuery()
  const viewletsQuery = createQuery()
  const preferenceQuery = createQuery()

  let storedViews: FilteredView[] = []
  let viewsLoaded = false
  let viewlets: Array<WithLookup<Viewlet>> = []
  let preference: ViewletPreference | undefined

  $: viewsQuery.query(view.class.FilteredView, { project: space }, (res) => {
    storedViews = res
    viewsLoaded = true
  })
  $: viewletsQuery.query(
    view.class.Viewlet,
    viewletQuery,
    (res) => {
      viewlets = res
    },
    { lookup: { descriptor: view.class.ViewletDescriptor } }
  )
  // Viewlet the loaded preference belongs to; columns are reported only for a consistent state
  let preferenceFor: Ref<Viewlet> | undefined
  $: if (viewlet !== undefined) {
    const viewletId = viewlet._id
    preferenceQuery.query(
      view.class.ViewletPreference,
      { space: core.space.Workspace, attachedTo: viewletId },
      (res) => {
        preference = res[0]
        preferenceFor = viewletId
      },
      { limit: 1 }
    )
  } else {
    preferenceQuery.unsubscribe()
    preference = undefined
    preferenceFor = undefined
  }

  $: layoutViewlets = viewlets.filter((it) => layouts.includes(it.descriptor))
  $: sortedViews = [...storedViews].sort((a, b) => compareViews(a, b))

  let defaultPrefix = 'View'
  $: void translate(viewPlugin.string.SavedViewDefaultName, {}, $themeStore.language).then((res) => {
    defaultPrefix = res
  })

  // A project without saved views shows one default view; it is stored when it is changed and saved
  $: tabs = ((): Tab[] => {
    if (!viewsLoaded) return []
    if (sortedViews.length > 0) return sortedViews.map((doc) => ({ _id: doc._id, name: doc.name, doc }))
    return [{ _id: DEFAULT_VIEW_ID, name: `${defaultPrefix} 1` }]
  })()

  // ---- active view ----
  const activeKey = (): string => `savedViews.active.${space}`
  function loadActive (): string | undefined {
    try {
      return localStorage.getItem(activeKey()) ?? undefined
    } catch {
      return undefined
    }
  }
  function storeActive (id: string): void {
    try {
      localStorage.setItem(activeKey(), id)
    } catch {
      // Storage can be unavailable; the choice then only lives for the session
    }
  }

  let activeId: string | undefined = loadActive()
  // A view that was just created becomes known to the live query a moment later
  let awaitingId: string | undefined
  $: found = tabs.find((it) => it._id === activeId)
  $: if (found !== undefined && awaitingId === activeId) awaitingId = undefined
  $: activeTab = found ?? (awaitingId !== undefined ? undefined : tabs[0])
  $: activeViewId = activeTab?._id

  // A link to a view (`?view=<id>`) selects that view, on load and whenever the link changes. A link to a view this
  // project does not have (deleted, or the query survived a switch of the project) is ignored.
  $: linkedId = viewIdFromQuery($resolvedLocationStore.query)
  let appliedLinkId: string | undefined
  $: if (viewsLoaded && linkedId !== undefined && linkedId !== appliedLinkId) {
    appliedLinkId = linkedId
    const linked = viewFromLink($resolvedLocationStore.query, tabs)
    if (linked !== undefined && linked._id !== activeTab?._id) select(linked)
  }

  // Unsaved column edits of the active view
  let localConfig: { viewletId: string, config: ViewColumns } | undefined
  let appliedId: string | undefined
  let baseline: ViewConfigLayer | undefined
  let baselineWait: string | null | undefined // layout the baseline waits for; null = any

  function savedLayer (doc: FilteredView | undefined): ViewConfigLayer {
    return {
      viewletId: doc?.viewletId ?? undefined,
      filters: doc?.filters,
      viewOptions: doc?.viewOptions,
      config: doc?.config,
      extra: doc?.extra,
      filterQuery: doc?.filterQuery
    }
  }

  function clone<T> (value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value))
  }

  // Options of a view that starts with the layout: its defaults and what the host adds for new views
  function startOptions (layout: WithLookup<Viewlet>): ViewOptions {
    return { ...clone(getViewletDefaultOptions(layout)), ...(newViewOptions?.(layout) ?? {}) }
  }

  // Puts the stores that drive the view into the state of the layer
  function restore (layer: ViewConfigLayer, hasState: boolean): void {
    localConfig = undefined
    baselineWait = layer.viewletId ?? null
    if (!hasState) return
    if (layer.viewletId != null) setActiveViewletId(layer.viewletId as Ref<Viewlet>)
    const target = viewlets.find((it) => it._id === layer.viewletId) ?? viewlet
    if (layer.viewOptions !== undefined && target !== undefined) setViewOptions(target, clone(layer.viewOptions))
    setFilters(parseStoredFilters(layer.filters))
    extraStore.set(parseStoredFilters(layer.extra))
    filterQuery = layer.filterQuery ?? ''
  }

  function apply (tab: Tab): void {
    appliedId = tab._id
    baseline = undefined
    restore(savedLayer(tab.doc), tab.doc !== undefined)
  }

  // Views are applied only once the layouts are known, so that a saved layout can be resolved
  $: if (activeTab !== undefined && viewlets.length > 0 && appliedId !== activeTab._id) apply(activeTab)

  function select (tab: Tab): void {
    activeId = tab._id
    storeActive(tab._id)
  }

  // ---- current state, dirty detection ----
  $: currentOptions =
    viewlet !== undefined ? getViewOptions(viewlet, $viewOptionStore, getViewletDefaultOptions(viewlet)) : undefined

  $: effective = getEffectiveViewConfig({
    defaults: { config: viewlet?.config },
    preference: preference?.config,
    saved: savedLayer(activeTab?.doc),
    local: localConfig !== undefined ? { viewletId: localConfig.viewletId, config: localConfig.config } : undefined,
    currentViewletId: viewlet?._id
  })
  $: config = preferenceFor !== undefined && preferenceFor === viewlet?._id ? effective.config : undefined

  $: current = {
    viewletId: viewlet?._id,
    filters: JSON.stringify($filterStore),
    viewOptions: currentOptions as ViewOptions | undefined,
    config: effective.config,
    extra: JSON.stringify($extraStore),
    filterQuery
  } satisfies ViewConfigLayer

  // The baseline is taken once the view is applied and the displayed layout has caught up
  $: if (
    baseline === undefined &&
    appliedId !== undefined &&
    viewlet !== undefined &&
    currentOptions !== undefined &&
    baselineWait !== undefined &&
    (baselineWait === null || baselineWait === viewlet._id)
  ) {
    baseline = clone(current)
  }

  $: dirty = baseline !== undefined && isViewDirty(baseline, current)

  // ---- persistence ----
  function currentData (): Omit<
    FilteredView,
    keyof Doc | 'name' | 'users' | 'createdBy' | 'attachedTo' | 'location' | 'project'
  > {
    return {
      filters: current.filters,
      viewOptions: clone(current.viewOptions),
      filterClass: _class,
      viewletId: current.viewletId as Ref<Viewlet> | undefined,
      sharable: true,
      config: clone(current.config) ?? [],
      extra: current.extra,
      filterQuery: current.filterQuery
    }
  }

  async function createView (
    name: string,
    data: ReturnType<typeof currentData>,
    order: number
  ): Promise<Ref<FilteredView>> {
    const loc = getCurrentResolvedLocation()
    loc.fragment = undefined
    return await client.createDoc(view.class.FilteredView, space, {
      ...data,
      name,
      location: loc,
      attachedTo: space,
      project: space,
      order,
      users: [getCurrentAccount().uuid]
    })
  }

  // Makes a freshly created view the active one; it is applied as soon as the live query delivers it
  function activateCreated (id: Ref<FilteredView>): void {
    awaitingId = id
    activeId = id
    storeActive(id)
    appliedId = undefined
    baseline = undefined
  }

  // Makes sure the tab is a stored view; the default view is stored on demand
  async function ensureStored (tab: Tab): Promise<FilteredView | undefined> {
    if (tab.doc !== undefined) return tab.doc
    const id = await createView(tab.name, currentData(), 0)
    activateCreated(id)
    return await client.findOne(view.class.FilteredView, { _id: id })
  }

  async function saveChanges (): Promise<void> {
    if (activeTab === undefined || !dirty) return
    if (activeTab.doc === undefined) {
      await ensureStored(activeTab)
      return
    }
    await client.update(activeTab.doc, currentData())
    baseline = clone(current)
    localConfig = undefined
  }

  async function saveAsNew (): Promise<void> {
    const name = nextViewName(
      sortedViews.map((it) => it.name),
      defaultPrefix
    )
    const base = sortedViews.length > 0 ? nextOrder(sortedViews) : 1
    activateCreated(await createView(name, currentData(), base))
  }

  function discard (): void {
    if (baseline === undefined) return
    const layer = baseline
    baseline = undefined
    restore(layer, true)
  }

  async function newView (viewletId: Ref<Viewlet>): Promise<void> {
    const target = viewlets.find((it) => it._id === viewletId)
    if (target === undefined) return
    const name = nextViewName(
      tabs.map((it) => it.name),
      defaultPrefix
    )
    // A project showing only the unsaved default view stores it first, so that it is not lost
    if (activeTab?.doc === undefined && activeTab !== undefined && dirty) await ensureStored(activeTab)
    const order = sortedViews.length > 0 ? nextOrder(sortedViews) : 1
    const id = await createView(
      name,
      {
        filters: '[]',
        viewOptions: startOptions(target),
        filterClass: _class,
        viewletId,
        sharable: true,
        config: [],
        extra: '[]',
        filterQuery: ''
      },
      order
    )
    activateCreated(id)
  }

  async function duplicate (tab: Tab): Promise<void> {
    const source = tab.doc
    const name = duplicateViewName(
      tab.name,
      tabs.map((it) => it.name)
    )
    const order = nextOrder(sortedViews)
    activateCreated(await createView(name, source !== undefined ? savedData(source) : currentData(), order))
  }

  function savedData (doc: FilteredView): ReturnType<typeof currentData> {
    return {
      filters: doc.filters,
      viewOptions: clone(doc.viewOptions),
      filterClass: doc.filterClass,
      viewletId: doc.viewletId,
      sharable: true,
      config: clone(doc.config) ?? [],
      extra: doc.extra,
      filterQuery: doc.filterQuery
    }
  }

  async function rename (tab: Tab, name: string): Promise<void> {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed === tab.name) return
    const doc = await ensureStored(tab)
    if (doc !== undefined) await client.update(doc, { name: trimmed })
  }

  async function changeLayout (tab: Tab, target: WithLookup<Viewlet>): Promise<void> {
    const doc = await ensureStored(tab)
    if (doc === undefined) return
    // Columns and view options belong to a layout, so the new layout starts from its defaults
    const update = {
      viewletId: target._id,
      viewOptions: startOptions(target),
      config: []
    }
    await client.update(doc, update)
    if (activeTab?._id === tab._id) {
      apply({ ...tab, doc: { ...doc, ...update } })
    }
  }

  function remove (tab: Tab): void {
    const doc = tab.doc
    if (doc === undefined) return
    showPopup(MessageBox, {
      label: viewPlugin.string.SavedViewDelete,
      message: viewPlugin.string.SavedViewDeleteConfirm,
      params: { name: tab.name },
      action: async () => {
        if (activeId === tab._id) {
          const next = tabs.find((it) => it._id !== tab._id)
          activeId = next?._id
          if (next !== undefined) storeActive(next._id)
        }
        await client.remove(doc)
      }
    })
  }

  // ---- column edits (from the configure columns popup) ----
  /** Records the column edits of the active view as unsaved local changes */
  export function setLocalConfig (columns: Array<BuildModelKey | string>): void {
    if (viewlet === undefined) return
    localConfig = { viewletId: viewlet._id, config: columns }
  }

  // ---- link to a view ----
  async function copyViewLink (tab: Tab): Promise<void> {
    const loc = getCurrentResolvedLocation()
    // A view that is not stored yet (the default one) is the project itself
    loc.query = viewLinkQuery(tab.doc !== undefined ? tab._id : undefined)
    loc.fragment = undefined
    const origin = getMetadata(presentation.metadata.FrontUrl) ?? window.location.origin
    await copyTextToClipboard(`${origin}${locationToUrl(loc)}`)
    addNotification(
      await translate(view.string.Copied, {}, $themeStore.language),
      await translate(viewPlugin.string.SavedViewLinkCopied, {}, $themeStore.language),
      SimpleNotification,
      undefined,
      NotificationSeverity.Success
    )
  }

  /** Copies the link to the active view, for the menu of the host (the same as the entry of the tab menu) */
  export async function copyActiveViewLink (): Promise<void> {
    if (activeTab !== undefined) await copyViewLink(activeTab)
  }

  /** Name of the active view, e.g. for the name of an export */
  export function getActiveViewName (): string {
    return activeTab?.name ?? ''
  }

  // ---- menus ----
  async function layoutLabel (vl: WithLookup<Viewlet>): Promise<string> {
    const label =
      vl.descriptor === view.viewlet.List
        ? viewPlugin.string.SavedViewLayoutTable
        : (vl.$lookup?.descriptor?.label ?? viewPlugin.string.SavedViewLayoutTable)
    return await translate(label, {}, $themeStore.language)
  }

  async function showNewViewMenu (ev: MouseEvent): Promise<void> {
    const actions: Action[] = []
    for (const vl of layoutViewlets) {
      actions.push({
        label: viewPlugin.string.SavedViewLayoutTo,
        labelParams: { layout: await layoutLabel(vl) },
        icon: vl.$lookup?.descriptor?.icon,
        action: async () => {
          await newView(vl._id)
        }
      })
    }
    showPopup(Menu, { actions }, eventToHTMLElement(ev))
  }

  async function showTabMenu (ev: MouseEvent, tab: Tab): Promise<void> {
    const el = eventToHTMLElement(ev)
    const isActive = activeTab?._id === tab._id
    const actions: Action[] = [
      {
        label: view.string.Rename,
        icon: view.icon.Edit,
        action: async () => {
          showPopup(
            EditBoxPopup,
            { value: tab.name, format: 'text', placeholder: view.string.FilteredViewName },
            el,
            async (res) => {
              if (typeof res === 'string') await rename(tab, res)
            }
          )
        }
      },
      {
        label: viewPlugin.string.SavedViewDuplicate,
        icon: view.icon.Copy,
        action: async () => {
          await duplicate(tab)
        }
      },
      {
        label: viewPlugin.string.SavedViewCopyLink,
        icon: view.icon.CopyLink,
        group: 'share',
        action: async () => {
          await copyViewLink(tab)
        }
      },
      ...(tabActions?.({ id: tab._id, name: tab.name, active: isActive }) ?? [])
    ]
    const currentLayout = tab.doc?.viewletId ?? (isActive ? viewlet?._id : undefined)
    for (const vl of layoutViewlets) {
      if (vl._id === currentLayout) continue
      actions.push({
        label: viewPlugin.string.SavedViewLayoutTo,
        labelParams: { layout: await layoutLabel(vl) },
        icon: vl.$lookup?.descriptor?.icon,
        group: 'layout',
        action: async () => {
          await changeLayout(tab, vl)
        }
      })
    }
    if (isActive && dirty) {
      actions.push(
        {
          label: viewPlugin.string.SavedViewSave,
          group: 'save',
          action: async () => {
            await saveChanges()
          }
        },
        {
          label: viewPlugin.string.SavedViewSaveAsNew,
          icon: view.icon.Add,
          group: 'save',
          action: async () => {
            await saveAsNew()
          }
        }
      )
    }
    if (tab.doc !== undefined) {
      actions.push({
        label: viewPlugin.string.SavedViewDelete,
        icon: view.icon.Delete,
        group: 'remove',
        action: async () => {
          remove(tab)
        }
      })
    }
    showPopup(Menu, { actions }, el)
  }

  // ---- drag to reorder ----
  let dragId: string | undefined
  let dropIndex: number | undefined

  function onDragStart (ev: DragEvent, tab: Tab): void {
    if (tab.doc === undefined || $restrictionStore.readonly) {
      ev.preventDefault()
      return
    }
    dragId = tab._id
    ev.dataTransfer?.setData('text/plain', tab._id)
    if (ev.dataTransfer != null) ev.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver (ev: DragEvent, index: number): void {
    if (dragId === undefined) return
    ev.preventDefault()
    dropIndex = index
  }

  async function onDrop (ev: DragEvent): Promise<void> {
    ev.preventDefault()
    const id = dragId
    const index = dropIndex
    dragId = undefined
    dropIndex = undefined
    if (id === undefined || index === undefined) return
    const order = orderForMove(sortedViews, id, index)
    const doc = sortedViews.find((it) => it._id === id)
    if (order !== undefined && doc !== undefined) await client.update(doc, { order })
  }

  function onDragEnd (): void {
    dragId = undefined
    dropIndex = undefined
  }

  onDestroy(() => {
    viewsQuery.unsubscribe()
    viewletsQuery.unsubscribe()
    preferenceQuery.unsubscribe()
  })
</script>

{#if tabs.length > 0}
  <div class="saved-view-bar" data-id="saved-view-bar">
    <div class="tabs" role="tablist" on:dragover|preventDefault on:drop={onDrop}>
      {#each tabs as tab, index (tab._id)}
        {@const selected = activeTab?._id === tab._id}
        <div
          class="tab"
          class:selected
          class:dragging={dragId === tab._id}
          class:drop-target={dropIndex === index && dragId !== undefined && dragId !== tab._id}
          role="tab"
          tabindex="0"
          aria-selected={selected}
          draggable={tab.doc !== undefined && !$restrictionStore.readonly}
          on:click={() => {
            select(tab)
          }}
          on:keydown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') select(tab)
          }}
          on:contextmenu|preventDefault={(ev) => {
            if (!$restrictionStore.readonly) void showTabMenu(ev, tab)
          }}
          on:dragstart={(ev) => {
            onDragStart(ev, tab)
          }}
          on:dragover={(ev) => {
            onDragOver(ev, index)
          }}
          on:dragend={onDragEnd}
        >
          {#if tab.doc?.viewletId !== undefined || selected}
            {@const layout = viewlets.find((it) => it._id === (tab.doc?.viewletId ?? viewlet?._id))}
            {#if layout?.$lookup?.descriptor?.icon !== undefined}
              <span class="layout-icon"><Icon icon={layout.$lookup.descriptor.icon} size={'small'} /></span>
            {/if}
          {/if}
          <span class="name">{tab.name}</span>
          {#if selected && dirty}
            <span class="dirty" use:tooltip={{ label: viewPlugin.string.SavedViewUnsaved }} data-id="saved-view-dirty" />
          {/if}
          {#if !$restrictionStore.readonly}
            <button
              class="menu-button"
              type="button"
              aria-label="menu"
              on:click|stopPropagation={(ev) => {
                void showTabMenu(ev, tab)
              }}
            >
              <Icon icon={view.icon.MoreH} size={'small'} />
            </button>
          {/if}
        </div>
      {/each}
      {#if !$restrictionStore.readonly && layoutViewlets.length > 0}
        <Button
          kind={'ghost'}
          size={'small'}
          icon={IconAdd}
          label={viewPlugin.string.SavedViewNew}
          dataId={'saved-view-new'}
          on:click={(ev) => {
            void showNewViewMenu(ev)
          }}
        />
      {/if}
    </div>
    {#if dirty && !$restrictionStore.readonly}
      <div class="dirty-actions">
        <Button kind={'ghost'} size={'small'} label={viewPlugin.string.SavedViewDiscard} on:click={discard} />
        <Button
          kind={'primary'}
          size={'small'}
          label={viewPlugin.string.SavedViewSave}
          dataId={'saved-view-save'}
          on:click={() => {
            void saveChanges()
          }}
        />
      </div>
    {/if}
  </div>
{/if}

<style lang="scss">
  .saved-view-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0 0.75rem;
    min-height: 2.25rem;
    border-bottom: 1px solid var(--theme-divider-color);
    flex-shrink: 0;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    overflow-x: auto;
  }
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    height: 2.25rem;
    padding: 0 0.25rem 0 0.625rem;
    color: var(--theme-content-color);
    cursor: pointer;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    user-select: none;

    &:hover {
      color: var(--theme-caption-color);
    }
    &.selected {
      color: var(--theme-caption-color);
      border-bottom-color: var(--primary-button-default, var(--theme-caption-color));
    }
    &.dragging {
      opacity: 0.4;
    }
    &.drop-target {
      box-shadow: inset 2px 0 0 var(--primary-button-default, var(--theme-caption-color));
    }
  }
  .layout-icon {
    display: flex;
  }
  .dirty {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background-color: var(--theme-warning-color, #e0a030);
  }
  .menu-button {
    display: flex;
    align-items: center;
    padding: 0.125rem;
    border: none;
    border-radius: 0.25rem;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0;

    &:hover {
      background-color: var(--theme-button-hovered);
    }
  }
  .tab:hover .menu-button,
  .tab.selected .menu-button,
  .menu-button:focus-visible {
    opacity: 1;
  }
  .dirty-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }
</style>
