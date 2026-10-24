<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import {
    type PageMargins,
    type RenderContext,
    type TemplateElement,
    backgroundCss,
    elementBoxCss,
    renderElementHtml,
    textContainerCss,
    textInnerCss
  } from '@hcengineering/branding'
  import { createEventDispatcher, onDestroy } from 'svelte'

  import { MM_TO_PX, type SnapResult, type Surface, round, snapAxis } from '../../editor/utils'

  export let surface: Surface
  export let margins: PageMargins
  export let zoom: number = 1
  export let selected: string[] = []
  export let resolveFile: (file: string) => string | undefined
  export let readonly: boolean = false
  // Sample values shown instead of placeholders
  export let values: Record<string, string> = {}
  export let keepPlaceholders: boolean = true

  const dispatch = createEventDispatcher<{
    select: { ids: string[] }
    begin: undefined
    update: { elements: TemplateElement[] }
    end: undefined
    textEdit: { id: string, text: string }
  }>()

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
  type Handle = (typeof HANDLES)[number]
  const SNAP_PX = 6

  interface Box {
    x: number
    y: number
    width: number
    height: number
  }

  interface DragState {
    mode: 'move' | 'resize' | 'rotate'
    // Rotation centre in screen coordinates
    center?: { x: number, y: number }
    handle?: Handle
    primary: string
    startX: number
    startY: number
    origin: Map<string, Box>
    moved: boolean
  }

  let drag: DragState | undefined
  let surfaceEl: HTMLDivElement | undefined
  // Text element edited in place on the canvas
  let editingId: string | undefined
  let guideX: number | undefined
  let guideY: number | undefined

  $: ctx = {
    values,
    mode: 'preview',
    keepPlaceholders,
    resolveFile
  } satisfies RenderContext

  $: scale = MM_TO_PX * zoom
  $: selectedElement =
    selected.length === 1 ? surface.elements.find((el) => el.id === selected[0] && el.hidden !== true) : undefined

  function handlesFor (el: TemplateElement): readonly Handle[] {
    return el.kind === 'line' ? ['e', 'w'] : HANDLES
  }

  function hitCss (el: TemplateElement): string {
    // Lines have no height, give them a grabbable area
    if (el.kind === 'line') {
      return elementBoxCss({ ...el, y: el.y - 1.5, height: 3 })
    }
    return elementBoxCss(el)
  }

  function guidesX (exclude: Set<string>): number[] {
    const result = [0, surface.width / 2, surface.width, margins.left, surface.width - margins.right]
    for (const el of surface.elements) {
      if (exclude.has(el.id) || el.hidden === true) continue
      result.push(el.x, el.x + el.width / 2, el.x + el.width)
    }
    return result
  }

  function guidesY (exclude: Set<string>): number[] {
    const result = [0, surface.height / 2, surface.height]
    if (!surface.isBand) {
      result.push(margins.top, surface.height - margins.bottom)
    }
    for (const el of surface.elements) {
      if (exclude.has(el.id) || el.hidden === true) continue
      result.push(el.y, el.y + el.height / 2, el.y + el.height)
    }
    return result
  }

  function startDrag (e: PointerEvent, el: TemplateElement, mode: DragState['mode'], handle?: Handle): void {
    if (e.button !== 0 || readonly) return
    e.stopPropagation()
    e.preventDefault()
    let ids: string[]
    if (mode !== 'move') {
      ids = [el.id]
    } else if (selected.includes(el.id)) {
      ids = e.shiftKey ? selected.filter((id) => id !== el.id) : selected
    } else {
      ids = e.shiftKey ? [...selected, el.id] : [el.id]
    }
    if (ids.join() !== selected.join()) {
      dispatch('select', { ids })
    }
    if (el.locked === true || !ids.includes(el.id)) return
    const origin = new Map<string, Box>()
    for (const item of surface.elements) {
      if (ids.includes(item.id) && item.locked !== true) {
        origin.set(item.id, { x: item.x, y: item.y, width: item.width, height: item.height })
      }
    }
    let center: DragState['center']
    if (mode === 'rotate' && surfaceEl !== undefined) {
      const rect = surfaceEl.getBoundingClientRect()
      center = { x: rect.left + (el.x + el.width / 2) * scale, y: rect.top + (el.y + el.height / 2) * scale }
    }
    drag = { mode, handle, primary: el.id, startX: e.clientX, startY: e.clientY, origin, moved: false, center }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function resizeBox (box: Box, handle: Handle, dx: number, dy: number, keepRatio: boolean): Box {
    let { x, y, width, height } = box
    if (handle.includes('e')) width = box.width + dx
    if (handle.includes('w')) {
      width = box.width - dx
      x = box.x + dx
    }
    if (handle.includes('s')) height = box.height + dy
    if (handle.includes('n')) {
      height = box.height - dy
      y = box.y + dy
    }
    if (keepRatio && box.width > 0 && box.height > 0 && handle.length === 2) {
      const ratio = box.width / box.height
      if (Math.abs(dx) > Math.abs(dy)) {
        const h = width / ratio
        if (handle.includes('n')) y = box.y + box.height - h
        height = h
      } else {
        const w = height * ratio
        if (handle.includes('w')) x = box.x + box.width - w
        width = w
      }
    }
    if (width < 1) {
      if (handle.includes('w')) x = box.x + box.width - 1
      width = 1
    }
    if (height < 1 && box.height > 0) {
      if (handle.includes('n')) y = box.y + box.height - 1
      height = 1
    }
    return { x, y, width, height: box.height === 0 ? 0 : height }
  }

  function onPointerMove (e: PointerEvent): void {
    if (drag === undefined) return
    const dx = (e.clientX - drag.startX) / scale
    const dy = (e.clientY - drag.startY) / scale
    if (!drag.moved && Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < 3) return
    if (!drag.moved) {
      drag.moved = true
      dispatch('begin')
    }
    const threshold = SNAP_PX / scale
    const snap = !e.altKey
    const exclude = new Set(drag.origin.keys())
    const next = new Map<string, Box>()

    if (drag.mode === 'rotate' && drag.center !== undefined) {
      const angle = (Math.atan2(e.clientY - drag.center.y, e.clientX - drag.center.x) * 180) / Math.PI + 90
      const normalized = ((Math.round(angle) + 540) % 360) - 180
      const rotation = e.shiftKey ? Math.round(normalized / 15) * 15 : normalized
      dispatch('update', {
        elements: surface.elements.map((el) => (el.id === drag?.primary ? ({ ...el, rotation } as TemplateElement) : el))
      })
      return
    }
    if (drag.mode === 'move') {
      const primary = drag.origin.get(drag.primary)
      if (primary === undefined) return
      let sx: SnapResult = { value: primary.x + dx }
      let sy: SnapResult = { value: primary.y + dy }
      if (snap) {
        sx = snapAxis(primary.x + dx, primary.width, guidesX(exclude), threshold)
        sy = snapAxis(primary.y + dy, primary.height, guidesY(exclude), threshold)
      }
      guideX = sx.guide
      guideY = sy.guide
      const ddx = sx.value - primary.x
      const ddy = sy.value - primary.y
      for (const [id, box] of drag.origin) {
        next.set(id, { ...box, x: round(box.x + ddx), y: round(box.y + ddy) })
      }
    } else if (drag.handle !== undefined) {
      const box = drag.origin.get(drag.primary)
      if (box === undefined) return
      const result = resizeBox(box, drag.handle, dx, dy, e.shiftKey)
      next.set(drag.primary, {
        x: round(result.x),
        y: round(result.y),
        width: round(result.width),
        height: round(result.height)
      })
    }

    dispatch('update', {
      elements: surface.elements.map((el) => {
        const box = next.get(el.id)
        return box !== undefined ? ({ ...el, ...box } as TemplateElement) : el
      })
    })
  }

  function onPointerUp (): void {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    if (drag?.moved === true) {
      dispatch('end')
    }
    drag = undefined
    guideX = undefined
    guideY = undefined
  }

  function onSurfacePointerDown (e: PointerEvent): void {
    if (e.button !== 0) return
    if (selected.length > 0) {
      dispatch('select', { ids: [] })
    }
  }

  function startEditing (el: TemplateElement): void {
    if (el.kind !== 'text' || el.locked === true || readonly) return
    editingId = el.id
  }

  function finishEditing (node: HTMLElement, id: string): void {
    const el = surface.elements.find((e) => e.id === id)
    editingId = undefined
    if (el?.kind === 'text' && node.innerText !== el.text) {
      dispatch('textEdit', { id, text: node.innerText.replace(/\n$/, '') })
    }
  }

  // Raw text with placeholders while editing, focused with the caret at the end
  function inlineEditor (node: HTMLElement, text: string): void {
    node.innerText = text
    node.focus()
    const range = document.createRange()
    range.selectNodeContents(node)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  }

  onDestroy(() => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  })
