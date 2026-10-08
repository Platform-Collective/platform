<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Doc, generateId } from '@hcengineering/core'
  import { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import view from '../../plugin'
  import { focusStore } from '../../selection'
  import {
    EditJournal,
    activateCell,
    buildGrid,
    cellBox,
    cellText,
    copyRect,
    createBatch,
    decodeTsv,
    encodeTsv,
    extendRectDown,
    extendSelection,
    fillDown,
    intersect,
    isSingleCell,
    moveSelection,
    placePaste,
    planClear,
    planEdits,
    rectCells,
    selectionRect,
    tabPos,
    visibleArea,
    ROW_ATTRIBUTE,
    collectRowCells,
    type CellAdapter,
    type CellEdit,
    type CellPos,
    type CellRect,
    type CellSelection,
    type DomGrid,
    type EditPlan,
    type MoveDirection,
    type ScreenRect
  } from '../../tableEdit'
  import { restrictionStore } from '../../utils'

  // Spreadsheet-style editing on top of the rendered list: a focused cell, keyboard navigation, a rectangular
  // selection, copy and paste of tab separated text, fill-down and undo. It activates when a cell is clicked
  // and works on the DOM that the list renders (see tableEdit/cells.ts), so the list itself does not know about it.

  // Reads and writes the cells; without it the list behaves as before
  export let adapter: CellAdapter | undefined = undefined
  export let readonly: boolean = false
  // 'compact' | 'default' | 'comfortable'
  export let rowHeight: string | undefined = undefined

  interface CellRef {
    id: string
    key: string
  }

  type Toast =
    | { kind: 'updated', count: number, skipped: number, batchId: string }
    | { kind: 'skipped', skipped: number }
    | { kind: 'undone', count: number }
    | { kind: 'failed' }
    | { kind: 'undoFailed' }

  interface Overlay {
    focus: ScreenRect
    range?: ScreenRect
    handle?: { x: number, y: number }
  }

  const journal = new EditJournal()
  const TOAST_MS = 8000

  let root: HTMLDivElement
  let active = false
  let anchor: CellRef | undefined
  let focus: CellRef | undefined
  let overlay: Overlay | undefined
  let fillPreview: ScreenRect | undefined
  let fillToRow: number | undefined
  let toast: Toast | undefined
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let suppressClick = false
  let frame: number | undefined

  $: canEdit = adapter !== undefined && !readonly && !$restrictionStore.readonly
  $: if (adapter === undefined) deactivate()

  // ---- grid access ----

  function grid (): DomGrid {
    return buildGrid(root)
  }

  function docMap (): Map<string, Doc> {
    return new Map((get(focusStore).provider?.docs() ?? []).map((d) => [d._id as string, d]))
  }

  function locate (g: DomGrid, ref: CellRef | undefined): CellPos | undefined {
    if (ref === undefined) return undefined
    const row = g.rows.findIndex((r) => r.id === ref.id)
    const col = g.cols.indexOf(ref.key)
    return row < 0 || col < 0 ? undefined : { row, col }
  }

  function refAt (g: DomGrid, pos: CellPos): CellRef {
    return { id: g.rows[pos.row].id, key: g.cols[pos.col] }
  }

  function currentSelection (g: DomGrid): CellSelection | undefined {
    const f = locate(g, focus)
    if (f === undefined) return undefined
    return { anchor: locate(g, anchor) ?? f, focus: f }
  }

  function setSelection (g: DomGrid, sel: CellSelection): void {
    anchor = refAt(g, sel.anchor)
    focus = refAt(g, sel.focus)
  }

  function dimsOf (g: DomGrid): { rows: number, cols: number } {
    return { rows: g.rows.length, cols: g.cols.length }
  }

  function textOf (g: DomGrid, docs: Map<string, Doc>, pos: CellPos): string {
    const row = g.rows[pos.row]
    const key = g.cols[pos.col]
    const doc = docs.get(row.id)
    const column = adapter?.column(key)
    if (column !== undefined && doc !== undefined) return column.format(doc)
    return cellText(row, key)
  }

  // ---- overlay ----

  function scheduleRefresh (): void {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      refresh()
    })
  }

  function refresh (): void {
    if (!active || focus === undefined) {
      overlay = undefined
      return
    }
    const g = grid()
    const sel = currentSelection(g)
    if (sel === undefined) {
      overlay = undefined
      return
    }
    const rect = selectionRect(sel)
    const topLeft = cellBox(g.rows[rect.top], g.cols[rect.left])
    const bottomRight = cellBox(g.rows[rect.bottom], g.cols[rect.right])
    const focusBox = cellBox(g.rows[sel.focus.row], g.cols[sel.focus.col])
    if (topLeft === undefined || bottomRight === undefined || focusBox === undefined) {
      overlay = undefined
      return
    }
    const area = visibleArea(g.rows[sel.focus.row].element)
    const visibleFocus = intersect(focusBox, area)
    if (visibleFocus === undefined) {
      overlay = undefined
      return
    }
    const full = { left: topLeft.left, top: topLeft.top, right: bottomRight.right, bottom: bottomRight.bottom }
    const range = isSingleCell(rect) ? undefined : intersect(full, area)
    const handleInside =
      full.right <= area.right + 1 && full.bottom <= area.bottom + 1 && full.right >= area.left && full.bottom >= area.top
    overlay = {
      focus: visibleFocus,
      range,
      handle: canEdit && handleInside ? { x: full.right, y: full.bottom } : undefined
    }
  }

  function reveal (g: DomGrid, pos: CellPos): void {
    const row = g.rows[pos.row]
    const el = row.cells.get(g.cols[pos.col])?.[0]
    row.element.scrollIntoView({ block: 'nearest' })
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function syncRowFocus (g: DomGrid, row: number): void {
    const doc = docMap().get(g.rows[row].id)
    if (doc !== undefined) get(focusStore).provider?.updateFocus(doc)
  }

  function moveTo (g: DomGrid, sel: CellSelection): void {
    setSelection(g, sel)
    syncRowFocus(g, sel.focus.row)
    reveal(g, sel.focus)
    scheduleRefresh()
  }

  function activate (): void {
    if (active) return
    active = true
    observer?.observe(root, { childList: true, subtree: true })
  }

  export function deactivate (): void {
    if (!active && anchor === undefined) return
    active = false
    anchor = undefined
    focus = undefined
    overlay = undefined
    observer?.disconnect()
  }

  // ---- toast ----

  function showToast (next: Toast): void {
    toast = next
    if (toastTimer !== undefined) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toast = undefined
    }, TOAST_MS)
  }

  // ---- editing ----

  async function commit (plan: EditPlan): Promise<void> {
    if (adapter === undefined) return
    if (plan.ops.length === 0) {
      if (plan.skipped > 0) showToast({ kind: 'skipped', skipped: plan.skipped })
      return
    }
    const batch = createBatch(generateId(), plan.ops)
    try {
      await adapter.run(batch.ops)
      journal.record(batch)
      showToast({ kind: 'updated', count: batch.count, skipped: plan.skipped, batchId: batch.id })
    } catch (err) {
      console.error('[CellGrid.commit] Failed to apply the changes', err)
      showToast({ kind: 'failed' })
    }
  }

  async function undo (id?: string): Promise<void> {
    if (adapter === undefined || !canEdit) return
    try {
      const batch = await journal.undo(adapter.run, id)
      if (batch !== undefined) showToast({ kind: 'undone', count: batch.count })
      else toast = undefined
    } catch (err) {
      console.error('[CellGrid.undo] Failed to revert the changes', err)
      showToast({ kind: 'undoFailed' })
    }
  }

  async function redo (): Promise<void> {
    if (adapter === undefined || !canEdit) return
    try {
      const batch = await journal.redo(adapter.run)
      if (batch !== undefined) showToast({ kind: 'updated', count: batch.count, skipped: 0, batchId: batch.id })
    } catch (err) {
      console.error('[CellGrid.redo] Failed to apply the changes again', err)
      showToast({ kind: 'failed' })
    }
  }

  function editsFor (
    g: DomGrid,
    docs: Map<string, Doc>,
    cells: Array<{ pos: CellPos, text: string }>
  ): Array<CellEdit<Doc>> {
    const res: Array<CellEdit<Doc>> = []
    for (const cell of cells) {
      const doc = docs.get(g.rows[cell.pos.row].id)
      if (doc !== undefined) res.push({ doc, key: g.cols[cell.pos.col], text: cell.text })
    }
    return res
  }

  async function clearSelection (): Promise<void> {
    if (adapter === undefined || !canEdit) return
    const g = grid()
    const sel = currentSelection(g)
    if (sel === undefined) return
    const docs = docMap()
    const cells: Array<{ doc: Doc, key: string }> = []
    for (const pos of rectCells(selectionRect(sel))) {
      const doc = docs.get(g.rows[pos.row].id)
      if (doc !== undefined) cells.push({ doc, key: g.cols[pos.col] })
    }
    await commit(planClear(cells, adapter))
  }

  async function pasteText (text: string): Promise<void> {
    if (adapter === undefined || !canEdit) return
    const g = grid()
    const sel = currentSelection(g)
    if (sel === undefined) return
    const block = decodeTsv(text)
    const rect = selectionRect(sel)
    const placement = placePaste(rect, block, dimsOf(g))
    if (placement.cells.length === 0) return
    const docs = docMap()
    const edits = editsFor(
      g,
      docs,
      placement.cells.map((p) => ({ pos: p.target, text: block[p.fromRow][p.fromCol] ?? '' }))
    )
    const plan = planEdits(edits, adapter)
    plan.skipped += placement.clipped
    // A pasted block becomes the selection, like in a spreadsheet
    if (placement.cells.length > 1 && isSingleCell(rect)) {
      const last = placement.cells.reduce(
        (acc, p) => ({ row: Math.max(acc.row, p.target.row), col: Math.max(acc.col, p.target.col) }),
        { row: rect.top, col: rect.left }
      )
      setSelection(g, { anchor: { row: rect.top, col: rect.left }, focus: last })
      scheduleRefresh()
    }
    await commit(plan)
  }

  async function applyFill (rect: CellRect, toRow: number): Promise<void> {
    if (adapter === undefined || !canEdit) return
    const g = grid()
    const docs = docMap()
    const targets = fillDown(rect, toRow, dimsOf(g))
    if (targets.length === 0) return
    const edits = editsFor(
      g,
      docs,
      targets.map((t) => ({ pos: t.target, text: textOf(g, docs, t.source) }))
    )
    const extended = extendRectDown(rect, toRow, dimsOf(g))
    setSelection(g, { anchor: { row: extended.top, col: extended.left }, focus: { row: extended.bottom, col: extended.right } })
    scheduleRefresh()
    await commit(planEdits(edits, adapter))
  }

  // ---- events ----

  function popupOpen (): boolean {
    return document.querySelector('.popup') !== null
  }

  function isEditableTarget (target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.isContentEditable) return true
    const tag = target.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || tag === 'select'
  }

  function keyboardBlocked (e: Event): boolean {
    return isEditableTarget(e.target) || popupOpen()
  }

  const arrows: Record<string, MoveDirection> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right'
  }

  function consume (e: Event): void {
    e.preventDefault()
    e.stopPropagation()
  }

  function onKeyDown (e: KeyboardEvent): void {
    if (!active || adapter === undefined || e.isComposing || keyboardBlocked(e)) return
    const mod = e.metaKey || e.ctrlKey

    if (fillToRow !== undefined) {
      if (e.key === 'Escape') {
        consume(e)
        stopFill(false)
      }
      return
    }

    const g = grid()
    const sel = currentSelection(g)
    if (sel === undefined) {
      if (e.key === 'Escape') deactivate()
      return
    }
    const dims = dimsOf(g)

    const dir = arrows[e.key]
    if (dir !== undefined && !e.altKey) {
      consume(e)
      moveTo(g, e.shiftKey ? extendSelection(sel, dir, dims, mod) : moveSelection(sel, dir, dims, mod))
      return
    }

    switch (e.key) {
      case 'Tab': {
        consume(e)
        const next = tabPos(sel.focus, dims, e.shiftKey)
        moveTo(g, { anchor: next, focus: next })
        return
      }
      case 'Enter': {
        if (e.shiftKey || mod || !canEdit) return
        consume(e)
        activateCell(g.rows[sel.focus.row], g.cols[sel.focus.col])
        return
      }
      case 'Escape': {
        consume(e)
        if (isSingleCell(selectionRect(sel))) deactivate()
        else {
          moveTo(g, { anchor: sel.focus, focus: sel.focus })
        }
        return
      }
      case 'Delete':
      case 'Backspace': {
        if (mod || !canEdit) return
        consume(e)
        void clearSelection()
        return
      }
    }

    if (mod && !e.altKey && canEdit) {
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey && journal.canUndo) {
        consume(e)
        void undo()
      } else if (((key === 'z' && e.shiftKey) || key === 'y') && journal.canRedo) {
        consume(e)
        void redo()
      }
    }
  }

  function hasTextSelection (): boolean {
    const s = window.getSelection()
    return s !== null && !s.isCollapsed
  }

  function onCopy (e: ClipboardEvent): void {
    if (!active || adapter === undefined || e.clipboardData === null || keyboardBlocked(e) || hasTextSelection()) return
    const g = grid()
    const sel = currentSelection(g)
    if (sel === undefined) return
    const docs = docMap()
    const rows = copyRect(selectionRect(sel), (row, col) => textOf(g, docs, { row, col }))
    e.clipboardData.setData('text/plain', encodeTsv(rows))
    consume(e)
  }

  function onPaste (e: ClipboardEvent): void {
    if (!active || adapter === undefined || e.clipboardData === null || keyboardBlocked(e)) return
    if (!canEdit) return
    const text = e.clipboardData.getData('text/plain')
    if (text === '') return
    consume(e)
    void pasteText(text)
  }

  function hitCell (target: Element): CellRef | undefined {
    const rowEl = target.closest(`[${ROW_ATTRIBUTE}]`)
    const id = rowEl?.getAttribute(ROW_ATTRIBUTE)
    if (rowEl == null || id == null || !root.contains(rowEl)) return undefined
    for (const [key, elements] of collectRowCells(rowEl).cells) {
      if (elements.some((el) => el.contains(target))) return { id, key }
    }
    return undefined
  }

  function onMouseDown (e: MouseEvent): void {
    if (adapter === undefined || e.button !== 0 || !(e.target instanceof Element)) return
    const target = e.target
    if (target.closest('.cell-grid-ui') !== null) return
    const hit = root.contains(target) ? hitCell(target) : undefined
    if (hit === undefined) {
      // Clicks inside popups belong to the editor that was opened from a cell
      if (active && target.closest('.popup') === null) deactivate()
      return
    }
    if (e.shiftKey && active && anchor !== undefined) {
      // Shift+click extends the selection and must not open the editor of the cell
      focus = hit
      suppressClick = true
      e.preventDefault()
      scheduleRefresh()
      return
    }
    anchor = hit
    focus = hit
    activate()
    scheduleRefresh()
  }

  function onClick (e: MouseEvent): void {
    if (!suppressClick) return
    suppressClick = false
    consume(e)
  }

  // ---- fill handle ----

  function rowAtY (g: DomGrid, y: number): number {
    let best = 0
    let bestDistance = Infinity
    g.rows.forEach((row, i) => {
      const r = row.element.getBoundingClientRect()
      const distance = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
      if (distance < bestDistance) {
        best = i
        bestDistance = distance
      }
    })
    return best
  }

  function onFillMove (e: MouseEvent): void {
    const g = grid()
    const sel = currentSelection(g)
    if (sel === undefined) return
    const rect = selectionRect(sel)
    const toRow = Math.max(rowAtY(g, e.clientY), rect.bottom)
    fillToRow = toRow
    const topLeft = cellBox(g.rows[rect.top], g.cols[rect.left])
    const bottomRight = cellBox(g.rows[toRow], g.cols[rect.right])
    fillPreview =
      topLeft !== undefined && bottomRight !== undefined && toRow > rect.bottom
        ? { left: topLeft.left, top: topLeft.top, right: bottomRight.right, bottom: bottomRight.bottom }
        : undefined
  }

  function onFillUp (): void {
    stopFill(true)
  }

  function stopFill (apply: boolean): void {
    window.removeEventListener('mousemove', onFillMove, true)
    window.removeEventListener('mouseup', onFillUp, true)
    const toRow = fillToRow
    fillToRow = undefined
    fillPreview = undefined
    if (!apply || toRow === undefined) return
    const g = grid()
    const sel = currentSelection(g)
    if (sel !== undefined) void applyFill(selectionRect(sel), toRow)
  }

  function startFill (e: MouseEvent): void {
    if (!canEdit) return
    consume(e)
    fillToRow = -1
    window.addEventListener('mousemove', onFillMove, true)
    window.addEventListener('mouseup', onFillUp, true)
  }

  // ---- lifecycle ----

  let observer: MutationObserver | undefined

  onMount(() => {
    observer = new MutationObserver(scheduleRefresh)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('scroll', scheduleRefresh, true)
    window.addEventListener('resize', scheduleRefresh)
    document.addEventListener('copy', onCopy, true)
    document.addEventListener('paste', onPaste, true)
  })

  onDestroy(() => {
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('mousedown', onMouseDown, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('scroll', scheduleRefresh, true)
    window.removeEventListener('resize', scheduleRefresh)
    document.removeEventListener('copy', onCopy, true)
    document.removeEventListener('paste', onPaste, true)
    window.removeEventListener('mousemove', onFillMove, true)
    window.removeEventListener('mouseup', onFillUp, true)
    observer?.disconnect()
    if (toastTimer !== undefined) clearTimeout(toastTimer)
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  function toastLabel (t: Toast): IntlString {
    switch (t.kind) {
      case 'updated':
        return t.skipped > 0 ? view.string.BulkItemsUpdatedSkipped : view.string.BulkItemsUpdated
      case 'skipped':
        return view.string.BulkCellsSkipped
      case 'undone':
        return view.string.BulkUndone
      case 'failed':
        return view.string.BulkFailed
      case 'undoFailed':
        return view.string.BulkUndoFailed
    }
  }

  function toastParams (t: Toast): Record<string, any> {
    switch (t.kind) {
      case 'updated':
        return { count: t.count, skipped: t.skipped }
      case 'skipped':
        return { skipped: t.skipped }
      case 'undone':
        return { count: t.count }
      default:
        return {}
    }
  }

  const box = (r: ScreenRect): string =>
    `left:${r.left}px;top:${r.top}px;width:${r.right - r.left}px;height:${r.bottom - r.top}px`
</script>

<div class="cell-grid-root" bind:this={root} data-row-height={rowHeight}>
  <slot />
</div>

{#if overlay !== undefined}
  {#if overlay.range !== undefined}
    <div class="cell-grid-ui cell-range" style={box(overlay.range)} />
  {/if}
  <div class="cell-grid-ui cell-focus" style={box(overlay.focus)} />
  {#if overlay.handle !== undefined}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="cell-grid-ui fill-handle"
      style={`left:${overlay.handle.x - 5}px;top:${overlay.handle.y - 5}px`}
      on:mousedown={startFill}
    />
  {/if}
{/if}
{#if fillPreview !== undefined}
  <div class="cell-grid-ui cell-fill-preview" style={box(fillPreview)} />
{/if}
{#if toast !== undefined}
  <div class="cell-grid-ui cell-toast" role="status">
    <span class="cell-toast-text"><Label label={toastLabel(toast)} params={toastParams(toast)} /></span>
    {#if toast.kind === 'updated'}
      {@const batchId = toast.batchId}
      <button
        class="cell-toast-undo"
        on:click={() => {
          void undo(batchId)
        }}
      >
        <Label label={view.string.BulkUndo} />
      </button>
    {/if}
  </div>
{/if}

<style lang="scss">
  .cell-grid-root {
    display: contents;
  }
  :global(.cell-grid-root[data-row-height='compact'] .listGrid.row) {
    height: 2rem;
    min-height: 2rem;
  }
  :global(.cell-grid-root[data-row-height='comfortable'] .listGrid.row) {
    height: 3.75rem;
    min-height: 3.75rem;
  }
  .cell-focus,
  .cell-range,
  .cell-fill-preview {
    position: fixed;
    z-index: 90;
    pointer-events: none;
    box-sizing: border-box;
  }
  .cell-focus {
    border: 2px solid var(--primary-edit-border-color);
    border-radius: 0.125rem;
  }
  .cell-range {
    background-color: var(--primary-edit-border-color);
    background-color: color-mix(in srgb, var(--primary-edit-border-color) 12%, transparent);
    border: 1px solid var(--primary-edit-border-color);
  }
  .cell-fill-preview {
    border: 2px dashed var(--primary-edit-border-color);
  }
  .fill-handle {
    position: fixed;
    z-index: 91;
    width: 0.625rem;
    height: 0.625rem;
    box-sizing: border-box;
    background-color: var(--primary-edit-border-color);
    border: 1px solid var(--theme-bg-color);
    cursor: crosshair;
  }
  .cell-toast {
    position: fixed;
    left: 50%;
    bottom: 1.5rem;
    transform: translateX(-50%);
    z-index: 460;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.625rem 1rem;
    color: var(--theme-caption-color);
    background-color: var(--theme-popup-color);
    border: 1px solid var(--theme-popup-divider);
    border-radius: 0.5rem;
    box-shadow: var(--theme-popup-shadow);
  }
  .cell-toast-undo {
    padding: 0.125rem 0.5rem;
    color: var(--primary-edit-border-color);
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    font-weight: 500;
    cursor: pointer;

    &:hover {
      background-color: var(--highlight-hover);
    }
  }
</style>
