<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import type { Class, Doc, Ref } from '@hcengineering/core'
  import {
    type BrandAsset,
    type ElementKind,
    type HeadingLevel,
    type PagePlacement,
    type PrintTemplate,
    type TemplateBand,
    type TemplateDesign,
    type TemplateElement,
    type TemplatePage,
    type PageRule,
    type TemplateOverlay,
    type TemplateType,
    TEMPLATE_TYPES,
    createDesignForType,
    createAlternateBand,
    createWatermark,
    getPageDimensions,
    getTemplateType,
    isPresetTemplateType,
    createElement,
    createPage,
    extractFields,
    fieldPlaceholder,
    fontFacesCss,
    normalizeDesign
  } from '@hcengineering/branding'
  import { MessageBox, createQuery, getClient, getFileUrl } from '@hcengineering/presentation'
  import {
    Button,
    Icon,
    IconAdd,
    IconClose,
    IconRedo,
    IconUndo,
    Label,
    Scroller,
    eventToHTMLElement,
    SelectPopup,
    languageStore,
    showPopup,
    tooltip
  } from '@hcengineering/ui'
  import { type IntlString, translate } from '@hcengineering/platform'
  import { createEventDispatcher, onMount } from 'svelte'

  import { collectDesignTexts, getPreviewFonts } from '../../assets'
  import { TEMPLATE_TYPE_LABELS, sampleValuesFor } from '../../sample'

  const CUSTOM_TYPE = '__custom__'
  import SelectField from './controls/SelectField.svelte'
  import {
    type EditorSection,
    type SurfaceRef,
    clone,
    duplicateElement,
    getSurface,
    isSurface,
    sameSection,
    alignElements,
    copyElements,
    getBand,
    distributeElements,
    hasClipboard,
    pasteElements,
    reorderElements,
    setSurfaceElements,
    styleTag
  } from '../../editor/utils'
  import { type FieldInfo, getAttributeFields, getFieldInfos } from '../../fields'
  import branding from '../../plugin'
  import AssetPicker from './AssetPicker.svelte'
  import ArrangeBar from './ArrangeBar.svelte'
  import ElementProperties from './ElementProperties.svelte'
  import LayersPanel from './LayersPanel.svelte'
  import PageCanvas from './PageCanvas.svelte'
  import PageSetupPanel from './PageSetupPanel.svelte'
  import SurfaceProperties from './SurfaceProperties.svelte'
  import TypographyPanel from './TypographyPanel.svelte'
  import TypographyPreview from './TypographyPreview.svelte'

  export let template: PrintTemplate | undefined = undefined
  // Session mode (print preview): the design is handed back instead of being saved to the template
  export let initialDesign: TemplateDesign | undefined = undefined
  export let onApply: ((design: TemplateDesign) => void) | undefined = undefined
  // Attribute fields offered by the field picker in session mode
  export let documentClass: Ref<Class<Doc>> | undefined = undefined

  $: sessionMode = onApply !== undefined

  const dispatch = createEventDispatcher<{ close: undefined }>()
  const client = getClient()
  const HISTORY_LIMIT = 100
  const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3]

  let design: TemplateDesign = clone(normalizeDesign(initialDesign ?? template?.design ?? createDesignForType('other')))
  let name = template?.name ?? ''
  let templateType: TemplateType = getTemplateType(template ?? {})
  let customType = !isPresetTemplateType(templateType)
  let customTypePlaceholder = ''
  void translate(branding.string.CustomTypeName, {}, $languageStore).then((v) => {
    customTypePlaceholder = v
  })
  // Show sample values instead of {{placeholders}} on the canvas
  let sampleData = true
  let dirty = false
  let saving = false

  let past: TemplateDesign[] = []
  let future: TemplateDesign[] = []
  let lastCoalesce: { key: string, time: number } | undefined

  let section: EditorSection =
    design.pages.length > 0 ? { kind: 'page', id: design.pages[0].id } : { kind: 'setup' }
  let selected: string[] = []
  let zoom = 0.75
  let typographyLevel: HeadingLevel | 'body' = 'h1'

  let fontAssets: BrandAsset[] = []
  const fontQuery = createQuery()
  fontQuery.query(branding.class.BrandAsset, { kind: 'font' }, (res) => {
    fontAssets = res
  })

  $: customFonts = fontAssets.map((a) => a.fontFamily ?? a.name)
  $: fontCss = fontFacesCss(getPreviewFonts(fontAssets))
  $: surfaceRef = isSurface(section) ? section : undefined
  $: surface = surfaceRef !== undefined ? getSurface(design, surfaceRef) : undefined
  $: currentPage = section.kind === 'page' ? design.pages.find((p) => p.id === (section as { id: string }).id) : undefined
  $: currentBand =
    section.kind === 'header' || section.kind === 'footer'
      ? getBand(design, { kind: section.kind, variant: (section as { variant?: string }).variant })
      : undefined
  $: isAlternate = (section.kind === 'header' || section.kind === 'footer') && (section as { variant?: string }).variant !== undefined
  $: isOverlaySection = section.kind === 'overlay'
  $: selectedElements = surface?.elements.filter((el) => selected.includes(el.id)) ?? []
  $: selectedElement = selectedElements.length === 1 ? selectedElements[0] : undefined
  $: isBandSection = section.kind === 'header' || section.kind === 'footer'
  $: fields = getFieldInfos(isBandSection)
  $: attributeFields = collectAttributeFields(documentClass !== undefined ? [documentClass] : template?.targetClasses ?? [])
  $: beforePages = design.pages.filter((p) => p.placement === 'before')
  $: afterPages = design.pages.filter((p) => p.placement === 'after')
  $: sampleValues = sampleValuesFor(Array.from(new Set(collectDesignTexts(design).flatMap((t) => extractFields(t)))))
  $: enabledBefore = design.pages.filter((p) => p.enabled && p.placement === 'before').length
  $: enabledAfter = design.pages.filter((p) => p.enabled && p.placement === 'after').length
  $: typeOptions = [
    ...TEMPLATE_TYPES.map((t) => ({ id: t, label: TEMPLATE_TYPE_LABELS[t], intl: true })),
    { id: CUSTOM_TYPE, label: branding.string.CustomType, intl: true }
  ]

  function selectType (value: string): void {
    customType = value === CUSTOM_TYPE
    templateType = customType ? '' : TEMPLATE_TYPES.find((t) => t === value) ?? 'other'
    dirty = true
  }

  function collectAttributeFields (classes: Array<Ref<Class<Doc>>>): FieldInfo[] {
    const result = new Map<string, FieldInfo>()
    for (const _class of classes) {
      if (!client.getHierarchy().hasClass(_class)) continue
      for (const f of getAttributeFields(client, _class)) result.set(f.key, f)
    }
    return Array.from(result.values())
  }

  function resolveFile (file: string): string | undefined {
    return getFileUrl(file)
  }

  function pushHistory (): void {
    past = [...past.slice(-HISTORY_LIMIT + 1), clone(design)]
    future = []
  }

  /**
   * Apply a change to the design; consecutive changes with the same key (typing, nudging) form one undo step.
   */
  function commit (fn: (d: TemplateDesign) => void, coalesce?: string): void {
    const now = Date.now()
    if (coalesce === undefined || lastCoalesce?.key !== coalesce || now - lastCoalesce.time > 1500) {
      pushHistory()
    }
    lastCoalesce = coalesce !== undefined ? { key: coalesce, time: now } : undefined
    fn(design)
    design = design
    dirty = true
  }

  function undo (): void {
    const prev = past.pop()
    if (prev === undefined) return
    future = [clone(design), ...future]
    past = past
    design = prev
    lastCoalesce = undefined
    dirty = true
    const current = surfaceRef !== undefined ? getSurface(design, surfaceRef) : undefined
    selected = selected.filter((id) => current?.elements.some((e) => e.id === id) ?? false)
  }

  function redo (): void {
    const [next, ...rest] = future
    if (next === undefined) return
    past = [...past, clone(design)]
    future = rest
    design = next
    lastCoalesce = undefined
    dirty = true
  }

  function selectSection (next: EditorSection): void {
    if (!sameSection(section, next)) {
      section = next
      selected = []
    }
  }

  function updateElements (ref: SurfaceRef, fn: (elements: TemplateElement[]) => TemplateElement[], coalesce?: string): void {
    commit((d) => {
      const s = getSurface(d, ref)
      if (s !== undefined) setSurfaceElements(d, ref, fn(s.elements))
    }, coalesce)
  }

  function addElement (kind: ElementKind, asField = false, ellipse = false): void {
    if (surfaceRef === undefined || surface === undefined) return
    const width = kind === 'line' ? 60 : kind === 'text' ? 70 : 40
    const height = kind === 'line' ? 0 : kind === 'text' ? (isBandSection ? 6 : 12) : isBandSection ? Math.max(4, surface.height - 4) : 30
    const x = Math.max(0, (surface.width - width) / 2)
    const y = Math.max(0, (surface.height - height) / 2)
    const el =
      kind === 'text'
        ? createElement('text', { x, y, width, height, text: asField ? fieldPlaceholder('title') : 'Text' })
        : kind === 'shape'
          ? createElement('shape', { x, y, width, height, shape: ellipse ? 'ellipse' : 'rect' })
          : createElement(kind, { x, y, width, height })
    updateElements(surfaceRef, (elements) => [...elements, el])
    selected = [el.id]
  }

  function addImage (e: MouseEvent): void {
    showPopup(AssetPicker, { kind: 'image' }, eventToHTMLElement(e), (asset: BrandAsset | undefined) => {
      if (asset === undefined || surfaceRef === undefined || surface === undefined) return
      const height = isBandSection ? Math.max(4, surface.height - 4) : 30
      const el = createElement('image', { x: 20, y: isBandSection ? 2 : 20, width: 40, height, file: asset.file })
      updateElements(surfaceRef, (elements) => [...elements, el])
      selected = [el.id]
    })
  }

  function changeSelected (patch: Partial<TemplateElement>): void {
    if (surfaceRef === undefined || selectedElement === undefined) return
    const id = selectedElement.id
    updateElements(
      surfaceRef,
      (elements) => elements.map((el) => (el.id === id ? ({ ...el, ...patch } as TemplateElement) : el)),
      `props-${id}-${Object.keys(patch).join()}`
    )
  }

  function removeSelected (): void {
    if (surfaceRef === undefined || selected.length === 0) return
    const ids = new Set(selected)
    updateElements(surfaceRef, (elements) => elements.filter((el) => !ids.has(el.id)))
    selected = []
  }

  function duplicateSelected (): void {
    if (surfaceRef === undefined || selected.length === 0) return
    const copies = selectedElements.map(duplicateElement)
    updateElements(surfaceRef, (elements) => [...elements, ...copies])
    selected = copies.map((c) => c.id)
  }

  function nudge (dx: number, dy: number): void {
    if (surfaceRef === undefined || selected.length === 0) return
    const ids = new Set(selected)
    updateElements(
      surfaceRef,
      (elements) => elements.map((el) => (ids.has(el.id) && el.locked !== true ? { ...el, x: el.x + dx, y: el.y + dy } : el)),
      'nudge'
    )
  }

  function moveLayer (id: string, delta: number): void {
    if (surfaceRef === undefined) return
    updateElements(surfaceRef, (elements) => {
      const index = elements.findIndex((el) => el.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= elements.length) return elements
      const result = [...elements]
      const [item] = result.splice(index, 1)
      result.splice(target, 0, item)
      return result
    })
  }

  function toggleLayer (id: string, key: 'hidden' | 'locked'): void {
    if (surfaceRef === undefined) return
    updateElements(surfaceRef, (elements) => elements.map((el) => (el.id === id ? ({ ...el, [key]: el[key] !== true } as TemplateElement) : el)))
  }

  function addPage (placement: PagePlacement): void {
    const page = createPage('', placement)
    commit((d) => {
      d.pages.push(page)
    })
    section = { kind: 'page', id: page.id }
    selected = []
  }

  function changePage (patch: Partial<TemplatePage>): void {
    if (currentPage === undefined) return
    const id = currentPage.id
    commit((d) => {
      d.pages = d.pages.map((p) => (p.id === id ? { ...p, ...patch } : p))
    }, `page-${id}-${Object.keys(patch).join()}`)
  }

  function removePage (): void {
    if (currentPage === undefined) return
    const id = currentPage.id
    commit((d) => {
      d.pages = d.pages.filter((p) => p.id !== id)
    })
    section = { kind: 'setup' }
    selected = []
  }

  function arrange (fn: (elements: TemplateElement[], ids: Set<string>) => TemplateElement[]): void {
    if (surfaceRef === undefined || selected.length === 0) return
    const ids = new Set(selected)
    updateElements(surfaceRef, (elements) => fn(elements, ids))
  }

  function copySelected (): void {
    if (selectedElements.length > 0) {
      copyElements(selectedElements)
      canPaste = true
    }
  }

  function paste (): void {
    if (surfaceRef === undefined) return
    const pasted = pasteElements()
    if (pasted.length === 0) return
    updateElements(surfaceRef, (elements) => [...elements, ...pasted])
    selected = pasted.map((el) => el.id)
  }

  function editText (id: string, text: string): void {
    if (surfaceRef === undefined) return
    updateElements(surfaceRef, (elements) =>
      elements.map((el) => (el.id === id && el.kind === 'text' ? { ...el, text } : el))
    )
  }

  function changeOverlay (patch: Partial<TemplateOverlay>): void {
    commit((d) => {
      d.overlay = { ...d.overlay, ...patch }
    }, `overlay-${Object.keys(patch).join()}`)
  }

  function addWatermark (kind: 'text' | 'image'): void {
    if (kind === 'text') {
      const el = createWatermark(design.page)
      commit((d) => {
        d.overlay = { ...d.overlay, enabled: true, elements: [...d.overlay.elements, el] }
      })
      selected = [el.id]
      return
    }
    showPopup(AssetPicker, { kind: 'image' }, 'top', (asset: BrandAsset | undefined) => {
      if (asset === undefined) return
      const { width, height } = getPageDimensions(design.page)
      const size = Math.min(width, height) * 0.6
      const el = createElement('image', {
        name: 'Watermark',
        x: (width - size) / 2,
        y: (height - size) / 2,
        width: size,
        height: size,
        opacity: 0.1,
        file: asset.file
      })
      commit((d) => {
        d.overlay = { ...d.overlay, enabled: true, elements: [...d.overlay.elements, el] }
      })
      selected = [el.id]
    })
  }

  let canPaste = hasClipboard()

  function changeBand (patch: Partial<TemplateBand>): void {
    const kind = section.kind
    if (kind !== 'header' && kind !== 'footer') return
    const variant = (section as { variant?: string }).variant
    commit((d) => {
      if (variant === undefined) {
        d[kind] = { ...d[kind], ...patch }
      } else {
        const key = kind === 'header' ? 'headerAlternates' : 'footerAlternates'
        d[key] = d[key].map((b) => (b.id === variant ? { ...b, ...patch } : b))
      }
    }, `band-${kind}-${variant ?? 'main'}-${Object.keys(patch).join()}`)
  }

  const ALTERNATE_PRESETS: Array<{ id: string, label: IntlString, rule: PageRule }> = [
    { id: 'first', label: branding.string.PagesFirst, rule: { scope: 'content', pages: 'first' } },
    { id: 'odd', label: branding.string.PagesOdd, rule: { scope: 'content', pages: 'odd' } },
    { id: 'even', label: branding.string.PagesEven, rule: { scope: 'content', pages: 'even' } },
    { id: 'last', label: branding.string.PagesLast, rule: { scope: 'content', pages: 'last' } },
    { id: 'custom', label: branding.string.PagesCustom, rule: { scope: 'content', pages: 'custom', custom: '1' } }
  ]

  function addAlternate (kind: 'header' | 'footer', e: MouseEvent): void {
    showPopup(
      SelectPopup,
      { value: ALTERNATE_PRESETS.map((p) => ({ id: p.id, label: p.label })) },
      eventToHTMLElement(e),
      (id: string | undefined) => {
        const preset = ALTERNATE_PRESETS.find((p) => p.id === id)
        if (preset === undefined) return
        void translate(preset.label, {}, $languageStore).then((name) => {
          const band = createAlternateBand(kind === 'header' ? design.header : design.footer, name, preset.rule)
          commit((d) => {
            const key = kind === 'header' ? 'headerAlternates' : 'footerAlternates'
            d[key] = [...d[key], band]
          })
          section = { kind, variant: band.id }
          selected = []
        })
      }
    )
  }

  function addHeaderAlternate (e: MouseEvent): void {
    addAlternate('header', e)
  }

  function addFooterAlternate (e: MouseEvent): void {
    addAlternate('footer', e)
  }

  function removeAlternate (): void {
    const kind = section.kind
    const variant = (section as { variant?: string }).variant
    if ((kind !== 'header' && kind !== 'footer') || variant === undefined) return
    commit((d) => {
      const key = kind === 'header' ? 'headerAlternates' : 'footerAlternates'
      d[key] = d[key].filter((b) => b.id !== variant)
    })
    section = { kind }
    selected = []
  }

  function isBandSelected (kind: 'header' | 'footer', variant: string | undefined): boolean {
    return section.kind === kind && (section as { variant?: string }).variant === variant
  }

  function setZoom (direction: 1 | -1): void {
    const index = ZOOMS.findIndex((z) => z >= zoom - 0.001)
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (index < 0 ? ZOOMS.length - 1 : index) + direction))]
    zoom = next
  }

  async function save (): Promise<void> {
    if (onApply !== undefined) {
      onApply(clone(design))
      dirty = false
      dispatch('close')
      return
    }
    if (template === undefined) return
    saving = true
    try {
      await client.updateDoc(branding.class.PrintTemplate, template.space, template._id, {
        name: name.trim() !== '' ? name.trim() : template.name,
        templateType: templateType.trim() !== '' ? templateType.trim() : 'other',
        design
      })
      dirty = false
    } catch (err: unknown) {
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      saving = false
    }
  }

  function close (): void {
    if (!dirty) {
      dispatch('close')
      return
    }
    showPopup(
      MessageBox,
      { label: branding.string.Discard, message: branding.string.UnsavedChanges, dangerous: true },
      'top',
      (result?: boolean) => {
        if (result === true) dispatch('close')
      }
    )
  }

  function isEditableTarget (target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    return el !== null && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  }

  function onKeyDown (e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
      return
    }
    if (isEditableTarget(e.target)) return
    let handled = true
    if (mod && e.key.toLowerCase() === 'z') {
      e.shiftKey ? redo() : undo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      redo()
    } else if (mod && e.key.toLowerCase() === 'd') {
      duplicateSelected()
    } else if (mod && e.key.toLowerCase() === 'c') {
      copySelected()
    } else if (mod && e.key.toLowerCase() === 'x') {
      copySelected()
      removeSelected()
    } else if (mod && e.key.toLowerCase() === 'v') {
      paste()
    } else if (mod && e.key.toLowerCase() === 'a' && surface !== undefined) {
      selected = surface.elements.filter((el) => el.hidden !== true && el.locked !== true).map((el) => el.id)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      removeSelected()
    } else if (e.key === 'Escape') {
      if (selected.length > 0) selected = []
      else close()
    } else if (e.key.startsWith('Arrow') && selected.length > 0) {
      const step = e.shiftKey ? 5 : 0.5
      nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
    } else {
      handled = false
    }
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function pageLabel (page: TemplatePage, index: number): string {
    return page.name !== '' ? page.name : `#${index + 1}`
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  })
</script>

