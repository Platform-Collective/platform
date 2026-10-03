<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { type Ref } from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient, MessageBox } from '@hcengineering/presentation'
  import type { InsightChart, Issue, Project } from '@hcengineering/tracker'
  import {
    Button,
    ButtonIcon,
    eventToHTMLElement,
    Icon,
    IconAdd,
    IconBack,
    Label,
    Menu,
    showPopup,
    themeStore,
    tooltip,
    type Action
  } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import {
    duplicateViewName,
    EditBoxPopup,
    FilterQueryBar,
    filterGrammar,
    nextViewName,
    restrictionStore
  } from '@hcengineering/view-resources'
  import { createEventDispatcher, onDestroy } from 'svelte'

  import { formatSumValue } from '../../fieldSum/sum'
  import { computeChart, type ChartData } from '../../insights/aggregate'
  import { buildChartRequest } from '../../insights/build'
  import { seriesColor } from '../../insights/colors'
  import {
    chartDocData,
    chartDocUpdate,
    configOfChart,
    DEFAULT_CHART_ID,
    defaultChartConfig,
    isChartDirty,
    nextChartPosition,
    resolveChartConfig,
    sortCharts,
    type ChartConfig
  } from '../../insights/config'
  import { cellFilter } from '../../insights/drill'
  import { buildChartFields, chartProjection } from '../../insights/fields'
  import { exceedsScanLimit } from '../../projectFields/query'
  import tracker from '../../plugin'
  import ChartCanvas from './charts/ChartCanvas.svelte'
  import ChartLegend from './charts/ChartLegend.svelte'
  import ChartConfigPanel from './ChartConfigPanel.svelte'

  // The Insights page of a project (GitHub Projects "Insights", current charts): a sidebar of saved charts, the
  // filter and the chart of the selected one, and the configuration panel. A chart is computed on the client over a
  // bounded scan of the project's issues. Nothing is saved until the user asks to: the draft is compared with the
  // saved chart to show the unsaved changes, and a project without charts shows the default one until it is saved.
  export let space: Ref<Project>
  // The filter schema of the project, see `buildIssueFilterSchema`
  export let filterSchema: filterGrammar.FieldSpec[]
  export let filterCtx: filterGrammar.FilterContext
  // Status ids in the order of the workflow
  export let statusOrder: string[] = []
  export let scanLimit: number

  const dispatch = createEventDispatcher<{ close: undefined, open: { filter: string } }>()
  const client = getClient()

  // ---- strings ----
  let strings: Record<string, string> = {}
  $: void loadStrings($themeStore.language)
  async function loadStrings (lang: string): Promise<void> {
    const keys: Array<[string, any, Record<string, any>?]> = [
      ['defaultName', tracker.string.InsightDefaultChartName],
      ['prefix', tracker.string.InsightChartNamePrefix],
      ['count', tracker.string.InsightYCount],
      ['sum', tracker.string.InsightYTitleSum, { field: '{{field}}' }],
      ['avg', tracker.string.InsightYTitleAverage, { field: '{{field}}' }],
      ['min', tracker.string.InsightYTitleMinimum, { field: '{{field}}' }],
      ['max', tracker.string.InsightYTitleMaximum, { field: '{{field}}' }],
      ['none', tracker.string.NoFieldValue, { field: '{{field}}' }],
      ['items', tracker.string.InsightItems, { count: '{{count}}' }],
      ['status', tracker.string.Status],
      ['priority', tracker.string.Priority],
      ['assignee', tracker.string.Assignee],
      ['label', tracker.string.Labels],
      ['component', tracker.string.Component],
      ['milestone', tracker.string.Milestone],
      ['due', tracker.string.DueDate],
      ['start', tracker.string.StartDate],
      ['deadline', tracker.string.InsightFieldDeadline],
      ['estimate', tracker.string.Estimation]
    ]
    const entries = await Promise.all(keys.map(async ([key, str, params]) => [key, await translate(str, params ?? {}, lang)] as const))
    strings = Object.fromEntries(entries)
  }
  const fill = (template: string | undefined, params: Record<string, string>): string =>
    Object.entries(params).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, value), template ?? '')

  // ---- the fields a chart can use ----
  $: chartFields = buildChartFields({
    schema: filterSchema,
    labels: new Map(
      ['status', 'priority', 'assignee', 'label', 'component', 'milestone', 'due', 'start', 'deadline', 'estimate']
        .filter((name) => strings[name] !== undefined)
        .map((name) => [name, strings[name]])
    ),
    statusOrder
  })

  // ---- saved charts ----
  interface Tab {
    _id: string
    name: string
    doc?: InsightChart
  }

  const chartsQuery = createQuery()
  let charts: InsightChart[] = []
  let chartsLoaded = false
  $: chartsQuery.query(tracker.class.InsightChart, { space }, (res) => {
    charts = res
    chartsLoaded = true
  })
  onDestroy(() => {
    chartsQuery.unsubscribe()
    scanQuery.unsubscribe()
  })

  $: sorted = sortCharts(charts)
  // A project without charts shows the default one; it is stored when it is saved
  $: tabs = ((): Tab[] => {
    if (!chartsLoaded) return []
    if (sorted.length > 0) return sorted.map((doc) => ({ _id: doc._id, name: doc.name, doc }))
    return [{ _id: DEFAULT_CHART_ID, name: strings.defaultName ?? '' }]
  })()

  const activeKey = (): string => `tracker.insights.active.${space}`
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
  // A chart that was just created becomes known to the live query a moment later
  let awaitingId: string | undefined
  $: found = tabs.find((it) => it._id === activeId)
  $: if (found !== undefined && awaitingId === activeId) awaitingId = undefined
  $: active = found ?? (awaitingId !== undefined ? undefined : tabs[0])

  function select (tab: Tab): void {
    activeId = tab._id
    storeActive(tab._id)
  }

  // ---- the draft: the configuration being edited ----
  $: baseline = active?.doc !== undefined ? configOfChart(active.doc) : defaultChartConfig()
  let draft: ChartConfig = defaultChartConfig()
  let draftId: string | undefined
  let draftBaseline = ''

  // Switching charts takes the saved configuration; a saved chart that changes elsewhere is taken too, unless the
  // draft has changes of its own against what it was started from
  function syncDraft (id: string | undefined, base: ChartConfig): void {
    const key = JSON.stringify(base)
    if (id !== draftId) {
      draftId = id
      draftBaseline = key
      draft = { ...base }
      return
    }
    if (key !== draftBaseline) {
      const wasDirty = isChartDirty(JSON.parse(draftBaseline), draft)
      draftBaseline = key
      if (!wasDirty) draft = { ...base }
    }
  }
  $: syncDraft(active?._id, baseline)

  $: dirty = active !== undefined && isChartDirty(baseline, draft, chartFields)
  $: resolved = resolveChartConfig(draft, chartFields)
  // A field of the chart was removed from the project: the chart is drawn with what is left
  $: fieldsFallback =
    chartFields.byId.size > 0 &&
    (resolved.xField !== draft.xField ||
      (resolved.groupField ?? '') !== (draft.groupField ?? '') ||
      resolved.yAggregate.type !== draft.yAggregate.type)

  // ---- the data: a bounded scan of the issues ----
  const scanQuery = createQuery()
  let scanned: Array<Partial<Issue>> = []
  let scanReady = false

  interface CompiledChartFilter {
    invalid: boolean
    // The part of the filter the server applies, with the rule that archived items are left out unless the filter asks
    // for them (`is:archived`)
    query: Record<string, any>
    // What is left to the client
    residual: filterGrammar.Node | undefined
    predicate: (doc: any) => boolean
  }

  function compileChartFilter (text: string, schema: filterGrammar.FieldSpec[], ctx: filterGrammar.FilterContext): CompiledChartFilter {
    const res = filterGrammar.compileFilter(text, schema, ctx)
    if (res.ok === false) return { invalid: true, query: {}, residual: undefined, predicate: () => true }
    return {
      invalid: false,
      query: { ...res.value.query, ...filterGrammar.archiveScopeQuery(res.value.ast) },
      residual: res.value.residual,
      predicate: res.value.predicate
    }
  }

  // A filter that does not parse (it refers to a field that was removed) is not applied: the chart is not drawn
  $: compiled = compileChartFilter(resolved.filter, filterSchema, filterCtx)
  $: filterInvalid = compiled.invalid
  $: serverQuery = compiled.query
  $: residual = compiled.residual
  $: predicate = compiled.predicate

  $: projection = ((): Record<string, 1> => {
    const res: Record<string, 1> = {}
    const props = [
      ...chartProjection([
        chartFields.byId.get(resolved.xField),
        resolved.groupField !== undefined ? chartFields.byId.get(resolved.groupField) : undefined,
        resolved.yAggregate.field !== undefined ? chartFields.byId.get(resolved.yAggregate.field) : undefined
      ]),
      ...filterGrammar.referencedProperties(residual)
    ]
    for (const key of props) res[key] = 1
    return res
  })()

  // The scan is capped at limit + 1, so that going over the limit is seen without loading everything
  $: if (!filterInvalid && chartFields.byId.size > 0) {
    scanQuery.query(
      tracker.class.Issue,
      { space, ...serverQuery } as any,
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

  $: overLimit = scanReady && exceedsScanLimit(scanned.length, scanLimit)
  $: docs = scanReady && !overLimit ? scanned.filter(predicate) : undefined
  $: request = docs !== undefined ? buildChartRequest(docs, resolved, chartFields, (field) => fill(strings.none, { field })) : undefined
  let data: ChartData | undefined
  $: data = request !== undefined ? computeChart(request) : undefined

  // ---- what the chart shows about itself ----
  $: xLabel = chartFields.byId.get(resolved.xField)?.label ?? ''
  $: yField = resolved.yAggregate.field !== undefined ? chartFields.byId.get(resolved.yAggregate.field)?.label : undefined
  $: yTitle =
    resolved.yAggregate.type === 'count' || yField === undefined
      ? (strings.count ?? '')
      : fill(strings[resolved.yAggregate.type], { field: yField })
  $: colors = (data?.series ?? []).map((s, i) => seriesColor(s, i, $themeStore.dark))
  $: legend = data !== undefined && data.series.length > 0 && data.series[0].label !== ''
    ? data.series.map((s, i) => ({ label: s.label, color: colors[i] }))
    : []
  $: chartLabel = `${active?.name ?? ''}: ${yTitle} · ${xLabel}`
  const formatItems = (count: number): string => fill(strings.items, { count: formatSumValue(count) })

  function open (e: CustomEvent<{ category: number, series: number | undefined }>): void {
    if (data === undefined) return
    const category = data.categories[e.detail.category]
    const series = e.detail.series !== undefined ? data.series[e.detail.series] : undefined
    if (category === undefined) return
    dispatch('open', { filter: cellFilter(resolved, chartFields, category, series) })
  }

  // ---- persistence ----
  async function createChart (name: string, config: ChartConfig, position: number): Promise<Ref<InsightChart>> {
    return await client.createDoc(tracker.class.InsightChart, space, chartDocData(name, config, position))
  }

  function activateCreated (id: Ref<InsightChart>): void {
    awaitingId = id
    activeId = id
    storeActive(id)
  }

  const names = (): string[] => tabs.map((it) => it.name)

  // Makes sure the tab is a stored chart; the default one is stored on demand
  async function ensureStored (tab: Tab, config: ChartConfig): Promise<InsightChart | undefined> {
    if (tab.doc !== undefined) return tab.doc
    const id = await createChart(tab.name, config, 0)
    activateCreated(id)
    return await client.findOne(tracker.class.InsightChart, { _id: id })
  }

  async function saveChanges (): Promise<void> {
    if (active === undefined || !dirty) return
    if (active.doc === undefined) {
      await ensureStored(active, draft)
      return
    }
    await client.update(active.doc, chartDocUpdate(draft))
  }

  async function saveAsNew (): Promise<void> {
    const name = nextViewName(names(), strings.prefix ?? '')
    activateCreated(await createChart(name, draft, nextChartPosition(sorted)))
  }

  function discard (): void {
    draft = { ...baseline }
  }

  async function newChart (): Promise<void> {
    // A project showing only the unsaved default chart stores it first, so that it is not lost
    if (active !== undefined && active.doc === undefined) await ensureStored(active, draft)
    const name = nextViewName(names(), strings.prefix ?? '')
    activateCreated(await createChart(name, defaultChartConfig(), nextChartPosition(sorted) + (sorted.length === 0 ? 1 : 0)))
  }

  async function duplicate (tab: Tab): Promise<void> {
    const source = tab.doc !== undefined ? configOfChart(tab.doc) : defaultChartConfig()
    const name = duplicateViewName(tab.name, names())
    if (tab.doc === undefined) await ensureStored(tab, source)
    activateCreated(await createChart(name, source, nextChartPosition(sorted) + (sorted.length === 0 ? 1 : 0)))
  }

  async function rename (tab: Tab, name: string): Promise<void> {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed === tab.name) return
    const doc = await ensureStored(tab, tab._id === active?._id ? draft : defaultChartConfig())
    if (doc !== undefined) await client.update(doc, { name: trimmed })
  }

  function remove (tab: Tab): void {
    const doc = tab.doc
    if (doc === undefined) return
    showPopup(MessageBox, {
      label: tracker.string.InsightDelete,
      message: tracker.string.InsightDeleteConfirm,
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

  function showTabMenu (ev: MouseEvent, tab: Tab): void {
    const el = eventToHTMLElement(ev)
    const actions: Action[] = [
      {
        label: tracker.string.InsightRename,
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
        label: tracker.string.InsightDuplicate,
        icon: view.icon.Copy,
        action: async () => {
          await duplicate(tab)
        }
      }
    ]
    if (tab.doc !== undefined) {
      actions.push({
        label: tracker.string.InsightDelete,
        icon: view.icon.Delete,
        group: 'remove',
        action: async () => {
          remove(tab)
        }
      })
    }
    showPopup(Menu, { actions }, el)
  }

  function changeConfig (e: CustomEvent<ChartConfig>): void {
    draft = e.detail
  }
  function applyFilter (e: CustomEvent<string>): void {
    draft = { ...draft, filter: e.detail }
  }
</script>

<div class="insights" data-id="insights-panel">
  <div class="header">
    <ButtonIcon
      icon={IconBack}
      size={'small'}
      kind={'tertiary'}
      tooltip={{ label: tracker.string.InsightsClose }}
      dataId={'insights-close'}
      on:click={() => {
        dispatch('close')
      }}
    />
    <span class="title"><Label label={tracker.string.Insights} /></span>
  </div>

  <div class="body">
    <aside class="sidebar">
      <div class="sidebar-title"><Label label={tracker.string.InsightCharts} /></div>
      <div class="list" role="tablist">
        {#each tabs as tab (tab._id)}
          {@const selected = active?._id === tab._id}
          <div
            class="item"
            class:selected
            role="tab"
            tabindex="0"
            aria-selected={selected}
            data-id="insight-tab"
            on:click={() => {
              select(tab)
            }}
            on:keydown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') select(tab)
            }}
            on:contextmenu={(ev) => {
              if (!$restrictionStore.readonly) {
                ev.preventDefault()
                showTabMenu(ev, tab)
              }
            }}
          >
            <span class="name" title={tab.name}>{tab.name}</span>
            {#if selected && dirty}
              <span class="dirty" use:tooltip={{ label: tracker.string.InsightUnsaved }} data-id="insight-dirty" />
            {/if}
            {#if !$restrictionStore.readonly}
              <button
                class="menu-button"
                type="button"
                aria-label="menu"
                on:click|stopPropagation={(ev) => {
                  showTabMenu(ev, tab)
                }}
              >
                <Icon icon={view.icon.MoreH} size={'small'} />
              </button>
            {/if}
          </div>
        {/each}
      </div>
      {#if !$restrictionStore.readonly}
        <div class="new">
          <Button
            kind={'ghost'}
            size={'small'}
            icon={IconAdd}
            label={tracker.string.InsightNewChart}
            dataId={'insight-new'}
            on:click={() => {
              void newChart()
            }}
          />
        </div>
      {/if}
    </aside>

    <main class="main">
      {#if active !== undefined}
        <div class="toolbar">
          <span class="chart-name" title={active.name}>{active.name}</span>
          {#if dirty && !$restrictionStore.readonly}
            <div class="dirty-actions">
              <Button kind={'ghost'} size={'small'} label={tracker.string.InsightDiscard} on:click={discard} />
              <Button
                kind={'regular'}
                size={'small'}
                label={tracker.string.InsightSaveAsNew}
                dataId={'insight-save-new'}
                on:click={() => {
                  void saveAsNew()
                }}
              />
              <Button
                kind={'primary'}
                size={'small'}
                label={tracker.string.InsightSave}
                dataId={'insight-save'}
                on:click={() => {
                  void saveChanges()
                }}
              />
            </div>
          {/if}
        </div>
        <FilterQueryBar value={draft.filter} schema={filterSchema} on:apply={applyFilter} />
        {#if fieldsFallback}
          <div class="notice" role="status"><Label label={tracker.string.InsightFieldRemoved} /></div>
        {/if}
        {#if filterInvalid}
          <div class="notice error" role="alert" data-id="insight-filter-invalid">
            <Label label={tracker.string.InsightFilterInvalid} />
          </div>
        {/if}
        {#if overLimit}
          <div class="notice error" role="alert" data-id="insight-scan-limit">
            <Label label={tracker.string.InsightScanLimitExceeded} params={{ limit: scanLimit }} />
          </div>
        {/if}
        <div class="chart-area">
          {#if data !== undefined}
            <div class="summary">
              <span class="y-title">{yTitle}</span>
              <span class="x-title">{xLabel}</span>
              <span class="items">{formatItems(data.items)}</span>
            </div>
            {#if data.categories.length === 0}
              <div class="empty" data-id="insight-empty"><Label label={tracker.string.InsightNoData} /></div>
            {:else}
              <ChartCanvas
                {data}
                layout={resolved.layout}
                {colors}
                label={chartLabel}
                valueLabel={yTitle}
                {formatItems}
                on:select={open}
              />
              <ChartLegend items={legend} />
              <div class="hint"><Label label={tracker.string.InsightOpenIssues} /></div>
            {/if}
          {:else if !overLimit && !filterInvalid}
            <div class="empty">…</div>
          {/if}
        </div>
      {/if}
    </main>

    <aside class="configure">
      <div class="sidebar-title"><Label label={tracker.string.InsightConfigure} /></div>
      {#if active !== undefined}
        <ChartConfigPanel config={resolved} fields={chartFields} readonly={$restrictionStore.readonly} on:change={changeConfig} />
      {/if}
    </aside>
  </div>
</div>

<style lang="scss">
  .insights {
    position: absolute;
    inset: 0;
    z-index: 102;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--theme-bg-color);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    padding: 0 1rem;
    min-height: 3rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .title {
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .body {
    display: flex;
    flex: 1 1 0;
    min-height: 0;
  }
  .sidebar,
  .configure {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 15rem;
    min-height: 0;
    overflow-y: auto;
    background: var(--theme-bg-color);
  }
  .sidebar {
    border-right: 1px solid var(--theme-divider-color);
  }
  .configure {
    width: 17rem;
    border-left: 1px solid var(--theme-divider-color);
  }
  .sidebar-title {
    padding: 0.75rem 1rem 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    color: var(--theme-dark-color);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.25rem 0.5rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.25rem 0.375rem 0.5rem;
    border-radius: 0.25rem;
    color: var(--theme-content-color);
    cursor: pointer;
    user-select: none;

    &:hover,
    &:focus-visible {
      background: var(--theme-popup-hover);
      color: var(--theme-caption-color);
    }
    &.selected {
      background: var(--highlight-select, var(--theme-popup-hover));
      color: var(--theme-caption-color);
      font-weight: 500;
    }
  }
  .name {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirty {
    flex-shrink: 0;
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
  .item:hover .menu-button,
  .item.selected .menu-button,
  .menu-button:focus-visible {
    opacity: 1;
  }
  .new {
    padding: 0.25rem 0.5rem 0.75rem;
  }
  .main {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-shrink: 0;
    padding: 0.5rem 1rem;
    min-height: 2.5rem;
  }
  .chart-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1rem;
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .dirty-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: 0.25rem;
  }
  .notice {
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);
    border-bottom: 1px solid var(--theme-divider-color);

    &.error {
      color: var(--theme-error-color, #d73a49);
    }
  }
  .chart-area {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    min-width: 0;
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem 1rem;
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
  }
  .y-title {
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .empty {
    padding: 3rem 1rem;
    text-align: center;
    color: var(--theme-dark-color);
  }
  .hint {
    padding: 0 1rem;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }

  @media (max-width: 60rem) {
    .body {
      flex-direction: column;
      overflow-y: auto;
    }
    .sidebar,
    .configure {
      width: auto;
      border: none;
      border-bottom: 1px solid var(--theme-divider-color);
      overflow: visible;
    }
    .main {
      overflow: visible;
      flex: none;
    }
  }
</style>
