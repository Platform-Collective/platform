<script lang="ts">
  import { DocumentQuery, Ref, Space, WithLookup } from '@hcengineering/core'
  import { Asset, getMetadata, IntlString, translate, translateCB } from '@hcengineering/platform'
  import contact, { Employee, getCurrentEmployee, getName } from '@hcengineering/contact'
  import { ComponentExtensions, createQuery, getClient } from '@hcengineering/presentation'
  import tags, { TagElement, TagReference } from '@hcengineering/tags'
  import task from '@hcengineering/task'
  import { Issue, Project, TrackerEvents } from '@hcengineering/tracker'
  import {
    Button,
    IconAdd,
    IModeSelector,
    Label,
    ModeSelector,
    SearchInputAdvanced,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import view, { BuildModelKey, ViewOptions, Viewlet } from '@hcengineering/view'
  import {
    clientViewExtension,
    filterGrammar,
    FilterBar,
    FilterButton,
    FilterQueryBar,
    InlineFilterChips,
    SavedViewBar,
    SpaceHeader,
    ViewletContentView,
    ViewletSettingButton,
    filterStore,
    getViewOptions,
    rawSearchTextStore,
    resultIssueCountStore,
    resetResultCount,
    searchHighlightEnabledStore,
    shouldShowSearchEmptyState,
    statusStore,
    viewOptionStore
  } from '@hcengineering/view-resources'
  import { onDestroy } from 'svelte'
  import { readable } from 'svelte/store'
  import { buildIssueFilterSchema, customFilterToQuery, type NamedOption } from '../../issueFilter'
  import tracker from '../../plugin'
  import CustomFieldFilterButton from '../../projectFields/CustomFieldFilterButton.svelte'
  import { createCustomFieldViewExtension, customFieldFilterStore } from '../../projectFields/customFieldView'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import {
    activeFilterCount,
    buildFiltersPredicate,
    exceedsScanLimit,
    isFilterableType,
    isGroupableType,
    parseCustomFieldViewKey,
    resolveScanLimit,
    type CustomFieldFilter
  } from '../../projectFields/query'
  import { buildRegistry } from '../../projectFields/registry'
  import { issuePriorities } from '../../types'
  import CreateIssue from '../CreateIssue.svelte'
  import GanttToolbarBar from '../gantt/GanttToolbarBar.svelte'
  import SearchEmptyState from '../SearchEmptyState.svelte'

  function newIssue (): void {
    showPopup(CreateIssue, { space, shouldSaveDraft: true }, 'top')
  }

  export let space: Ref<Space> | undefined = undefined
  export let query: DocumentQuery<Issue> = {}
  export let title: IntlString | undefined = undefined
  export let label: string = ''
  export let icon: Asset | undefined = undefined
  export let modeSelectorProps: IModeSelector | undefined = undefined

  let viewlet: WithLookup<Viewlet> | undefined = undefined
  const viewletQuery = { attachTo: tracker.class.Issue, variant: { $nin: ['subissue', 'component', 'milestone'] } }
  // GitHub Projects layouts that exist in the tracker: Table (the list) and Board
  const viewLayouts = [view.viewlet.List, tracker.viewlet.Kanban]
  // Columns of the active saved view and its bar, which also keeps the unsaved column edits
  let viewConfig: Array<BuildModelKey | string> | undefined
  let savedViewBar: SavedViewBar | undefined
  const viewlets: WithLookup<Viewlet>[] | undefined = undefined
  let viewOptions: ViewOptions | undefined

  // The Gantt viewlet has its own toolbar inside GanttView with dedicated
  // Filter / Group-by / Sort / Tree-View / Virtualization controls. The
  // standard ViewletSettingButton renders TWO icon buttons (ViewOptions
  // + Configure) which both carry the "Customize View" tooltip but only
  // the first wires up to the underlying viewOptions; worse, its
  // groupBy/orderBy doesn't drive the Gantt view at all. Hide them in
  // Gantt mode so the user isn't left clicking dead buttons — but still
  // resolve a viewOptions object inline so ViewletContentView mounts
  // (without it the Gantt component never renders).
  $: isGanttMode = viewlet?.descriptor === tracker.viewlet.Gantt
  $: if (isGanttMode && viewlet !== undefined) {
    viewOptions = getViewOptions(viewlet, $viewOptionStore)
  }

  // Custom fields of the project (plan D1): optional columns, group-by / order-by keys and a filter.
  // The values live in an untyped record, so all of it runs on the client over a bounded scan.
  const emptyRegistry = readable(buildRegistry([]))
  const noFilters = readable<CustomFieldFilter[]>([])
  const scanQuery = createQuery()

  $: project = space as Ref<Project> | undefined
  $: registry = project !== undefined ? sharedProjectFieldsStore(project) : emptyRegistry
  $: filtersStore = project !== undefined ? customFieldFilterStore(project) : noFilters
  $: filters = $filtersStore
  $: hasFilterableFields = $registry.fields.some((f) => isFilterableType(f.type))
  $: scanLimit = resolveScanLimit(getMetadata(tracker.metadata.CustomFieldScanLimit))

  $: usesCustomKeys =
    (viewOptions?.groupBy ?? []).some((it) => parseCustomFieldViewKey(it) !== undefined) ||
    parseCustomFieldViewKey(viewOptions?.orderBy?.[0] ?? '') !== undefined
  // The custom field rules are dormant while a filter string exists (the string is authoritative)
  $: filtersActive = activeFilterCount(filters) > 0 && !stringFilterActive
  $: needsScan = ($registry.fields.length > 0 && (filtersActive || usesCustomKeys)) || residual !== undefined

  // ---- GitHub-style filter string (plan D3) ----
  // The string is the view's filter: it is saved with the saved view, and it is authoritative. The part the
  // server can index is compiled into the query, the rest is evaluated on the client over a bounded scan,
  // like the custom field rules. While a string exists the custom field filter button is hidden and its rules
  // are not applied; applying a string folds active rules into it, so nothing stays active unseen.
  const client = getClient()
  let filterQuery = ''

  let assignees: NamedOption[] = []
  let components: NamedOption[] = []
  let milestones: NamedOption[] = []
  let labels: NamedOption[] = []
  let labelRefs: Array<{ issue: string, label: string }> = []
  let priorities: NamedOption[] = []
  const assigneeQuery = createQuery()
  const componentQuery = createQuery()
  const milestoneQuery = createQuery()
  const labelQuery = createQuery()
  const labelRefQuery = createQuery()

  assigneeQuery.query(contact.mixin.Employee, { active: true }, (res: Employee[]) => {
    const hierarchy = client.getHierarchy()
    assignees = res.map((e) => ({ id: e._id, name: getName(hierarchy, e) }))
  })
  labelQuery.query(tags.class.TagElement, { targetClass: tracker.class.Issue }, (res: TagElement[]) => {
    labels = res.map((e) => ({ id: e._id, name: e.title }))
  })
  $: if (project !== undefined) {
    componentQuery.query(tracker.class.Component, { space: project }, (res) => {
      components = res.map((e) => ({ id: e._id, name: e.label }))
    })
    milestoneQuery.query(tracker.class.Milestone, { space: project }, (res) => {
      milestones = res.map((e) => ({ id: e._id, name: e.label }))
    })
    labelRefQuery.query(
      tags.class.TagReference,
      { space: project, attachedToClass: tracker.class.Issue },
      (res: TagReference[]) => {
        labelRefs = res.map((r) => ({ issue: r.attachedTo, label: r.tag }))
      },
      { projection: { attachedTo: 1, tag: 1 } }
    )
  }

  async function updatePriorities (lang: string): Promise<void> {
    priorities = await Promise.all(
      Object.entries(issuePriorities).map(
        async ([value, { label }]) => ({ id: Number(value), name: await translate(label, {}, lang) })
      )
    )
  }
  $: void updatePriorities($themeStore.language)

  $: statuses = [...$statusStore.byId.values()].filter((s) => s.ofAttribute === tracker.attribute.IssueStatus)
  $: closedStatuses = new Set<string>(
    statuses.filter((s) => s.category === task.statusCategory.Won || s.category === task.statusCategory.Lost).map((s) => s._id)
  )
  $: filterSchema = buildIssueFilterSchema({
    statuses: statuses.map((s) => ({ id: s._id, name: s.name })),
    priorities,
    assignees,
    components,
    milestones,
    labels,
    labelRefs,
    customFields: $registry.fields,
    noParentId: tracker.ids.NoParent
  })

  // `now` is taken when the filter is compiled, so `@today` follows the day the filter was applied
  $: filterCtx = {
    now: Date.now(),
    me: getCurrentEmployee() as string,
    closedStatuses,
    noParentId: tracker.ids.NoParent as string,
    iterations: () => []
  } satisfies filterGrammar.FilterContext
  $: reservedKeys = new Set(Object.keys(resultQuery).filter((k) => !k.startsWith('$')))
  $: stringFilterActive = filterQuery.trim() !== ''
  $: parsedFilter = stringFilterActive ? filterGrammar.parseFilter(filterQuery, filterSchema) : undefined
  // An invalid string is not applied; the filter bar shows the error
  $: split =
    parsedFilter?.ok === true ? filterGrammar.splitServerClient(parsedFilter.value, filterCtx, reservedKeys) : undefined
  $: stringServerQuery = split?.query ?? {}
  $: residual = split?.residual
  $: residualPredicate = filterGrammar.createPredicate(residual, filterCtx)

  function applyFilterQuery (e: CustomEvent<string>): void {
    let next = e.detail
    if (project !== undefined && next.trim() !== '' && activeFilterCount(filters) > 0) {
      next = filterGrammar.joinAnd(next, customFilterToQuery(filters, $registry.byKey))
      customFieldFilterStore(project).set([])
    }
    filterQuery = next
  }

  let scanned: Array<Partial<Issue>> = []
  let scanReady = false

  function withoutLookup (q: DocumentQuery<Issue>): DocumentQuery<Issue> {
    const res: DocumentQuery<Issue> = {}
    for (const [k, v] of Object.entries(q)) {
      if (!k.startsWith('$lookup.')) (res as any)[k] = v
    }
    return res
  }

  // The scan is capped at limit + 1 so that exceeding the limit is detected without loading everything
  $: if (needsScan) {
    const projection: Record<string, 1> = { _id: 1, customFields: 1 }
    for (const key of filterGrammar.referencedProperties(residual)) projection[key] = 1
    scanQuery.query(
      tracker.class.Issue,
      withoutLookup(serverQuery),
      (res) => {
        scanned = res
        scanReady = true
      },
      { limit: scanLimit + 1, projection }
    )
  } else {
    scanQuery.unsubscribe()
    scanned = []
    scanReady = false
  }

  // Above the limit custom-field filter/sort/group is off; it is never applied to a truncated set
  $: overLimit = needsScan && scanReady && exceedsScanLimit(scanned.length, scanLimit)
  $: legacyPredicate = buildFiltersPredicate($registry.byKey, filtersActive ? filters : [])
  $: predicate = (issue: Partial<Issue>): boolean => legacyPredicate(issue) && residualPredicate(issue)
  // What the server narrows to: the view's chips and search plus the indexable part of the filter string
  $: serverQuery = { ...resultQuery, ...stringServerQuery } as DocumentQuery<Issue>
  $: clientFilterActive = filtersActive || residual !== undefined

  function buildViewQuery (
    base: DocumentQuery<Issue>,
    active: boolean,
    ready: boolean,
    over: boolean,
    scan: Array<Partial<Issue>>,
    match: (issue: Partial<Issue>) => boolean
  ): DocumentQuery<Issue> {
    if (!active || over) return base
    // Nothing is shown until the first scan arrives instead of flashing unfiltered rows
    if (!ready) return { ...base, _id: { $in: [] } }
    return { ...base, _id: { $in: scan.filter(match).map((it) => it._id as Ref<Issue>) } }
  }
  $: viewQuery = buildViewQuery(serverQuery, clientFilterActive, scanReady, overLimit, scanned, predicate)

  let emptyLabels = new Map<string, string>()
  async function updateEmptyLabels (fields: Array<{ key: string, label: string, type: any }>, lang: string): Promise<void> {
    const entries = await Promise.all(
      fields
        .filter((f) => isGroupableType(f.type))
        .map(async (f) => [f.key, await translate(tracker.string.NoFieldValue, { field: f.label }, lang)] as const)
    )
    emptyLabels = new Map(entries)
  }
  $: void updateEmptyLabels($registry.fields, $themeStore.language)

  // Always installed (even without fields) so a saved custom group/order key never reaches the server
  $: clientViewExtension.set(
    createCustomFieldViewExtension({ registry: $registry, scanLimit, disabled: overLimit, emptyLabels })
  )
  onDestroy(() => {
    clientViewExtension.set(undefined)
  })

  // Single search source-of-truth. The legacy `search` binding still
  // exists for SpaceHeader's internal SearchInput (only used when
  // overrideSearch=false — never reached today). The new path uses
  // searchRaw + searchEncoded written by SearchInputAdvanced. The
  // `rawSearchTextStore` mirrors searchRaw so HighlightedText consumers
  // can read it without prop-drilling.
  let search = ''
  let searchRaw = ''
  let searchEncoded = ''

  function onSearchChange (e: CustomEvent<{ raw: string, encoded: string }>): void {
    searchRaw = e.detail.raw
    searchEncoded = e.detail.encoded
  }

  // Sync rawSearchTextStore reactively with the LOCAL searchRaw so that
  // route/space changes that remount this component immediately reset
  // the global store to the empty initial value. Previously the store
  // was only written from onSearchChange(), so the new view mounted
  // with an empty input field but the global store still held the
  // PREVIOUS view's search text — Empty-State + match-highlight could
  // then react to a stale query that the user never typed in this view.
  $: rawSearchTextStore.set(searchRaw)
  onDestroy(() => {
    rawSearchTextStore.set('')
  })

  let searchQuery: DocumentQuery<Issue> = { ...query }
  function updateSearchQuery (eff: string): void {
    searchQuery = eff === '' ? { ...query } : { ...query, $search: eff }
  }
  $: if (query !== undefined) updateSearchQuery(searchEncoded)
  let resultQuery: DocumentQuery<Issue> = { ...searchQuery }

  $: if (title) {
    translateCB(title, {}, $themeStore.language, (res) => {
      label = res
    })
  }

  // Mirror the Customize-View toggle into a store so HighlightedText
  // consumers (IssuePresenter, GanttSidebarColumn) can short-circuit to a
  // no-op when the user turns highlighting off. Defaults to true on first
  // mount so the toggle's default-on behaviour is honoured.
  $: searchHighlightEnabledStore.set((viewOptions?.searchHighlight ?? true) !== false)

  // Reset the result-count store to -1 on every search or filter change.
  // Without this reset, a stale 0 from a previous query would leave the
  // empty-state card stuck after the user retyped — the new query is
  // already in flight but the card reads the old 0 until the viewlet's
  // LiveQuery callback delivers the new count. The reset re-arms the
  // sentinel so the card disappears immediately on input change and only
  // re-appears when the new query confirms zero hits.
  $: {
    void searchEncoded
    void $filterStore
    // Reset to the pending sentinel without surrendering the viewlet's
    // ownership — the mounted viewlet stays authoritative and re-populates the
    // count once its new query resolves.
    resetResultCount()
  }

  // Empty-state is shown only when the user has typed something AND the
  // viewlet returned zero results. Until the viewlet writes a real count
  // (List.svelte / KanbanView.svelte / GanttView.svelte) the store stays
  // at -1, so the "no hits" card cannot flash during initial load before
  // the first query response.
  // The card does NOT replace the viewlet: it renders as a non-suppressive
  // sibling below the always-mounted viewlet (see the comment above
  // .viewlet-wrap below). It is suppressed entirely when the user turned on
  // "show empty groups" (shouldShowAll), which keeps the empty groups/columns
  // visible (its explicit choice wins).
  $: showSearchEmptyState = shouldShowSearchEmptyState(
    $rawSearchTextStore,
    $resultIssueCountStore,
    viewOptions?.shouldShowAll as boolean | undefined
  )
</script>

<SpaceHeader
  _class={tracker.class.Issue}
  {icon}
  bind:viewlet
  bind:search
  showLabelSelector={$$slots.label_selector}
  {viewletQuery}
  {viewlets}
  {label}
  {space}
  resultQuery={viewQuery}
  modeSelectorProps={isGanttMode ? undefined : modeSelectorProps}
  overrideSearch={true}
  shrinkSearch={isGanttMode}
>
  <svelte:fragment slot="header-tools">
    <ViewletSettingButton
      bind:viewOptions
      bind:viewlet
      hideGroupingAndOrdering={isGanttMode}
      showConfigureColumns={!isGanttMode}
      hideKeys={isGanttMode ? ['ganttGroupBy'] : []}
      configOverride={project !== undefined ? viewConfig : undefined}
      onSaveConfig={project !== undefined ? (config) => savedViewBar?.setLocalConfig(config) : undefined}
    />
  </svelte:fragment>

  <!-- Search slot is now consumed by every Tracker viewlet (not just
       Gantt), so SearchInputAdvanced + prefix-operators + searchScope +
       rawSearchTextStore + match-highlight + empty-state all work in
       List / Kanban too. Gantt additionally lifts the GanttToolbarBar
       sections (Group-by, Date-Nav, Zoom, Undo/Redo) into the same row
       so the toolbar stays a single visual unit. -->
  <svelte:fragment slot="search" let:search let:setSearch>
    {#if isGanttMode}
      <!-- Search cluster uses flex-direction: row-reverse (huly UI
           convention), so child markup order is REVERSED from visual L→R.
           Desired visual L→R: Lupe → Filter → chips → toolbar. So markup:
           FIRST=toolbar (visually rightmost) … LAST=Lupe (visually
           leftmost).

           The toolbar itself is a SINGLE child now: it brings its own flex
           row (natural L→R order inside) and measures the width it got so it
           can collapse tiers into a "…" popover. That is what keeps the
           trailing Fullscreen / More-actions cluster inside the viewport at
           1920, 1600 and 390 px — see GanttToolbarBar's header comment. -->
      <GanttToolbarBar section="cluster" />
      <InlineFilterChips _class={tracker.class.Issue} {space} constrained />
      <FilterButton _class={tracker.class.Issue} {space} />
      {#if project !== undefined && hasFilterableFields && !stringFilterActive}
        <CustomFieldFilterButton space={project} />
      {/if}
      {#if modeSelectorProps !== undefined && (viewOptions?.showQuickModeSelector ?? true) !== false}
        <ModeSelector kind={'subtle'} props={modeSelectorProps} />
      {/if}
      <SearchInputAdvanced
        value={searchRaw}
        on:change={onSearchChange}
        scope={viewOptions?.searchScope ?? 'all'}
        collapsed
      />
    {:else}
      <SearchInputAdvanced
        value={searchRaw}
        on:change={onSearchChange}
        scope={viewOptions?.searchScope ?? 'all'}
        collapsed
      />
      {#if project !== undefined && hasFilterableFields && !stringFilterActive}
        <CustomFieldFilterButton space={project} />
      {/if}
      <FilterButton _class={tracker.class.Issue} {space} />
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="extra-trailing">
    {#if isGanttMode}
      <!-- The extra cluster is flex-direction: row (not row-reverse), so
           markup order matches visual order: hamburger first, fullscreen
           last. -->
      <GanttToolbarBar section="trailing" />
    {/if}
  </svelte:fragment>

  <!-- No `extra` slot on purpose: the ModeSelector is rendered by SpaceHeader
       from `modeSelectorProps` and the trailing icons go into
       `extra-trailing`. Passing a comment-only `<svelte:fragment slot="extra">`
       would be a no-op anyway — Svelte 4 compiles it away and the slot is not
       registered, which is exactly why SpaceHeader's `hideExtra` has to look
       at `extra-trailing` as well. -->

  <svelte:fragment slot="label_selector">
    <slot name="label_selector" />
  </svelte:fragment>

  <svelte:fragment slot="type_selector">
    <slot name="type_selector" {viewlet} />
  </svelte:fragment>

  <svelte:fragment slot="actions">
    <ComponentExtensions
      extension={tracker.extensions.IssueListHeader}
      props={{ size: 'small', kind: 'tertiary', space }}
    />
    <Button
      kind="primary"
      icon={IconAdd}
      iconProps={{ size: 'medium' }}
      shape="round"
      showTooltip={{ label: tracker.string.NewIssue }}
      on:click={newIssue}
    />
  </svelte:fragment>
</SpaceHeader>

{#if project !== undefined}
  <!-- View tabs: every tab is a saved view (layout, filter, sort, group-by, columns) of this project -->
  <SavedViewBar
    bind:this={savedViewBar}
    space={project}
    _class={tracker.class.Issue}
    {viewlet}
    {viewletQuery}
    layouts={viewLayouts}
    extra={customFieldFilterStore(project)}
    bind:config={viewConfig}
    bind:filterQuery
  />
  <!-- GitHub-style filter string; it is the filter of the active view -->
  <FilterQueryBar value={filterQuery} schema={filterSchema} on:apply={applyFilterQuery} />
{/if}

<!-- FilterBar owns the filter→resultQuery data path (debounced via
     reduceCalls, shared with non-Tracker consumers). hideChips=true
     suppresses its chip render — chips are mounted separately by
     InlineFilterChips (inline in Gantt mode, below-header otherwise). -->
<FilterBar
  _class={tracker.class.Issue}
  {space}
  query={searchQuery}
  {viewOptions}
  hideChips={true}
  on:change={(e) => (resultQuery = e.detail)}
/>
<slot name="afterHeader" />
{#if overLimit}
  <div class="custom-field-error" role="alert">
    <Label label={tracker.string.CustomFieldScanLimitExceeded} params={{ limit: scanLimit }} />
  </div>
{/if}
{#if !isGanttMode}
  <!-- List / Kanban modes: render the chip strip below the SpaceHeader.
       Gantt has its own inline placement inside the search slot above.
       Mounted unconditionally so it stays available the instant the
       user adds a filter; the visual row hides when $filterStore is
       empty (via [data-empty='true']). -->
  <div class="below-header-filters" data-empty={$filterStore.length === 0}>
    <InlineFilterChips _class={tracker.class.Issue} {space} />
  </div>
{/if}
<!-- Viewlet stays mounted AND laid out regardless of the empty-state card.
     Two earlier iterations broke live list updates:
       1. Unmounting the viewlet on a zero-hit search created a self-lock —
          with no viewlet around, resultIssueCountStore never updated on
          retype so the card stuck.
       2. Keeping it mounted but toggling `display: none` starved the
          virtualized viewlets (List / Gantt use a viewport-measured virtual
          scroller since the row-virtualization tier): while hidden the
          scroller measures a 0-height viewport and caches it, so when the
          count returns to a positive value and the wrapper re-shows, the
          stale 0-height measurement leaves ZERO rows rendered — a freshly
          created / searched issue never appears in the list even though its
          LiveQuery already delivered it. That is the uitest regression
          (issues + mentions "create → search → open" timing out on the row
          locator).
     The empty-state is therefore a non-suppressive OVERLAY: the live viewlet
     is never collapsed, so its scroller always has a real viewport and always
     renders its rows. The card only ever adds an informational panel; it can
     never hide a populated list. `display: contents` is kept so
     ViewletContentView stays a direct flex child of the page-level layout —
     the chain Gantt's `height: 100%` depends on.

     An in-flow sibling would not work: the panel is an `overflow: hidden`
     flex column and the Gantt root claims all remaining height (`height:
     100%`), so anything appended after it is pushed past the bottom edge and
     clipped away — visible in List/Kanban, invisible in Gantt. The card is
     therefore taken out of flow (see `.search-empty-state-overlay` below),
     which keeps the viewlet's box untouched in every mode.

     `showSearchEmptyState` therefore only decides whether the CARD renders:
     with "show empty groups" (shouldShowAll) on it stays false, so the empty
     groups / Kanban columns remain visible and the card is suppressed — the
     user's explicit view option wins. -->
<div class="viewlet-wrap">
  {#if viewlet && viewOptions}
    <ViewletContentView
      _class={tracker.class.Issue}
      {viewlet}
      query={viewQuery}
      {space}
      {viewOptions}
      configOverride={project !== undefined ? viewConfig : undefined}
      createItemDialog={CreateIssue}
      createItemLabel={tracker.string.AddIssueTooltip}
      createItemEvent={TrackerEvents.IssuePlusButtonClicked}
      createItemDialogProps={{ shouldSaveDraft: true }}
    />
  {/if}
</div>
{#if showSearchEmptyState}
  <div class="search-empty-state-overlay">
    <SearchEmptyState searchText={$rawSearchTextStore} activeFilters={$filterStore.map((f) => f.key.key)} />
  </div>
{/if}

<style lang="scss">
  .custom-field-error {
    padding: 0.5rem 1rem;
    color: var(--theme-error-color, #d73a49);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .below-header-filters {
    display: flex;
    align-items: center;
    padding: 0.25rem 0.75rem;
    min-height: 1.75rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .below-header-filters[data-empty='true'] {
    display: none;
  }
  /* `display: contents` lets the wrapper disappear from layout so
     ViewletContentView stays a direct flex item of the page-level chain
     (Gantt's `height: 100%` depends on that). The wrapper is NEVER switched
     to `display: none` — doing so starved the virtualized viewlet's scroller
     of a viewport and left rows unrendered after the empty-state dismissed
     itself (see the template comment above). The empty-state card is a
     sibling, so the live viewlet's layout is always intact. */
  .viewlet-wrap {
    display: contents;
  }
  /* Out-of-flow overlay centred on the panel.

     Why an overlay and not an in-flow block: the card must not take layout
     space away from the viewlet. Displacing or hiding the viewlet starves
     its virtual scroller — it caches a 0-height viewport and renders zero
     rows once results come back (the create → search → open regression, see
     the template comment above). An absolutely positioned card leaves the
     viewlet's box byte-for-byte identical, so the scroller keeps measuring a
     real viewport the whole time.

     Why out-of-flow is required at all: the enclosing panel is an
     `overflow: hidden` flex column and the Gantt root takes 100% of the
     remaining height, so an in-flow sibling after it lands below the bottom
     edge and is clipped — never visible to the user. In List/Kanban it would
     be visible, so the overlay is what makes all three modes behave alike.

     Containing block: the panel (`.hulyComponent`) applies
     `container-type: inline-size`, i.e. layout containment, which makes it
     the containing block for absolutely positioned descendants. Should that
     ever change, the fallback is the initial containing block (the viewport)
     — still on screen, just centred on the window instead of the panel.

     `pointer-events: none` keeps the header, view options and toolbar
     clickable through the transparent area; the card itself re-enables them.
     The card only renders at resultCount === 0, so there are no result rows
     underneath that it could cover. */
  .search-empty-state-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Above the Gantt's sticky header cells / scrollbars (max 100), below the
       global popup layer (450+). */
    z-index: 101;
    pointer-events: none;
  }
  .search-empty-state-overlay > :global(.search-empty-state) {
    pointer-events: auto;
  }
</style>