<svelte:head>
  {@html styleTag(fontCss)}
</svelte:head>

<div class="editor">
  <div class="toolbar">
    <Button icon={IconClose} kind={'ghost'} on:click={close} />
    <Icon icon={branding.icon.Template} size={'small'} />
    {#if sessionMode}
      <span class="session-title"><Label label={branding.string.CustomizeLayoutTitle} /></span>
    {:else}
    <input class="title" type="text" bind:value={name} on:input={() => (dirty = true)} />
    <div class="type">
      <SelectField
        value={customType ? CUSTOM_TYPE : templateType}
        options={typeOptions}
        on:change={(e) => {
          selectType(e.detail)
        }}
      />
    </div>
    {#if customType}
      <input
        class="custom-type"
        type="text"
        bind:value={templateType}
        placeholder={customTypePlaceholder}
        on:input={() => (dirty = true)}
      />
    {/if}
    {/if}
    <div class="divider" />
    <div class="tools" class:disabled={surface === undefined}>
      <Button icon={branding.icon.Text} kind={'ghost'} showTooltip={{ label: branding.string.Text }} disabled={surface === undefined} on:click={() => addElement('text')} />
      <Button icon={branding.icon.Field} kind={'ghost'} showTooltip={{ label: branding.string.Field }} disabled={surface === undefined} on:click={() => addElement('text', true)} />
      <Button icon={branding.icon.Image} kind={'ghost'} showTooltip={{ label: branding.string.Image }} disabled={surface === undefined} on:click={addImage} />
      <Button icon={branding.icon.Rectangle} kind={'ghost'} showTooltip={{ label: branding.string.Rectangle }} disabled={surface === undefined} on:click={() => addElement('shape')} />
      <Button
        icon={branding.icon.Ellipse}
        kind={'ghost'}
        showTooltip={{ label: branding.string.Ellipse }}
        disabled={surface === undefined}
        on:click={() => addElement('shape', false, true)}
      />
      <Button icon={branding.icon.Line} kind={'ghost'} showTooltip={{ label: branding.string.Line }} disabled={surface === undefined} on:click={() => addElement('line')} />
    </div>
    <div class="divider" />
    <Button icon={IconUndo} kind={'ghost'} disabled={past.length === 0} showTooltip={{ label: branding.string.Undo }} on:click={undo} />
    <Button icon={IconRedo} kind={'ghost'} disabled={future.length === 0} showTooltip={{ label: branding.string.Redo }} on:click={redo} />
    <div class="divider" />
    <button type="button" class="zoom-btn" on:click={() => setZoom(-1)}>−</button>
    <span class="zoom">{Math.round(zoom * 100)}%</span>
    <button type="button" class="zoom-btn" on:click={() => setZoom(1)}>+</button>
    <div class="grow" />
    <label class="sample">
      <input type="checkbox" bind:checked={sampleData} />
      <Label label={branding.string.SampleData} />
    </label>
    <Button
      label={branding.string.Assets}
      kind={'ghost'}
      on:click={(e) => showPopup(AssetPicker, { kind: 'image', manage: true }, eventToHTMLElement(e))}
    />
    <Button
      label={branding.string.Fonts}
      kind={'ghost'}
      on:click={(e) => showPopup(AssetPicker, { kind: 'font', manage: true }, eventToHTMLElement(e))}
    />
    <Button
      label={sessionMode ? branding.string.ApplyToPrint : branding.string.Save}
      kind={'primary'}
      disabled={!dirty && !sessionMode}
      loading={saving}
      on:click={save}
    />
  </div>

  <div class="body">
    <div class="nav">
      <Scroller>
        <button type="button" class="nav-item" class:selected={section.kind === 'setup'} on:click={() => selectSection({ kind: 'setup' })}>
          <Icon icon={branding.icon.Page} size={'small'} /><Label label={branding.string.PageSetup} />
        </button>

        <div class="nav-group">
          <Label label={branding.string.BeforeContent} />
          <button type="button" class="add" title="+" on:click={() => addPage('before')}><Icon icon={IconAdd} size={'small'} /></button>
        </div>
        {#each beforePages as page, i (page.id)}
          <button
            type="button"
            class="nav-item page"
            class:selected={section.kind === 'page' && section.id === page.id}
            class:disabled={!page.enabled}
            on:click={() => selectSection({ kind: 'page', id: page.id })}
          >
            <Icon icon={branding.icon.Page} size={'small'} /><span class="overflow-label">{pageLabel(page, i)}</span>
          </button>
        {/each}

        <button type="button" class="nav-item content" class:selected={section.kind === 'typography'} on:click={() => selectSection({ kind: 'typography' })}>
          <Icon icon={branding.icon.Typography} size={'small'} /><Label label={branding.string.Content} />
        </button>
        <div class="nested">
          <div class="nav-band">
            <button type="button" class="nav-item" class:selected={isBandSelected('header', undefined)} class:disabled={!design.header.enabled} on:click={() => selectSection({ kind: 'header' })}>
              <Icon icon={branding.icon.Header} size={'small'} /><Label label={branding.string.Header} />
            </button>
            <button type="button" class="add" use:tooltip={{ label: branding.string.AddAlternate }} on:click={addHeaderAlternate}>
              <Icon icon={IconAdd} size={'small'} />
            </button>
          </div>
          {#each design.headerAlternates as band (band.id)}
            <button
              type="button"
              class="nav-item alternate"
              class:selected={isBandSelected('header', band.id)}
              class:disabled={!band.enabled}
              on:click={() => selectSection({ kind: 'header', variant: band.id })}
            >
              <span class="overflow-label">↳ {band.name ?? ''}</span>
            </button>
          {/each}
          <button type="button" class="nav-item" class:selected={section.kind === 'typography'} on:click={() => selectSection({ kind: 'typography' })}>
            <Icon icon={branding.icon.Typography} size={'small'} /><Label label={branding.string.Typography} />
          </button>
          <div class="nav-band">
            <button type="button" class="nav-item" class:selected={isBandSelected('footer', undefined)} class:disabled={!design.footer.enabled} on:click={() => selectSection({ kind: 'footer' })}>
              <Icon icon={branding.icon.Footer} size={'small'} /><Label label={branding.string.Footer} />
            </button>
            <button type="button" class="add" use:tooltip={{ label: branding.string.AddAlternate }} on:click={addFooterAlternate}>
              <Icon icon={IconAdd} size={'small'} />
            </button>
          </div>
          {#each design.footerAlternates as band (band.id)}
            <button
              type="button"
              class="nav-item alternate"
              class:selected={isBandSelected('footer', band.id)}
              class:disabled={!band.enabled}
              on:click={() => selectSection({ kind: 'footer', variant: band.id })}
            >
              <span class="overflow-label">↳ {band.name ?? ''}</span>
            </button>
          {/each}
          <button type="button" class="nav-item" class:selected={section.kind === 'overlay'} class:disabled={!design.overlay.enabled} on:click={() => selectSection({ kind: 'overlay' })}>
            <Icon icon={branding.icon.Watermark} size={'small'} /><Label label={branding.string.Overlay} />
          </button>
        </div>

        <div class="nav-group">
          <Label label={branding.string.AfterContent} />
          <button type="button" class="add" title="+" on:click={() => addPage('after')}><Icon icon={IconAdd} size={'small'} /></button>
        </div>
        {#each afterPages as page, i (page.id)}
          <button
            type="button"
            class="nav-item page"
            class:selected={section.kind === 'page' && section.id === page.id}
            class:disabled={!page.enabled}
            on:click={() => selectSection({ kind: 'page', id: page.id })}
          >
            <Icon icon={branding.icon.Page} size={'small'} /><span class="overflow-label">{pageLabel(page, i)}</span>
          </button>
        {/each}
      </Scroller>
    </div>

    <div class="workspace">
      <Scroller horizontal>
        <div class="stage">
          {#if surface !== undefined && surfaceRef !== undefined}
            {@const ref = surfaceRef}
            <PageCanvas
              {surface}
              margins={design.page.margins}
              {zoom}
              {selected}
              {resolveFile}
              values={sampleValues}
              keepPlaceholders={!sampleData}
              on:select={(e) => (selected = e.detail.ids)}
              on:begin={pushHistory}
              on:textEdit={(e) => editText(e.detail.id, e.detail.text)}
              on:update={(e) => {
                setSurfaceElements(design, ref, e.detail.elements)
                design = design
                dirty = true
              }}
            />
          {:else if section.kind === 'typography' || section.kind === 'setup'}
            <div class="sample-hint"><Label label={branding.string.SampleContentHint} /></div>
            <TypographyPreview
              {design}
              {zoom}
              {resolveFile}
              values={sampleValues}
              keepPlaceholders={!sampleData}
              beforeCount={enabledBefore}
              afterCount={enabledAfter}
              on:pick={(e) => {
              typographyLevel = e.detail
              section = { kind: 'typography' }
            }} />
          {/if}
        </div>
      </Scroller>
    </div>

    <div class="props">
      <Scroller>
        {#if section.kind === 'setup'}
          <PageSetupPanel
            page={design.page}
            numbering={design.numbering}
            on:change={(e) => commit((d) => { d.page = e.detail }, 'setup')}
            on:numbering={(e) => commit((d) => { d.numbering = e.detail }, 'numbering')}
          />
        {:else if section.kind === 'typography'}
          <TypographyPanel
            typography={design.typography}
            {customFonts}
            bind:level={typographyLevel}
            on:change={(e) => commit((d) => { d.typography = e.detail }, `typography-${typographyLevel}`)}
          />
        {:else if selectedElements.length > 0 && surface !== undefined}
          {@const bounds = { width: surface.width, height: surface.height }}
          <ArrangeBar
            count={selectedElements.length}
            {canPaste}
            on:align={(e) => arrange((elements, ids) => alignElements(elements, ids, e.detail, bounds))}
            on:distribute={(e) => arrange((elements, ids) => distributeElements(elements, ids, e.detail))}
            on:order={(e) => arrange((elements, ids) => reorderElements(elements, ids, e.detail))}
            on:copy={copySelected}
            on:paste={paste}
          />
          {#if selectedElement !== undefined}
            {#key selectedElement.id}
              <ElementProperties
                element={selectedElement}
                {fields}
                {attributeFields}
                {customFonts}
                pageFields={isBandSection}
                pageRules={isBandSection || isOverlaySection}
                on:change={(e) => changeSelected(e.detail)}
                on:remove={removeSelected}
                on:duplicate={duplicateSelected}
              />
            {/key}
          {/if}
        {:else}
          {#if selected.length === 0}
            <div class="hint"><Label label={branding.string.NoSelection} /></div>
          {/if}
          <SurfaceProperties
            page={currentPage}
            band={currentBand}
            alternate={isAlternate}
            overlay={section.kind === 'overlay' ? design.overlay : undefined}
            on:removeAlternate={removeAlternate}
            on:page={(e) => changePage(e.detail)}
            on:band={(e) => changeBand(e.detail)}
            on:overlay={(e) => changeOverlay(e.detail)}
            on:watermark={(e) => addWatermark(e.detail)}
            on:remove={removePage}
          />
        {/if}
        {#if surface !== undefined && surface.elements.length > 0}
          <LayersPanel
            elements={surface.elements}
            {selected}
            on:select={(e) => (selected = e.detail.ids)}
            on:move={(e) => moveLayer(e.detail.id, e.detail.delta)}
            on:toggle={(e) => toggleLayer(e.detail.id, e.detail.key)}
          />
        {/if}
      </Scroller>
    </div>
  </div>
</div>

<style lang="scss">
  .editor {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--theme-bg-color);
    color: var(--theme-content-color);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.375rem 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);
    background: var(--theme-comp-header-color);
    flex-shrink: 0;
  }
  .title {
    width: 16rem;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--theme-caption-color);
    font-weight: 600;
    font-size: 0.9375rem;
    padding: 0.25rem 0.375rem;
    outline: none;

    &:hover,
    &:focus {
      border-color: var(--theme-button-border);
    }
  }
  .type {
    width: 9rem;
  }
  .session-title {
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .custom-type {
    width: 9rem;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
    background: var(--theme-button-default);
    color: var(--theme-caption-color);
    padding: 0.25rem 0.375rem;
    font-size: 0.8125rem;
    outline: none;
  }
  .sample {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-right: 0.5rem;
    font-size: 0.8125rem;
    cursor: pointer;

    input {
      accent-color: var(--primary-button-default);
    }
  }
  .divider {
    width: 1px;
    height: 1.5rem;
    margin: 0 0.25rem;
    background: var(--theme-divider-color);
  }
  .tools {
    display: flex;
    gap: 0.125rem;
  }
  .zoom-btn {
    width: 1.75rem;
    height: 1.75rem;
    border: none;
    border-radius: 0.25rem;
    background: none;
    color: var(--theme-content-color);
    font-size: 1rem;
    cursor: pointer;

    &:hover {
      background: var(--theme-button-hovered);
    }
  }
  .zoom {
    min-width: 3rem;
    text-align: center;
    font-size: 0.8125rem;
  }
  .grow {
    flex-grow: 1;
  }
  .body {
    display: flex;
    flex-grow: 1;
    min-height: 0;
  }
  .nav {
    display: flex;
    flex-direction: column;
    width: 15rem;
    flex-shrink: 0;
    padding: 0.5rem;
    border-right: 1px solid var(--theme-divider-color);
    background: var(--theme-navpanel-color);
  }
  .nav-group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0.75rem 0.25rem 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--theme-dark-color);

    .add {
      display: flex;
      border: none;
      background: none;
      color: var(--theme-dark-color);
      cursor: pointer;
      border-radius: 0.25rem;

      &:hover {
        color: var(--theme-caption-color);
        background: var(--theme-button-hovered);
      }
    }
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.375rem 0.5rem;
    border: none;
    border-radius: 0.375rem;
    background: none;
    color: var(--theme-content-color);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--theme-navpanel-hovered);
    }
    &.selected {
      background: var(--theme-navpanel-selected);
      color: var(--theme-caption-color);
    }
    &.disabled {
      opacity: 0.5;
    }
    &.content {
      margin-top: 0.75rem;
      font-weight: 600;
    }
  }
  .nav-band {
    display: flex;
    align-items: center;

    .nav-item {
      flex-grow: 1;
    }
    .add {
      display: flex;
      padding: 0.25rem;
      border: none;
      border-radius: 0.25rem;
      background: none;
      color: var(--theme-dark-color);
      cursor: pointer;

      &:hover {
        color: var(--theme-caption-color);
        background: var(--theme-button-hovered);
      }
    }
  }
  .nav-item.alternate {
    padding-left: 1.75rem;
    font-size: 0.75rem;
  }
  .nested {
    margin-left: 0.75rem;
    padding-left: 0.25rem;
    border-left: 1px solid var(--theme-divider-color);
  }
  .workspace {
    display: flex;
    flex-grow: 1;
    min-width: 0;
    background: var(--theme-bg-dark-color);
  }
  .stage {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    align-items: center;
    min-width: 100%;
    width: max-content;
    padding: 2rem;
  }
  .props {
    display: flex;
    flex-direction: column;
    width: 19rem;
    flex-shrink: 0;
    border-left: 1px solid var(--theme-divider-color);
    background: var(--theme-panel-color);
  }
  .sample-hint {
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
  }
  .hint {
    padding: 0.75rem;
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
  }
</style>
