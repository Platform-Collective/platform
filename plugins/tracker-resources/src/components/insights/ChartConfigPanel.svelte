<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { translate, type IntlString } from '@hcengineering/platform'
  import type { InsightAggregate, InsightDateBucket, InsightLayout } from '@hcengineering/tracker'
  import { DropdownLabels, DropdownLabelsIntl, Label, themeStore, type DropdownIntlItem, type DropdownTextItem } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import {
    allowsDateAxis,
    INSIGHT_AGGREGATES,
    INSIGHT_DATE_BUCKETS,
    INSIGHT_LAYOUTS,
    withGroupField,
    withLayout,
    withXField,
    withYAxis,
    type ChartConfig
  } from '../../insights/config'
  import type { ChartFields } from '../../insights/fields'
  import tracker from '../../plugin'

  // The configuration panel of a chart (GitHub's "Configure"): layout, X-axis, group by and Y-axis. It edits a draft
  // of the config and reports every change; saving is up to the host. The config must be resolved against the fields.
  export let config: ChartConfig
  export let fields: ChartFields
  export let readonly: boolean = false

  const dispatch = createEventDispatcher<{ change: ChartConfig }>()

  const layoutLabels: Record<InsightLayout, IntlString> = {
    bar: tracker.string.InsightLayoutBar,
    column: tracker.string.InsightLayoutColumn,
    stackedBar: tracker.string.InsightLayoutStackedBar,
    stackedColumn: tracker.string.InsightLayoutStackedColumn,
    stackedArea: tracker.string.InsightLayoutStackedArea,
    line: tracker.string.InsightLayoutLine
  }
  const aggregateLabels: Record<InsightAggregate, IntlString> = {
    count: tracker.string.InsightYCount,
    sum: tracker.string.InsightYSum,
    avg: tracker.string.InsightYAverage,
    min: tracker.string.InsightYMinimum,
    max: tracker.string.InsightYMaximum
  }
  const bucketLabels: Record<InsightDateBucket, IntlString> = {
    day: tracker.string.InsightBucketDay,
    week: tracker.string.InsightBucketWeek,
    month: tracker.string.InsightBucketMonth
  }

  const NONE = '__none__'

  let noneLabel = ''
  $: void translate(tracker.string.InsightGroupByNone, {}, $themeStore.language).then((res) => {
    noneLabel = res
  })

  const layoutItems: DropdownIntlItem[] = INSIGHT_LAYOUTS.map((id) => ({ id, label: layoutLabels[id] }))
  const aggregateItems: DropdownIntlItem[] = INSIGHT_AGGREGATES.map((id) => ({ id, label: aggregateLabels[id] }))
  const bucketItems: DropdownIntlItem[] = INSIGHT_DATE_BUCKETS.map((id) => ({ id, label: bucketLabels[id] }))

  // Text and number fields cannot be on the X-axis, a date only where the layout is drawn over time
  $: axisItems = fields.axis
    .filter((f) => f.kind === 'category' || allowsDateAxis(config.layout))
    .map((f): DropdownTextItem => ({ id: f.id, label: f.label }))
  $: groupItems = [
    { id: NONE, label: noneLabel },
    ...fields.groups.filter((f) => f.id !== config.xField).map((f): DropdownTextItem => ({ id: f.id, label: f.label }))
  ]
  $: numberItems = fields.numbers.map((f): DropdownTextItem => ({ id: f.id, label: f.label }))
  $: xIsDate = fields.byId.get(config.xField)?.kind === 'date'

  function change (next: ChartConfig): void {
    if (!readonly) dispatch('change', next)
  }

  function setAggregate (type: InsightAggregate): void {
    // A number field is needed for everything but the count: the first one until the user picks another
    const field = config.yAggregate.field ?? fields.numbers[0]?.id
    change(withYAxis(config, type, field))
  }
</script>

<div class="config" data-id="insight-config">
  <div class="row">
    <span class="caption"><Label label={tracker.string.InsightLayout} /></span>
    <DropdownLabelsIntl
      items={layoutItems}
      selected={config.layout}
      kind={'regular'}
      size={'medium'}
      width={'100%'}
      justify={'left'}
      disabled={readonly}
      dataId={'insight-layout'}
      on:selected={(e) => {
        if (e.detail !== config.layout) change(withLayout(config, e.detail, fields))
      }}
    />
  </div>

  <div class="row">
    <span class="caption"><Label label={tracker.string.InsightXAxis} /></span>
    <DropdownLabels
      items={axisItems}
      selected={config.xField}
      kind={'regular'}
      size={'medium'}
      width={'100%'}
      justify={'left'}
      enableSearch={false}
      disabled={readonly}
      dataId={'insight-x-axis'}
      on:selected={(e) => {
        if (e.detail !== undefined && e.detail !== config.xField) change(withXField(config, e.detail, fields))
      }}
    />
  </div>

  {#if xIsDate}
    <div class="row">
      <span class="caption"><Label label={tracker.string.InsightDateBucket} /></span>
      <DropdownLabelsIntl
        items={bucketItems}
        selected={config.xBucket ?? 'week'}
        kind={'regular'}
        size={'medium'}
        width={'100%'}
        justify={'left'}
        disabled={readonly}
        dataId={'insight-bucket'}
        on:selected={(e) => {
          change({ ...config, xBucket: e.detail })
        }}
      />
    </div>
  {/if}

  <div class="row">
    <span class="caption"><Label label={tracker.string.InsightGroupBy} /></span>
    <DropdownLabels
      items={groupItems}
      selected={config.groupField ?? NONE}
      kind={'regular'}
      size={'medium'}
      width={'100%'}
      justify={'left'}
      enableSearch={false}
      disabled={readonly}
      dataId={'insight-group-by'}
      on:selected={(e) => {
        if (e.detail === undefined) return
        change(withGroupField(config, e.detail === NONE ? undefined : e.detail))
      }}
    />
  </div>

  <div class="row">
    <span class="caption"><Label label={tracker.string.InsightYAxis} /></span>
    <DropdownLabelsIntl
      items={aggregateItems}
      selected={config.yAggregate.type}
      kind={'regular'}
      size={'medium'}
      width={'100%'}
      justify={'left'}
      disabled={readonly}
      dataId={'insight-y-axis'}
      on:selected={(e) => {
        if (e.detail !== config.yAggregate.type) setAggregate(e.detail)
      }}
    />
    {#if config.yAggregate.type !== 'count'}
      <DropdownLabels
        items={numberItems}
        selected={config.yAggregate.field}
        kind={'regular'}
        size={'medium'}
        width={'100%'}
        justify={'left'}
        enableSearch={false}
        disabled={readonly}
        dataId={'insight-y-field'}
        on:selected={(e) => {
          if (e.detail !== undefined) change(withYAxis(config, config.yAggregate.type, e.detail))
        }}
      />
    {/if}
  </div>
</div>

<style lang="scss">
  .config {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-width: 0;
  }
  .caption {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--theme-dark-color);
  }
</style>
