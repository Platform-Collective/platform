<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { InsightLayout } from '@hcengineering/tracker'
  import { createEventDispatcher } from 'svelte'

  import type { ChartData } from '../../../insights/aggregate'
  import { isHorizontalLayout } from '../../../insights/config'
  import {
    categoryLabelWidth,
    CHAR_WIDTH,
    computeGeometry,
    truncateLabel,
    type Margins
  } from '../../../insights/layout'
  import { formatSumValue } from '../../../fieldSum/sum'

  // One SVG chart: bars, columns, lines or stacked areas with axes, gridlines and a tooltip. The shapes come from
  // `computeGeometry`; this component only draws them and reports clicks and hovers.
  export let data: ChartData
  export let layout: InsightLayout
  // Color of each series, in the order of `data.series`
  export let colors: string[] = []
  // Description of the whole chart, read by screen readers
  export let label: string = ''
  // Name of the Y value, e.g. "Count of items"
  export let valueLabel: string = ''
  // "{n} issues" for the tooltip
  export let formatItems: (count: number) => string = (count) => String(count)

  const dispatch = createEventDispatcher<{ select: { category: number, series: number | undefined } }>()

  let width = 640
  $: horizontal = isHorizontalLayout(layout)
  $: grouped = data.series.length > 1 || (data.series[0]?.label ?? '') !== ''
  // Horizontal charts grow with their categories so that the labels stay readable
  $: height = horizontal ? Math.max(260, data.categories.length * 30 + 56) : 360

  // The margins make room for the labels of the axes
  $: margins = computeMargins(data, layout, width, height)
  $: geometry = computeGeometry(data, layout, { width, height }, margins)

  function computeMargins (chart: ChartData, kind: InsightLayout, w: number, h: number): Margins {
    if (isHorizontalLayout(kind)) {
      return { top: 12, right: 24, bottom: 30, left: categoryLabelWidth(chart.categories.map((c) => c.label)) }
    }
    // The value axis is on the left: a first pass of the geometry tells how wide its labels are
    const probe = computeGeometry(chart, kind, { width: w, height: h }, { top: 12, right: 16, bottom: 40, left: 48 })
    const tickWidth = Math.max(...probe.valueTicks.map((t) => t.label.length), 1) * CHAR_WIDTH + 14
    return { top: 12, right: 16, bottom: 40, left: Math.max(36, Math.ceil(tickWidth)) }
  }

  function categoryText (index: number): string {
    const tick = geometry.categoryTicks[index]
    const room = horizontal ? margins.left - 12 : tick.band - 6
    return truncateLabel(data.categories[index].label, Math.floor(room / CHAR_WIDTH))
  }

  // ---- hover ----
  interface Hover {
    x: number
    y: number
    category: number
    // The series the tooltip is about; all of them when undefined
    series: number | undefined
  }
  let hover: Hover | undefined
  let wrap: HTMLElement | undefined

  function show (ev: MouseEvent | FocusEvent, category: number, series: number | undefined): void {
    const box = wrap?.getBoundingClientRect()
    if (box === undefined) return
    if (ev instanceof MouseEvent) {
      hover = { x: ev.clientX - box.left, y: ev.clientY - box.top, category, series }
      return
    }
    const target = (ev.currentTarget as Element).getBoundingClientRect()
    hover = { x: target.left - box.left + target.width / 2, y: target.top - box.top, category, series }
  }

  function hide (): void {
    hover = undefined
  }

  function select (category: number, series: number | undefined): void {
    dispatch('select', { category, series })
  }

  function onKey (ev: KeyboardEvent, category: number, series: number | undefined): void {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      select(category, series)
    }
  }

  function valueText (value: number | null): string {
    return value === null ? '–' : formatSumValue(value)
  }

  function markLabel (category: number, series: number): string {
    const s = data.series[series]
    const name = s.label !== '' ? `${data.categories[category].label}, ${s.label}` : data.categories[category].label
    return `${name}: ${valueText(data.values[series][category])}`
  }

  $: hoverRows =
    hover === undefined
      ? []
      : data.series
        .map((s, i) => ({ index: i, label: s.label, value: data.values[i][hover?.category ?? 0], items: data.counts[i][hover?.category ?? 0] }))
        .filter((row) => (hover?.series === undefined ? row.items > 0 || row.value !== null : row.index === hover.series))
  $: tooltipLeft = hover === undefined ? 0 : Math.min(Math.max(8, hover.x + 12), Math.max(8, width - 190))
  $: tooltipTop = hover === undefined ? 0 : Math.max(4, hover.y - 8)
  $: continuous = layout === 'line' || layout === 'stackedArea'
</script>