</script>

<div class="canvas" style:width={`${surface.width * scale}px`} style:height={`${surface.height * scale}px`}>
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="surface"
    bind:this={surfaceEl}
    style={`width:${surface.width}mm;height:${surface.height}mm;transform:scale(${zoom});--zoom:${zoom};${backgroundCss(surface.background, resolveFile)}`}
    on:pointerdown={onSurfacePointerDown}
  >
    {#if surface.isOverlay === true}
      <!-- Stand-in for document content, the overlay is drawn over it -->
      <div
        class="sample-content"
        style={`left:${margins.left}mm;top:${margins.top}mm;right:${margins.right}mm;bottom:${margins.bottom}mm`}
      >
        {#each Array(26) as _, i}
          <div class="sample-line" style:width={`${i % 7 === 0 ? 45 : 96 - ((i * 37) % 22)}%`} class:heading={i % 7 === 0} />
        {/each}
      </div>
    {/if}
    {#each surface.elements as el (el.id)}
      {#if el.id === editingId && el.kind === 'text'}
        <div style={elementBoxCss(el)}>
          <div style={textContainerCss(el)}>
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
              class="inline-editor"
              style={textInnerCss(el)}
              contenteditable="true"
              use:inlineEditor={el.text}
              on:blur={(e) => {
                finishEditing(e.currentTarget, el.id)
              }}
              on:keydown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') e.currentTarget.blur()
              }}
              on:pointerdown|stopPropagation
            />
          </div>
        </div>
      {:else}
        {@html renderElementHtml(el, ctx)}
      {/if}
    {/each}

    {#if !surface.isBand}
      <div
        class="margins"
        style={`left:${margins.left}mm;top:${margins.top}mm;right:${margins.right}mm;bottom:${margins.bottom}mm`}
      />
    {:else}
      <div class="margins band" style={`left:${margins.left}mm;right:${margins.right}mm;top:0;bottom:0`} />
    {/if}

    {#each surface.elements as el (el.id)}
      {#if el.hidden !== true && el.id !== editingId}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="hit"
          class:selected={selected.includes(el.id)}
          class:locked={el.locked === true}
          class:empty={el.kind === 'image' && el.file === undefined}
          style={`${hitCss(el)};--zoom:${zoom}`}
          on:pointerdown={(e) => {
            startDrag(e, el, 'move')
          }}
          on:dblclick={() => {
            startEditing(el)
          }}
        >
          {#if el.kind === 'image' && el.file === undefined}
            <span class="placeholder">IMG</span>
          {/if}
        </div>
      {/if}
    {/each}

    {#if selectedElement !== undefined && selectedElement.locked !== true && !readonly}
      {@const el = selectedElement}
      <div class="handles" style={`${hitCss(el)};--zoom:${zoom}`}>
        {#if el.kind !== 'line'}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="rotate"
            title="Rotate (Shift: 15° steps)"
            on:pointerdown={(e) => {
              startDrag(e, el, 'rotate')
            }}
          />
        {/if}
        {#each handlesFor(el) as handle}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="handle {handle}"
            on:pointerdown={(e) => {
              startDrag(e, el, 'resize', handle)
            }}
          />
        {/each}
      </div>
    {/if}

    {#if guideX !== undefined}
      <div class="guide vertical" style={`left:${guideX}mm`} />
    {/if}
    {#if guideY !== undefined}
      <div class="guide horizontal" style={`top:${guideY}mm`} />
    {/if}
  </div>
</div>

<style lang="scss">
  .canvas {
    position: relative;
    flex-shrink: 0;
    box-shadow: 0 0.25rem 1.25rem rgba(0, 0, 0, 0.18);
  }
  .surface {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    overflow: hidden;
    user-select: none;
    color: #000;
  }
  .margins {
    position: absolute;
    border: 1px dashed rgba(59, 130, 246, 0.35);
    pointer-events: none;

    &.band {
      border-top: none;
      border-bottom: none;
    }
  }
  .hit {
    cursor: move;
    outline: calc(1px / var(--zoom)) solid transparent;

    &:hover {
      outline-color: rgba(59, 130, 246, 0.6);
    }
    &.selected {
      outline: calc(1.5px / var(--zoom)) solid #3b82f6;
    }
    &.locked {
      cursor: default;
    }
    &.empty {
      display: flex;
      align-items: center;
      justify-content: center;
      background: repeating-linear-gradient(45deg, #f2f4f7, #f2f4f7 2mm, #e4e7ec 2mm, #e4e7ec 4mm);
    }
    .placeholder {
      font: 600 3mm sans-serif;
      color: #98a2b3;
    }
  }
  .handles {
    pointer-events: none;
  }
  .handle {
    position: absolute;
    width: calc(8px / var(--zoom));
    height: calc(8px / var(--zoom));
    margin: calc(-4px / var(--zoom));
    background: #fff;
    border: calc(1.5px / var(--zoom)) solid #3b82f6;
    border-radius: 2px;
    pointer-events: all;

    &.nw {
      left: 0;
      top: 0;
      cursor: nwse-resize;
    }
    &.n {
      left: 50%;
      top: 0;
      cursor: ns-resize;
    }
    &.ne {
      left: 100%;
      top: 0;
      cursor: nesw-resize;
    }
    &.e {
      left: 100%;
      top: 50%;
      cursor: ew-resize;
    }
    &.se {
      left: 100%;
      top: 100%;
      cursor: nwse-resize;
    }
    &.s {
      left: 50%;
      top: 100%;
      cursor: ns-resize;
    }
    &.sw {
      left: 0;
      top: 100%;
      cursor: nesw-resize;
    }
    &.w {
      left: 0;
      top: 50%;
      cursor: ew-resize;
    }
  }
  .rotate {
    position: absolute;
    left: 50%;
    top: calc(-22px / var(--zoom));
    width: calc(10px / var(--zoom));
    height: calc(10px / var(--zoom));
    margin-left: calc(-5px / var(--zoom));
    border: calc(1.5px / var(--zoom)) solid #3b82f6;
    border-radius: 50%;
    background: #fff;
    cursor: grab;
    pointer-events: all;

    &::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 100%;
      width: calc(1px / var(--zoom));
      height: calc(10px / var(--zoom));
      background: #3b82f6;
    }
  }
  .inline-editor {
    outline: calc(1.5px / var(--zoom, 1)) solid #3b82f6;
    cursor: text;
    user-select: text;
    min-height: 1em;
  }
  .sample-content {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 2.6mm;
    pointer-events: none;
  }
  .sample-line {
    height: 2mm;
    border-radius: 1mm;
    background: #eaecf0;

    &.heading {
      height: 4mm;
      margin-top: 2mm;
      background: #d0d5dd;
    }
  }
  .guide {
    position: absolute;
    pointer-events: none;
    background: #ec4899;

    &.vertical {
      top: 0;
      bottom: 0;
      width: calc(1px / var(--zoom, 1));
    }
    &.horizontal {
      left: 0;
      right: 0;
      height: calc(1px / var(--zoom, 1));
    }
  }
</style>
