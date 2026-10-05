<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import {
    RateLimiter,
    type CategoryType,
    type Class,
    type Doc,
    type DocumentQuery,
    type DocumentUpdate,
    type FindOptions,
    type Ref
  } from '@hcengineering/core'
  import { KanbanRow, type DocWithRank, type Item } from '@hcengineering/kanban'
  import { getClient } from '@hcengineering/presentation'
  import { Icon, IconChevronRight, IconDown, tooltip } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import { categoryKey } from '../../board/columns'
  import { isAvailableCategory, isNoopUpdate } from '../../board/move'
  import { cellLanes, type BoardGrid, type BoardLane } from '../../board/swimlanes'
  import tracker from '../../plugin'

  // Swimlanes of columns: every swimlane is a horizontal section that holds its own cell of every column. With a
  // second level ("Then by") a swimlane is a header over its sub-lanes, and the sub-lanes hold the cells. A card
  // is dragged between cells, which writes the value of the column and of the swimlane (and sub-lane). There is no
  // manual order of the cards inside a cell: they follow the sort of the view.
  export let _class: Ref<Class<DocWithRank>>
  export let options: FindOptions<DocWithRank> | undefined = undefined
  // Visible columns, left to right
  export let columns: CategoryType[]
  export let grid: BoardGrid<Item, CategoryType>
  // Items in the order the keyboard moves through them (see gridOrder)
  export let objects: Item[]
  // Collapsed lanes, by key; the host keeps them and is told with `toggle` when one is clicked
  export let collapsed: ReadonlySet<string> = new Set()
  export let selection: number | undefined = undefined
  export let checked: Doc[] = []
  // Full documents of the items of a cell are loaded by their ids
  export let getGroupQuery: (state: CategoryType, stateObjects: Item[]) => DocumentQuery<DocWithRank>
  // What dropping a card on a lane (the categories from the swimlane down to the lane) and a column writes;
  // undefined when the card cannot go there
  export let getUpdate: (doc: Item, lane: CategoryType[], column: CategoryType) => DocumentUpdate<Item> | undefined
  // Categories a card can be dropped on, for the columns and for the swimlanes of a level (0, or 1 for sub-lanes)
  export let getAvailableColumns: ((doc: Doc) => Promise<CategoryType[]>) | undefined = undefined
  export let getAvailableLanes: ((doc: Doc, level: number) => Promise<CategoryType[]>) | undefined = undefined

  const dispatch = createEventDispatcher()
  const client = getClient()
  const limiter = new RateLimiter(10)

  $: checkedSet = new Set<Ref<Doc>>(checked.map((it) => it._id))

  // ---- drag and drop ----
  let dragCard: Item | undefined
  let isDragging = false
  let availableColumns: CategoryType[] | undefined
  // Per level of lanes
  let availableLanes: Array<CategoryType[] | undefined> = []
  let dropCell: string | undefined

  // What is drawn: a swimlane with sub-lanes is a header, every other lane a header and a row of cells
  type Section = { lane: BoardLane<Item, CategoryType>, group: boolean }
  $: sections = grid.lanes.flatMap((lane): Section[] => {
    if (lane.subLanes.length === 0) return [{ lane, group: false }]
    return [
      { lane, group: true },
      ...(collapsed.has(lane.key) ? [] : lane.subLanes.map((sub): Section => ({ lane: sub, group: false })))
    ]
  })
  $: levels = grid.lanes.some((lane) => lane.subLanes.length > 0) ? 2 : 1

  const cellId = (lane: BoardLane<Item, CategoryType>, columnKey: string): string => `${lane.key}\u0000${columnKey}`

  async function onDragStart (object: Item): Promise<void> {
    dragCard = object
    isDragging = true
    availableColumns = undefined
    availableLanes = []
    dispatch('obj-focus', object)
    const [cols, ...lanes] = await Promise.all([
      getAvailableColumns?.(object),
      ...Array.from({ length: levels }, async (_, level) => await getAvailableLanes?.(object, level))
    ])
    if (dragCard?._id === object._id) {
      availableColumns = cols
      availableLanes = lanes
    }
  }

  function endDrag (): void {
    dragCard = undefined
    isDragging = false
    availableColumns = undefined
    availableLanes = []
    dropCell = undefined
  }

  function canDropOn (lane: BoardLane<Item, CategoryType>, column: CategoryType): boolean {
    if (dragCard === undefined) return false
    return (
      isAvailableCategory(availableColumns, column) &&
      lane.path.every((category, level) => isAvailableCategory(availableLanes[level], category))
    )
  }

  async function drop (lane: BoardLane<Item, CategoryType>, column: CategoryType): Promise<void> {
    const doc = dragCard
    const allowed = canDropOn(lane, column)
    endDrag()
    if (doc === undefined || !allowed) return
    const update = getUpdate(doc, lane.path, column)
    if (update === undefined || isNoopUpdate(doc, update)) return
    try {
      await client.diffUpdate(doc, update)
    } catch (err) {
      console.error('Failed to move the card', err)
    }
  }

  function dragOver (ev: DragEvent, lane: BoardLane<Item, CategoryType>, columnKey: string, column: CategoryType): void {
    if (!canDropOn(lane, column)) return
    ev.preventDefault()
    dropCell = cellId(lane, columnKey)
  }

  function dragLeave (ev: DragEvent, id: string): void {
    const next = ev.relatedTarget as Node | null
    if (next !== null && (ev.currentTarget as HTMLElement).contains(next)) return
    if (dropCell === id) dropCell = undefined
  }

  // ---- selection ----
  const showMenu = (evt: MouseEvent, object: Item): void => {
    selection = objects.findIndex((p) => p._id === object._id)
    if (!checkedSet.has(object._id)) {
      dispatch('check', { docs: objects, value: false })
      checked = []
    }
    dispatch('contextmenu', { evt, objects: checked.length > 0 ? checked : object })
  }

  const rows: Record<string, KanbanRow | undefined> = {}

  function locate (item: Item): { lane: BoardLane<Item, CategoryType>, cell: number, row: number } | undefined {
    for (const lane of cellLanes(grid)) {
      for (const [cell, c] of lane.cells.entries()) {
        const row = c.items.findIndex((it) => it._id === item._id)
        if (row !== -1) return { lane, cell, row }
      }
    }
    return undefined
  }

  function focus (item: Item): void {
    const at = locate(item)
    if (at !== undefined) rows[cellId(at.lane, at.lane.cells[at.cell].columnKey)]?.scroll(item)
    dispatch('obj-focus', item)
  }

  /** Moves the focus like the columns of a board do: up and down in the order of the cards, sideways to the next filled column. */
  export function select (offset: 1 | -1 | 0, of?: Doc, dir?: 'vertical' | 'horizontal'): void {
    let pos = (of != null ? objects.findIndex((it) => it._id === of._id) : selection) ?? -1
    if (pos < 0) pos = 0
    if (pos >= objects.length) pos = objects.length - 1
    const obj = objects[pos]
    if (obj === undefined) return
    if (offset === 0) {
      dispatch('obj-focus', obj)
      return
    }
    if (dir === 'horizontal') {
      const at = locate(obj)
      if (at === undefined) return
      for (let cell = at.cell + offset; cell >= 0 && cell < at.lane.cells.length; cell += offset) {
        const items = at.lane.cells[cell].items
        if (items.length > 0) {
          focus(items[Math.min(at.row, items.length - 1)])
          return
        }
      }
      return
    }
    focus(objects[Math.max(0, Math.min(objects.length - 1, pos + offset))])
  }

  function toggle (lane: BoardLane<Item, CategoryType>): void {
    dispatch('toggle', lane.key)
  }