<div class="chart" bind:this={wrap} bind:clientWidth={width} data-id="insight-chart">
  <svg {width} {height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    <!-- Gridlines and the labels of the value axis -->
    {#each geometry.valueTicks as tick}
      {#if horizontal}
        <line class="grid" x1={tick.position} x2={tick.position} y1={geometry.plot.y} y2={geometry.plot.y + geometry.plot.height} />
        <text class="tick" x={tick.position} y={geometry.plot.y + geometry.plot.height + 16} text-anchor="middle">{tick.label}</text>
      {:else}
        <line class="grid" x1={geometry.plot.x} x2={geometry.plot.x + geometry.plot.width} y1={tick.position} y2={tick.position} />
        <text class="tick" x={geometry.plot.x - 8} y={tick.position} text-anchor="end" dominant-baseline="central">{tick.label}</text>
      {/if}
    {/each}
    <!-- The baseline -->
    {#if horizontal}
      <line class="axis" x1={geometry.baseline} x2={geometry.baseline} y1={geometry.plot.y} y2={geometry.plot.y + geometry.plot.height} />
    {:else}
      <line class="axis" x1={geometry.plot.x} x2={geometry.plot.x + geometry.plot.width} y1={geometry.baseline} y2={geometry.baseline} />
    {/if}
    <!-- The labels of the category axis -->
    {#each geometry.categoryTicks as tick}
      {#if tick.visible}
        {#if horizontal}
          <text class="tick" x={geometry.plot.x - 8} y={tick.center} text-anchor="end" dominant-baseline="central">
            <title>{data.categories[tick.index].label}</title>{categoryText(tick.index)}
          </text>
        {:else}
          <text class="tick" x={tick.center} y={geometry.plot.y + geometry.plot.height + 18} text-anchor="middle">
            <title>{data.categories[tick.index].label}</title>{categoryText(tick.index)}
          </text>
        {/if}
      {/if}
    {/each}

    <!-- Areas and the hit bands that report the hover of a category on a continuous axis -->
    {#each geometry.areas as area}
      {#each area.paths as path}
        <path class="area" d={path} fill={colors[area.series]} />
      {/each}
    {/each}
    {#if continuous}
      {#each geometry.categoryTicks as tick}
        <rect
          class="band"
          x={tick.center - tick.band / 2}
          y={geometry.plot.y}
          width={tick.band}
          height={geometry.plot.height}
          role="presentation"
          on:mousemove={(ev) => {
            show(ev, tick.index, undefined)
          }}
          on:mouseleave={hide}
          on:click={() => {
            select(tick.index, undefined)
          }}
        />
      {/each}
    {/if}

    {#each geometry.lines as line}
      {#each line.segments as segment}
        <path class="line" d={segment} stroke={colors[line.series]} />
      {/each}
    {/each}
    {#each geometry.lines as line}
      {#each line.points as point}
        <circle
          class="point"
          cx={point.x}
          cy={point.y}
          r="4"
          fill={colors[point.series]}
          role="button"
          tabindex="0"
          aria-label={markLabel(point.category, point.series)}
          data-id="insight-mark"
          on:mouseenter={(ev) => {
            show(ev, point.category, undefined)
          }}
          on:mouseleave={hide}
          on:focus={(ev) => {
            show(ev, point.category, point.series)
          }}
          on:blur={hide}
          on:click|stopPropagation={() => {
            select(point.category, point.series)
          }}
          on:keydown={(ev) => {
            onKey(ev, point.category, point.series)
          }}
        />
      {/each}
    {/each}

    <!-- Bars, columns and the stacked segments -->
    {#each geometry.bars as bar}
      <rect
        class="bar"
        x={bar.x}
        y={bar.y}
        width={bar.width}
        height={bar.height}
        rx="2"
        fill={colors[bar.series]}
        role="button"
        tabindex="0"
        aria-label={markLabel(bar.category, bar.series)}
        data-id="insight-mark"
        on:mouseenter={(ev) => {
          show(ev, bar.category, bar.series)
        }}
        on:mousemove={(ev) => {
          show(ev, bar.category, bar.series)
        }}
        on:mouseleave={hide}
        on:focus={(ev) => {
          show(ev, bar.category, bar.series)
        }}
        on:blur={hide}
        on:click={() => {
          select(bar.category, bar.series)
        }}
        on:keydown={(ev) => {
          onKey(ev, bar.category, bar.series)
        }}
      />
    {/each}
  </svg>

  {#if hover !== undefined}
    <div class="tooltip" style:left={`${tooltipLeft}px`} style:top={`${tooltipTop}px`} role="status" data-id="insight-tooltip">
      <div class="title">{data.categories[hover.category].label}</div>
      {#each hoverRows as row}
        <div class="row">
          {#if grouped}
            <span class="swatch" style:background={colors[row.index]} />
            <span class="name">{row.label}</span>
          {/if}
          <span class="value">{valueText(row.value)}</span>
        </div>
        <div class="items">{valueLabel} · {formatItems(row.items)}</div>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .chart {
    position: relative;
    width: 100%;
    min-width: 0;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: var(--theme-divider-color);
    stroke-width: 1;
  }
  .axis {
    stroke: var(--theme-dark-color);
    stroke-width: 1;
  }
  .tick {
    fill: var(--theme-dark-color);
    font-size: 11px;
  }
  .bar,
  .point {
    cursor: pointer;
    outline: none;

    &:hover,
    &:focus-visible {
      stroke: var(--theme-caption-color);
      stroke-width: 1.5;
    }
  }
  .area {
    fill-opacity: 0.75;
  }
  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
    pointer-events: none;
  }
  .band {
    fill: transparent;
    cursor: pointer;
  }
  .tooltip {
    position: absolute;
    z-index: 5;
    min-width: 9rem;
    max-width: 16rem;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--theme-popup-divider, var(--theme-divider-color));
    border-radius: 0.375rem;
    background: var(--theme-popup-color, var(--theme-bg-color));
    box-shadow: var(--theme-popup-shadow, 0 4px 12px rgba(0, 0, 0, 0.2));
    color: var(--theme-content-color);
    font-size: 0.75rem;
    pointer-events: none;
  }
  .title {
    margin-bottom: 0.25rem;
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .swatch {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 0.125rem;
  }
  .name {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .value {
    margin-left: auto;
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .items {
    margin-bottom: 0.25rem;
    color: var(--theme-dark-color);
  }
</style>
