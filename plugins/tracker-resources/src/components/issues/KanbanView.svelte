<!--
// Copyright © 2022 Hardcore Engineering Inc.
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
-->
<script lang="ts">
  import {
    CategoryType,
    Class,
    Doc,
    DocumentQuery,
    DocumentUpdate,
    FindOptions,
    generateId,
    Lookup,
    mergeQueries,
    Ref,
    WithLookup
  } from '@hcengineering/core'
  import { Item, Kanban as KanbanUI } from '@hcengineering/kanban'
  import { ActionContext, createQuery, getClient } from '@hcengineering/presentation'
  import { DocWithRank, getStates } from '@hcengineering/task'
  import { getTaskKanbanResultQuery, typeStore, updateTaskKanbanCategories } from '@hcengineering/task-resources'
  import { Issue, IssuesOrdering, Iteration, Project } from '@hcengineering/tracker'
  import { ColorDefinition, defaultBackground, Loading, showPopup, themeStore } from '@hcengineering/ui'
  import { BuildModelKey, Viewlet, ViewOptionModel, ViewOptions } from '@hcengineering/view'
  import {
    clientViewExtension,
    type ClientViewExtension,
    focusStore,
    getCategoryQueryNoLookup,
    getCategoryQueryNoLookupOptions,
    getCategoryQueryProjection,
    getPresenter,
    groupBy,
    ListSelectionProvider,
    claimResultCountOwner,
    releaseResultCountOwner,
    restrictionStore,
    setResultCount,
    SelectDirection,
    setViewOptions,
    showMenu,
    statusStore
  } from '@hcengineering/view-resources'
  import { onDestroy, onMount } from 'svelte'
  import { readable } from 'svelte/store'

  import {
    hiddenOf,
    limitsOf,
    readBoardConfig,
    resolveBoardDimensions,
    withBoardConfig,
    withColumnHidden,
    withColumnLimit,
    type BoardConfig
  } from '../../board/config'
  import {
    buildColumnCategories,
    buildLaneCategories,
    categoryKey,
    fieldOfKey,
    groupByCustomField,
    isCustomDimensionKey,
    partitionColumns
  } from '../../board/columns'
  import { attributeTarget, customTarget, resolveDropUpdate, type DropTarget } from '../../board/move'
  import { draftValuesFromUpdate } from '../../draft/addItem'
  import type { DraftValues } from '../../draft/create'
  import { buildBoardGrid, cellLanes, gridOrder, toggleLane } from '../../board/swimlanes'
  import { expansionStore } from '../../hierarchy/expansionStore'
  import { collapsedGroupsStorageKey } from '../../grouping/levels'
  import { readFieldSums, resolveFieldSums, sumProjection, type SummableField } from '../../fieldSum/config'
  import { loadSummableFields } from '../../fieldSum/load'
  import { computeFieldSums, formatFieldSums } from '../../fieldSum/sum'
  import { iterationsByFieldKey, sharedIterationsStore } from '../../iterations/iterationsStore'
  import tracker from '../../plugin'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import { parseCustomFieldViewKey } from '../../projectFields/query'
  import { buildRegistry } from '../../projectFields/registry'
  import { activeProjects } from '../../utils'
  import BoardColumnHeader from '../board/BoardColumnHeader.svelte'
  import BoardLanes from '../board/BoardLanes.svelte'
  import CardFieldRenderer from '../board/CardFieldRenderer.svelte'
  import DimensionTitle from '../board/DimensionTitle.svelte'
  import HiddenColumnsPanel from '../board/HiddenColumnsPanel.svelte'
  import type { DimensionInfo } from '../board/types'
  import CreateIssue from '../CreateIssue.svelte'
  import AddItemRow from '../draft/AddItemRow.svelte'

  const _class = tracker.class.Issue
  export let space: Ref<Project> | undefined = undefined
  export let baseMenuClass: Ref<Class<Doc>> | undefined = undefined
  export let query: DocumentQuery<Issue> = {}
  export let viewOptionsConfig: ViewOptionModel[] | undefined = undefined
  export let viewOptions: ViewOptions
  export let viewlet: Viewlet
  export let config: (string | BuildModelKey)[]
  export let options: FindOptions<DocWithRank> | undefined = undefined

  $: orderBy = viewOptions.orderBy

  let accentColors = new Map<string, ColorDefinition>()
  const setAccentColor = (n: number, ev: CustomEvent<ColorDefinition>) => {
    accentColors.set(`${n}${$themeStore.dark}${columnKey}`, ev.detail)
    accentColors = accentColors
  }

  $: dontUpdateRank = orderBy[0] !== IssuesOrdering.Manual

  $: currentSpace = space ?? tracker.project.DefaultProject
  let currentProject: Project | undefined
  $: currentProject = $activeProjects.get(currentSpace) as Project

  let resultQuery: DocumentQuery<any> = { ...query }
  const client = getClient()

  $: void getTaskKanbanResultQuery(client.getHierarchy(), query, viewOptionsConfig, viewOptions).then((p) => {
    resultQuery = mergeQueries(p, query)
  })

  $: queryNoLookup = getCategoryQueryNoLookup(resultQuery)

  function toIssue (object: any): WithLookup<Issue> {
    return object as WithLookup<Issue>
  }

  const lookup: Lookup<Issue> = {
    ...(options?.lookup ?? {}),
    attachedTo: tracker.class.Issue,
    _id: {
      subIssues: tracker.class.Issue
    }
  }

  $: resultOptions = { ...options, lookup, ...(orderBy !== undefined ? { sort: { [orderBy[0]]: orderBy[1] } } : {}) }

  // ---- layout of the board ----
  // The columns come from the column field of the board settings (status unless chosen otherwise); the swimlanes
  // are the "Group by" of the view. Both can be a built-in attribute or a custom field of the project.
  const emptyRegistry = readable(buildRegistry([]))
  const noIterations = readable<Iteration[]>([])
  $: registry = space !== undefined ? sharedProjectFieldsStore(space) : emptyRegistry
  $: iterationsStore = space !== undefined ? sharedIterationsStore(space) : noIterations
  $: iterationsByKey = iterationsByFieldKey($iterationsStore, $registry.fields)

  $: boardConfig = readBoardConfig(viewOptions)
  $: dimensions = resolveBoardDimensions(boardConfig, viewOptions.groupBy, { fields: $registry.fields })
  $: columnKey = dimensions.columnKey
  $: laneKey = dimensions.laneKey
  // The second level of the swimlanes ("Then by"); only drawn inside swimlanes
  $: subLaneKey = laneKey !== undefined ? dimensions.subLaneKey : undefined
  $: hiddenKeys = hiddenOf(boardConfig, columnKey)
  $: limits = limitsOf(boardConfig, columnKey)

  function changeBoardConfig (next: BoardConfig): void {
    setViewOptions(viewlet, withBoardConfig(viewOptions, next))
  }

  let columnInfo: DimensionInfo = { key: 'status', custom: false }
  let laneInfo: DimensionInfo | undefined
  let subLaneInfo: DimensionInfo | undefined

  // The presenters of custom fields are made by the view extension, which is rebuilt when the fields change
  async function loadInfo (key: string, extension: ClientViewExtension | undefined): Promise<DimensionInfo> {
    if (isCustomDimensionKey(key)) {
      return {
        key,
        custom: true,
        customHeader: extension?.getGroupHeader(key),
        emptyLabel: extension?.emptyGroupLabel(key)
      }
    }
    return { key, custom: false, presenter: await getPresenter(client, _class, { key }, { key }) }
  }

  $: void loadInfo(columnKey, $clientViewExtension).then((res) => {
    if (res.key === columnKey) columnInfo = res
  })
  $: if (laneKey !== undefined) {
    const key = laneKey
    void loadInfo(key, $clientViewExtension).then((res) => {
      if (res.key === laneKey) laneInfo = res
    })
  } else {
    laneInfo = undefined
  }
  $: if (subLaneKey !== undefined) {
    const key = subLaneKey
    void loadInfo(key, $clientViewExtension).then((res) => {
      if (res.key === subLaneKey) subLaneInfo = res
    })
  } else {
    subLaneInfo = undefined
  }

  let kanbanUI: KanbanUI
  let lanesUI: BoardLanes
  const listProvider = new ListSelectionProvider((offset: 1 | -1 | 0, of?: Doc, dir?: SelectDirection) => {
    if (laneKey !== undefined) lanesUI?.select(offset, of, dir)
    else kanbanUI?.select(offset, of, dir)
  })
  const selection = listProvider.selection

  onMount(() => {
    ;(document.activeElement as HTMLElement)?.blur()
  })

  // Category information only
  let tasks: DocWithRank[] = []

  // Feed the shared result-count store (via the owner-token gate) so IssuesView
  // can show its SearchEmptyState card when the user's search yields zero hits.
  // We claim ownership at init and release on destroy; the count is written
  // from the same fast-query callback that sets the data source (see docsQuery
  // below), not reactively off `tasks` — the old coupling read `tasks` (fast +
  // lagging slow query) while gating on a flag set by the fast query alone, so
  // a stale slow-query result could skew the count right after a search changed.
  const resultCountOwner = claimResultCountOwner()
  onDestroy(() => {
    releaseResultCountOwner(resultCountOwner)
  })

  let fastDocs: DocWithRank[] = []
  let slowDocs: DocWithRank[] = []

  const docsQuery = createQuery()
  const docsQuerySlow = createQuery()

  let fastQueryIds = new Set<Ref<DocWithRank>>()

  // The number fields whose sums the column headers show (GitHub's "Field sum")
  $: sumKeys = readFieldSums(viewOptions)
  let summable: SummableField[] = []
  $: void loadSummableFields($registry.fields, $themeStore.language).then((res) => {
    summable = res
  })
  $: sumFields = resolveFieldSums(sumKeys, summable)

  // Custom fields are stored in one record, so a board that uses one needs the whole record of the issues
  $: projectionKeys = Array.from(
    new Set([
      ...[columnKey, ...(laneKey !== undefined ? [laneKey] : []), ...(subLaneKey !== undefined ? [subLaneKey] : [])].map(
        (k) => (isCustomDimensionKey(k) ? 'customFields' : k)
      ),
      ...sumProjection(sumKeys)
    ])
  )

  let categoryQueryOptions: Partial<FindOptions<DocWithRank>>
  $: categoryQueryOptions = {
    ...getCategoryQueryNoLookupOptions(resultOptions),
    projection: {
      ...resultOptions.projection,
      _id: 1,
      _class: 1,
      rank: 1,
      ...getCategoryQueryProjection(client.getHierarchy(), _class, queryNoLookup, projectionKeys)
    }
  }

  $: docsQuery.query(
    _class,
    queryNoLookup,
    (res) => {
      fastDocs = res
      fastQueryIds = new Set(res.map((it) => it._id))
      setResultCount(resultCountOwner, res.length)
    },
    { ...categoryQueryOptions, limit: 1000 }
  )
  $: docsQuerySlow.query(
    _class,
    queryNoLookup,
    (res) => {
      slowDocs = res
    },
    categoryQueryOptions
  )

  $: tasks = [...fastDocs, ...slowDocs.filter((it) => !fastQueryIds.has(it._id))]

  // ---- columns and swimlanes ----
  let columnCategories: CategoryType[] = []
  let laneCategories: CategoryType[] = []
  let subLaneCategories: CategoryType[] = []
  let loadCategories = true

  const columnQueryId = generateId()
  const laneQueryId = generateId()
  const subLaneQueryId = generateId()

  async function loadAxis (
    key: string,
    queryId: Ref<Doc>,
    axis: 'column' | 'lane' | 'subLane',
    docs: DocWithRank[],
    refresh: () => void
  ): Promise<CategoryType[]> {
    const field = fieldOfKey(key, $registry.byKey)
    if (isCustomDimensionKey(key)) {
      if (field === undefined) return [undefined]
      const iterations = iterationsByKey.get(field.key) ?? []
      return axis === 'column'
        ? buildColumnCategories(field, iterations, docs)
        : buildLaneCategories(field, iterations, docs, viewOptions.shouldShowAll === true)
    }
    return await updateTaskKanbanCategories(
      client,
      viewlet,
      _class,
      space,
      docs,
      key,
      viewOptions,
      viewOptionsConfig,
      refresh,
      queryId
    )
  }

  // An answer that arrives after a newer request was made is dropped
  let columnRequest = 0
  let laneRequest = 0
  let subLaneRequest = 0

  function updateColumns (): void {
    const request = ++columnRequest
    void loadAxis(columnKey, columnQueryId, 'column', tasks, updateColumns).then((res) => {
      if (request !== columnRequest) return
      columnCategories = res
      loadCategories = false
    })
  }

  function updateLanes (): void {
    if (laneKey === undefined) {
      laneRequest++
      laneCategories = []
      return
    }
    const request = ++laneRequest
    void loadAxis(laneKey, laneQueryId, 'lane', tasks, updateLanes).then((res) => {
      if (request !== laneRequest) return
      laneCategories = res
    })
  }

  function updateSubLanes (): void {
    if (subLaneKey === undefined) {
      subLaneRequest++
      subLaneCategories = []
      return
    }
    const request = ++subLaneRequest
    void loadAxis(subLaneKey, subLaneQueryId, 'subLane', tasks, updateSubLanes).then((res) => {
      if (request !== subLaneRequest) return
      subLaneCategories = res
    })
  }

  // The dependencies are listed so that the categories follow the data, the settings and the project's fields
  $: if ([columnKey, tasks, viewOptions, viewOptionsConfig, $registry, $iterationsStore].length > 0) updateColumns()
  $: if ([laneKey, tasks, viewOptions, viewOptionsConfig, $registry, $iterationsStore].length > 0) updateLanes()
  $: if ([subLaneKey, tasks, viewOptions, viewOptionsConfig, $registry, $iterationsStore].length > 0) updateSubLanes()

  function bucket (docs: readonly DocWithRank[], key: string, categories: CategoryType[]): Record<string, DocWithRank[]> {
    const fieldKey = parseCustomFieldViewKey(key)
    return fieldKey !== undefined ? groupByCustomField(docs, fieldKey) : groupBy([...docs], key, categories)
  }

  // Hidden columns are listed in a side area; their cards are not on the board
  $: columns = partitionColumns(columnCategories, hiddenKeys)
  $: groupByDocs = bucket(tasks, columnKey, columnCategories)

  $: grid =
    laneKey !== undefined
      ? buildBoardGrid<DocWithRank, CategoryType>({
        items: tasks,
        lanes: laneCategories,
        columns: columns.visible,
        bucketLanes: (items) => bucket(items, laneKey ?? '', laneCategories),
        bucketColumns: (items) => bucket(items, columnKey, columnCategories),
        showEmptyLanes: viewOptions.shouldShowAll === true,
        ...(subLaneKey !== undefined
          ? { subLanes: subLaneCategories, bucketSubLanes: (items: readonly DocWithRank[]) => bucket(items, subLaneKey ?? '', subLaneCategories) }
          : {})
      })
      : undefined

  // The collapsed lanes are kept per viewer and per saved view; without a saved view they last for the session
  let sessionCollapsed = new Set<string>()
  $: collapsedStore =
    $clientViewExtension?.groupStateScope !== undefined
      ? expansionStore(collapsedGroupsStorageKey('board', $clientViewExtension.groupStateScope))
      : undefined
  $: collapsedLanes = (collapsedStore !== undefined ? $collapsedStore : undefined) ?? sessionCollapsed
  function toggleCollapsedLane (key: string): void {
    if (collapsedStore !== undefined) collapsedStore.toggle(key)
    else sessionCollapsed = toggleLane(sessionCollapsed, key)
  }

  $: visibleTasks = ((): DocWithRank[] => {
    if (grid !== undefined) return gridOrder(grid, collapsedLanes)
    if (hiddenKeys.length === 0) return tasks
    const ids = new Set(columns.visible.flatMap((c) => (groupByDocs[categoryKey(c)] ?? []).map((it) => it._id)))
    return tasks.filter((it) => ids.has(it._id))
  })()

  $: listProvider.update(visibleTasks)

  $: hiddenPanel = columns.hidden.map((category) => {
    const key = categoryKey(category)
    return { key, category, count: (grid?.columnTotals.get(key) ?? groupByDocs[key]?.length ?? 0) }
  })

  // The sums of the chosen number fields over the items of a column; nothing is shown without chosen fields
  let columnTotal: ((items: readonly Item[]) => string | undefined) | undefined
  $: columnTotal =
    sumFields.length > 0 ? (items) => formatFieldSums(computeFieldSums(items, sumFields)) : undefined

  function hideColumn (category: CategoryType): void {
    changeBoardConfig(withColumnHidden(boardConfig, columnKey, categoryKey(category), true))
  }

  function showColumn (key: string): void {
    changeBoardConfig(withColumnHidden(boardConfig, columnKey, key, false))
  }

  function setColumnLimit (category: CategoryType, limit: number | undefined): void {
    changeBoardConfig(withColumnLimit(boardConfig, columnKey, categoryKey(category), limit))
  }

  function addIssue (category: CategoryType): void {
    const props: Record<string, any> = { space: currentSpace }
    const fieldKey = parseCustomFieldViewKey(columnKey)
    if (fieldKey !== undefined) {
      if (typeof category === 'string') props.customFields = { [fieldKey]: category }
    } else {
      props[columnKey] = category
    }
    showPopup(CreateIssue, props, 'top')
  }

  // What a draft added in a cell of the board starts with: the value of its column and, with swimlanes, of its swimlane.
  // `undefined` when the cell cannot take a new item (its value does not exist for the project).
  function draftValuesFor (column: CategoryType, lane: CategoryType[] = []): DraftValues | undefined {
    if (space === undefined) return undefined
    const stub = { space } as unknown as Doc
    const columnTarget = targetOf(columnKey, column, stub)
    const laneTargets = laneTargetsOf(stub, lane)
    if (columnTarget === undefined || laneTargets === undefined) return undefined
    const update = resolveDropUpdate(stub, [columnTarget, ...laneTargets])
    return update === undefined ? undefined : draftValuesFromUpdate(update)
  }

  // What the lanes of a path (swimlane, sub-lane) write; undefined when one of them cannot take the value
  function laneTargetsOf (doc: Doc, path: CategoryType[]): Array<DropTarget | undefined> | undefined {
    const keys = [laneKey, subLaneKey]
    const targets: Array<DropTarget | undefined> = []
    for (const [level, category] of path.entries()) {
      const key = keys[level]
      if (key === undefined) continue
      const target = targetOf(key, category, doc)
      if (target === undefined) return undefined
      targets.push(target)
    }
    return targets
  }

  // ---- moving cards ----
  function targetOf (key: string, category: unknown, doc: Doc): DropTarget | undefined {
    const fieldKey = parseCustomFieldViewKey(key)
    return fieldKey !== undefined ? customTarget(fieldKey, category) : attributeTarget(key, category, doc.space)
  }

  const getUpdateProps = (doc: Doc, category: CategoryType): DocumentUpdate<Item> | undefined => {
    const target = targetOf(columnKey, category, doc)
    if (target === undefined) return undefined
    return resolveDropUpdate(doc as Item, [target]) as DocumentUpdate<Item> | undefined
  }

  // Dropping on a lane writes the value of the column, of the swimlane and of the sub-lane together
  const getLaneUpdateProps = (doc: Item, lane: CategoryType[], column: CategoryType): DocumentUpdate<Item> | undefined => {
    if (laneKey === undefined) return undefined
    const columnTarget = targetOf(columnKey, column, doc)
    const laneTargets = laneTargetsOf(doc, lane)
    if (columnTarget === undefined || laneTargets === undefined) return undefined
    return resolveDropUpdate(doc, [columnTarget, ...laneTargets]) as DocumentUpdate<Item> | undefined
  }

  // Full documents of a column of a custom field are loaded by the ids of its cards
  const getIdsQuery = (_state: CategoryType, items: Item[]): DocumentQuery<DocWithRank> => ({
    _id: { $in: items.map((it) => it._id) }
  })

  async function getAvailableCategories (key: string, categories: CategoryType[], doc: Doc): Promise<CategoryType[]> {
    const issue = toIssue(doc)

    if (key === 'component' || key === 'milestone') {
      const availableCategories = []
      const clazz = client.getHierarchy().getAttribute(tracker.class.Issue, key)

      for (const category of categories) {
        if (!category || (issue as any)[key] === category) {
          availableCategories.push(category)
        } else if (clazz !== undefined && 'to' in clazz.type) {
          const categoryDoc = await client.findOne(clazz.type.to as Ref<Class<Doc>>, {
            _id: category as Ref<Doc>,
            space: issue.space
          })

          if (categoryDoc) {
            availableCategories.push(category)
          }
        }
      }

      return availableCategories
    }

    if (key === 'status') {
      const space = await client.findOne(tracker.class.Project, { _id: issue.space })
      return getStates(space, $typeStore, $statusStore.byId).map(({ _id }) => _id)
    }

    return categories
  }