</script>

<div class="board-lanes" data-id="board-lanes">
  <div class="scroller">
    <div class="content">
      <div class="column-headers">
        {#each columns as column, index (categoryKey(column))}
          <div class="column-header">
            <slot name="column-header" {column} {index} count={grid.columnTotals.get(categoryKey(column)) ?? 0} />
          </div>
        {/each}
      </div>
      {#each sections as { lane, group } (lane.key)}
        {@const isCollapsed = collapsed.has(lane.key)}
        <div class="lane" class:sub={lane.depth > 0} data-id="board-lane" data-lane={lane.key} data-depth={lane.depth}>
          <div class="lane-header">
            <button
              class="toggle"
              type="button"
              data-id="board-lane-toggle"
              aria-expanded={!isCollapsed}
              use:tooltip={{ label: isCollapsed ? tracker.string.BoardExpandLane : tracker.string.BoardCollapseLane }}
              on:click={() => {
                toggle(lane)
              }}
            >
              <Icon icon={isCollapsed ? IconChevronRight : IconDown} size={'small'} />
            </button>
            <span class="lane-title overflow-label">
              <slot name="lane-header" {lane} level={lane.depth} />
            </span>
            <span class="lane-count" data-id="board-lane-count">{lane.items.length}</span>
          </div>
          {#if !isCollapsed && !group}
            <div class="lane-row">
              {#each lane.cells as cell (cell.columnKey)}
                {@const id = cellId(lane, cell.columnKey)}
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div
                  class="cell"
                  class:drop-target={dropCell === id}
                  data-id="board-cell"
                  on:dragover={(ev) => {
                    dragOver(ev, lane, cell.columnKey, cell.column)
                  }}
                  on:dragleave={(ev) => {
                    dragLeave(ev, id)
                  }}
                  on:drop|preventDefault={() => {
                    void drop(lane, cell.column)
                  }}
                >
                  <KanbanRow
                    bind:this={rows[id]}
                    on:obj-focus
                    on:dragend={endDrag}
                    stateObjects={cell.items}
                    {isDragging}
                    {dragCard}
                    {objects}
                    {selection}
                    {checkedSet}
                    state={cell.column}
                    {limiter}
                    cardDragOver={() => {}}
                    cardDrop={() => {}}
                    onDragStart={(object) => {
                      void onDragStart(object)
                    }}
                    {showMenu}
                    {_class}
                    {options}
                    groupByKey={'_id'}
                    {getGroupQuery}
                  >
                    <svelte:fragment slot="card" let:object let:dragged>
                      <slot name="card" {object} {dragged} />
                    </svelte:fragment>
                  </KanbanRow>
                  <slot name="cell-footer" {lane} column={cell.column} />
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
  <slot name="aside" />
</div>

<style lang="scss">
  .board-lanes {
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .scroller {
    flex-grow: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
  .content {
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: 100%;
    padding: 1rem 1.5rem 0.5rem;
  }
  .column-headers {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    padding-top: 0.5rem;
    background-color: var(--theme-bg-color);
  }
  .column-header,
  .cell {
    flex-shrink: 0;
    width: 20rem;
    min-width: 20rem;
  }
  .lane {
    display: flex;
    flex-direction: column;
    margin-bottom: 0.75rem;

    // A sub-lane sits under the header of its swimlane
    &.sub {
      margin-top: -0.25rem;
      margin-left: 1.25rem;
    }
  }
  .lane-header {
    position: sticky;
    left: 1.5rem;
    z-index: 2;
    display: flex;
    align-items: center;
    align-self: flex-start;
    gap: 0.5rem;
    min-height: 2rem;
    margin: 0 0.75rem 0.25rem;
    padding: 0 0.75rem 0 0.25rem;
    color: var(--theme-caption-color);
    background-color: var(--theme-bg-accent-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;

    .toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      color: inherit;
      background: transparent;
      border: none;
      border-radius: 0.25rem;
      cursor: pointer;

      &:hover,
      &:focus-visible {
        background-color: var(--theme-popup-hover);
      }
    }
    .lane-title {
      font-weight: 500;
    }
    .lane-count {
      color: var(--theme-dark-color);
    }
  }
  .lane-row {
    display: flex;
    align-items: stretch;
  }
  .cell {
    display: flex;
    flex-direction: column;
    min-height: 4rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 0.25rem;

    &.drop-target {
      background-color: var(--highlight-hover);
      border-color: var(--primary-button-default);
    }
  }
</style>