</script>

{#if loadCategories}
  <Loading />
{:else}
  <ActionContext
    context={{
      mode: 'browser'
    }}
  />
  {#if grid !== undefined && laneInfo !== undefined && laneInfo.key === laneKey && (subLaneKey === undefined || subLaneInfo?.key === subLaneKey)}
    {@const lanesInfo = laneInfo}
    <BoardLanes
      bind:this={lanesUI}
      collapsed={collapsedLanes}
      on:toggle={(evt) => {
        toggleCollapsedLane(evt.detail)
      }}
      {_class}
      options={resultOptions}
      columns={columns.visible}
      {grid}
      objects={visibleTasks}
      getGroupQuery={getIdsQuery}
      getUpdate={getLaneUpdateProps}
      getAvailableColumns={async (doc) => await getAvailableCategories(columnKey, columnCategories, doc)}
      getAvailableLanes={async (doc, level) =>
        level === 0
          ? await getAvailableCategories(laneKey ?? '', laneCategories, doc)
          : await getAvailableCategories(subLaneKey ?? '', subLaneCategories, doc)}
      selection={listProvider.current($focusStore)}
      checked={$selection ?? []}
      on:obj-focus={(evt) => {
        listProvider.updateFocus(evt.detail)
      }}
      on:check={(evt) => {
        listProvider.updateSelection(evt.detail.docs, evt.detail.value)
      }}
      on:contextmenu={(evt) => {
        showMenu(evt.detail.evt, { object: evt.detail.objects, baseMenuClass })
      }}
    >
      <svelte:fragment slot="column-header" let:column let:index let:count>
        {@const color = accentColors.get(`${index}${$themeStore.dark}${columnKey}`)}
        <BoardColumnHeader
          background={color?.background ?? defaultBackground($themeStore.dark)}
          titleColor={color?.title ?? 'var(--theme-caption-color)'}
          {count}
          limit={limits[categoryKey(column)]}
          total={columnTotal?.(cellLanes(grid).flatMap((lane) => lane.cells[index]?.items ?? []))}
          readonly={$restrictionStore.readonly}
          on:add={() => {
            addIssue(column)
          }}
          on:hide={() => {
            hideColumn(column)
          }}
          on:limit={(e) => {
            setColumnLimit(column, e.detail)
          }}
        >
          <DimensionTitle
            info={columnInfo}
            category={column}
            {space}
            on:accent-color={(ev) => {
              setAccentColor(index, ev)
            }}
          />
        </BoardColumnHeader>
      </svelte:fragment>
      <svelte:fragment slot="lane-header" let:lane let:level>
        {#if level === 0 || subLaneInfo === undefined}
          <DimensionTitle info={lanesInfo} category={lane.category} {space} accent={false} />
        {:else}
          <DimensionTitle info={subLaneInfo} category={lane.category} {space} accent={false} />
        {/if}
      </svelte:fragment>
      <svelte:fragment slot="cell-footer" let:lane let:column>
        {#if space !== undefined && !$restrictionStore.readonly}
          {@const values = draftValuesFor(column, lane.path)}
          {#if values !== undefined}
            <AddItemRow project={space} {values} compact placement={'below'} />
          {/if}
        {/if}
      </svelte:fragment>
      <svelte:fragment slot="card" let:object>
        {#key object._id}
          <CardFieldRenderer issue={toIssue(object)} {config} {space} {currentProject} />
        {/key}
      </svelte:fragment>
      <svelte:fragment slot="aside">
        <HiddenColumnsPanel
          columns={hiddenPanel}
          on:show={(e) => {
            showColumn(e.detail)
          }}
        >
          <svelte:fragment slot="title" let:category>
            <DimensionTitle info={columnInfo} {category} {space} accent={false} />
          </svelte:fragment>
        </HiddenColumnsPanel>
      </svelte:fragment>
    </BoardLanes>
  {:else if grid !== undefined}
    <Loading />
  {:else}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <KanbanUI
      bind:this={kanbanUI}
      categories={columns.visible}
      {dontUpdateRank}
      {_class}
      query={resultQuery}
      options={resultOptions}
      objects={visibleTasks}
      getGroupByValues={(groupByDocs, category) => groupByDocs[categoryKey(category)] ?? []}
      setGroupByValues={(groupByDocs, category, docs) => {
        groupByDocs[categoryKey(category)] = docs
      }}
      {getUpdateProps}
      {groupByDocs}
      groupByKey={columnKey}
      getGroupQuery={isCustomDimensionKey(columnKey) ? getIdsQuery : undefined}
      on:obj-focus={(evt) => {
        listProvider.updateFocus(evt.detail)
      }}
      getAvailableCategories={async (doc) => await getAvailableCategories(columnKey, columnCategories, doc)}
      selection={listProvider.current($focusStore)}
      checked={$selection ?? []}
      on:check={(evt) => {
        listProvider.updateSelection(evt.detail.docs, evt.detail.value)
      }}
      on:contextmenu={(evt) => {
        showMenu(evt.detail.evt, { object: evt.detail.objects, baseMenuClass })
      }}
    >
      <svelte:fragment slot="header" let:state let:count let:index>
        {@const color = accentColors.get(`${index}${$themeStore.dark}${columnKey}`)}
        <BoardColumnHeader
          background={color?.background ?? defaultBackground($themeStore.dark)}
          titleColor={color?.title ?? 'var(--theme-caption-color)'}
          {count}
          limit={limits[categoryKey(state)]}
          total={columnTotal?.(groupByDocs[categoryKey(state)] ?? [])}
          readonly={$restrictionStore.readonly}
          on:add={() => {
            addIssue(state)
          }}
          on:hide={() => {
            hideColumn(state)
          }}
          on:limit={(e) => {
            setColumnLimit(state, e.detail)
          }}
        >
          <DimensionTitle
            info={columnInfo}
            category={state}
            {space}
            on:accent-color={(ev) => {
              setAccentColor(index, ev)
            }}
          />
        </BoardColumnHeader>
      </svelte:fragment>
      <svelte:fragment slot="card" let:object>
        {#key object._id}
          <CardFieldRenderer issue={toIssue(object)} {config} {space} {currentProject} />
        {/key}
      </svelte:fragment>
      <svelte:fragment slot="afterCard" let:state>
        {#if space !== undefined && !$restrictionStore.readonly}
          {@const values = draftValuesFor(state)}
          {#if values !== undefined}
            <AddItemRow project={space} {values} compact placement={'below'} />
          {/if}
        {/if}
      </svelte:fragment>
      <svelte:fragment slot="afterPanel">
        <HiddenColumnsPanel
          columns={hiddenPanel}
          on:show={(e) => {
            showColumn(e.detail)
          }}
        >
          <svelte:fragment slot="title" let:category>
            <DimensionTitle info={columnInfo} {category} {space} accent={false} />
          </svelte:fragment>
        </HiddenColumnsPanel>
      </svelte:fragment>
    </KanbanUI>
  {/if}
{/if}
