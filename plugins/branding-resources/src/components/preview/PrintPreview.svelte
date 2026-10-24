<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import type { Blob, Doc, Ref } from '@hcengineering/core'
  import {
    type ComposeDocumentOptions,
    type FieldValues,
    type PrintTemplate,
    type RenderContext,
    type TemplateDesign,
    type TemplateElement,
    ATTRIBUTE_FIELD_PREFIX,
    BUILTIN_FIELDS,
    CUSTOM_FIELD_PREFIX,
    PAGE_FIELDS,
    contentMargins,
    createElement,
    defaultTextStyle,
    describePages,
    extractFields,
    fieldPlaceholder,
    fontFacesCss,
    getPageDimensions,
    getTemplateType,
    normalizeDesign
  } from '@hcengineering/branding'
  import { getEmbeddedLabel, getMetadata, type IntlString } from '@hcengineering/platform'
  import presentation, { createQuery, getClient, getFileUrl } from '@hcengineering/presentation'
  import { signPDF } from '@hcengineering/sign'
  import {
    Breadcrumb,
    Button,
    DropdownLabels,
    Header,
    IconAdd,
    IconClose,
    IconRedo,
    IconUndo,
    Label,
    Loading,
    Scroller,
    SelectPopup,
    type SelectPopupValueType,
    eventToHTMLElement,
    showPopup,
    tooltip
  } from '@hcengineering/ui'
  import { getDocTitle } from '@hcengineering/view-resources'
  import { createEventDispatcher, tick } from 'svelte'

  import { collectDesignTexts, getPreviewFonts } from '../../assets'
  import { type BodySource, buildContentHtml, detectBodySources, imageBlocks, loadContentBlocks } from '../../body'
  import { composeWithDesign, filterTemplatesForClass } from '../../compose'
  import {
    type SurfaceRef,
    alignElements,
    clone,
    copyElements,
    distributeElements,
    getSurface,
    hasClipboard,
    pasteElements,
    reorderElements,
    setSurfaceElements,
    styleTag
  } from '../../editor/utils'
  import {
    BUILTIN_FIELD_LABELS,
    type FieldInfo,
    getAttributeFields,
    getFieldInfos,
    resolveFieldValues
  } from '../../fields'
  import branding from '../../plugin'
  import { SAMPLE_CONTENT_PAGES, templateTypeLabel } from '../../sample'
  import ArrangeBar from '../editor/ArrangeBar.svelte'
  import ElementProperties from '../editor/ElementProperties.svelte'
  import PageCanvas from '../editor/PageCanvas.svelte'
  import TemplateEditor from '../editor/TemplateEditor.svelte'
  import TypographyPreview from '../editor/TypographyPreview.svelte'
  import BodyPages from './BodyPages.svelte'
  import PreviewPage from './PreviewPage.svelte'
  import QuickChanges from './QuickChanges.svelte'

  export let object: Doc
  export let template: Ref<PrintTemplate> | undefined = undefined
  export let signed: boolean = false
  // Existing PDF used as document body (e.g. a Drive file)
  export let file: string | undefined = undefined

  const dispatch = createEventDispatcher<{ close: string | undefined }>()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  let templates: PrintTemplate[] = []
  let selectedId: Ref<PrintTemplate> | undefined = template
  let design: TemplateDesign | undefined
  let resolved: FieldValues = {}
  let values: FieldValues = {}
  let overrides: Record<string, string> = {}
  // Fields added in this preview on top of the ones the template uses
  let extraFields: string[] = []
  let loadingValues = false
  let saving = false
  let error: string | undefined
  let zoom = 0.75
  let title = ''
  let loadedFor: Ref<PrintTemplate> | undefined

  const templatesQuery = createQuery()
  templatesQuery.query(
    branding.class.PrintTemplate,
    {},
    (res) => {
      templates = filterTemplatesForClass(client, res, object._class)
      if (selectedId === undefined || !templates.some((t) => t._id === selectedId)) {
        selectedId = templates[0]?._id
      }
    },
    { sort: { name: 1 } }
  )

  let fontAssets: Array<{ family: string, url: string }> = []
  const fontQuery = createQuery()
  fontQuery.query(branding.class.BrandAsset, { kind: 'font' }, (res) => {
    fontAssets = getPreviewFonts(res)
  })

  $: current = templates.find((t) => t._id === selectedId)
  $: if (current?._id !== loadedFor) void selectTemplate(current)
  $: void getDocTitle(client, object._id, object._class, object).then((t) => (title = t ?? ''))

  async function selectTemplate (t: PrintTemplate | undefined): Promise<void> {
    loadedFor = t?._id
    if (t === undefined) {
      design = undefined
      return
    }
    design = clone(normalizeDesign(t.design))
    overrides = {}
    // A different template starts a new editing session
    past = []
    future = []
    selected = []
    selectedPageId = undefined
    loadingValues = true
    try {
      resolved = await resolveFieldValues(client, object, [
        ...collectDesignTexts(design),
        ...extraFields.map(fieldPlaceholder)
      ])
      values = { ...resolved, ...Object.fromEntries(Object.entries(values).filter(([k]) => k.startsWith(CUSTOM_FIELD_PREFIX))) }
    } catch (err: unknown) {
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      loadingValues = false
    }
  }

  $: ctx = {
    values,
    overrides,
    mode: 'preview',
    resolveFile: (f: string) => getFileUrl(f)
  } satisfies RenderContext

  $: usedFields =
    design !== undefined
      ? Array.from(
        new Set([...collectDesignTexts(design).flatMap((t) => extractFields(t)), ...extraFields])
      ).filter((key) => !(PAGE_FIELDS as readonly string[]).includes(key))
      : []

  function fieldLabel (key: string): IntlString {
    if ((BUILTIN_FIELDS as readonly string[]).includes(key)) {
      return BUILTIN_FIELD_LABELS[key as keyof typeof BUILTIN_FIELD_LABELS]
    }
    if (key.startsWith(ATTRIBUTE_FIELD_PREFIX)) {
      const attr = hierarchy.getAllAttributes(object._class).get(key.slice(ATTRIBUTE_FIELD_PREFIX.length))
      if (attr?.label !== undefined) return attr.label
    }
    if (key.startsWith(CUSTOM_FIELD_PREFIX)) {
      return getEmbeddedLabel(key.slice(CUSTOM_FIELD_PREFIX.length).replace(/_/g, ' '))
    }
    return getEmbeddedLabel(key)
  }

  $: beforePages = design?.pages.filter((p) => p.enabled && p.placement === 'before') ?? []
  $: afterPages = design?.pages.filter((p) => p.enabled && p.placement === 'after') ?? []
  $: margins = design?.page.margins ?? { top: 0, right: 0, bottom: 0, left: 0 }
  $: contentTop = design !== undefined ? contentMargins(design).top : 0
  $: contentCount = layoutBody ? bodyPages : 1
  $: positions = describePages(beforePages.length, contentCount, afterPages.length)

  // ---- Undo / redo of everything changed in the preview
  interface PreviewState {
    design: TemplateDesign | undefined
    values: FieldValues
    overrides: Record<string, string>
    breaks: number[]
    includeTitle: boolean
    extraFields: string[]
  }

  const HISTORY_LIMIT = 100
  let past: PreviewState[] = []
  let future: PreviewState[] = []
  let lastRecord: { key: string, time: number } | undefined

  function snapshot (): PreviewState {
    return {
      design: design !== undefined ? clone(design) : undefined,
      values: { ...values },
      overrides: { ...overrides },
      breaks: Array.from(breaks),
      includeTitle,
      extraFields: [...extraFields]
    }
  }

  function restore (state: PreviewState): void {
    design = state.design
    values = state.values
    overrides = state.overrides
    breaks = new Set(state.breaks)
    includeTitle = state.includeTitle
    extraFields = state.extraFields
    selected = selected.filter((id) => selectedSurface()?.elements.some((el) => el.id === id) ?? false)
  }

  /**
   * Remember the state before a change; consecutive changes with the same key (typing) form one step.
   */
  function record (key?: string): void {
    const now = Date.now()
    if (key !== undefined && lastRecord?.key === key && now - lastRecord.time < 1500) {
      lastRecord = { key, time: now }
      return
    }
    lastRecord = key !== undefined ? { key, time: now } : undefined
    past = [...past.slice(-HISTORY_LIMIT + 1), snapshot()]
    future = []
  }

  function undo (): void {
    const prev = past[past.length - 1]
    if (prev === undefined) return
    future = [snapshot(), ...future]
    past = past.slice(0, -1)
    lastRecord = undefined
    restore(prev)
  }

  function redo (): void {
    const [next, ...rest] = future
    if (next === undefined) return
    past = [...past, snapshot()]
    future = rest
    lastRecord = undefined
    restore(next)
  }

  // ---- Values
  function addField (e: MouseEvent): void {
    const used = new Set(usedFields)
    const items: SelectPopupValueType[] = [
      ...getFieldInfos(false)
        .filter((f) => !used.has(f.key))
        .map((f) => ({ id: f.key, label: f.label })),
      ...getAttributeFields(client, object._class)
        .filter((f) => !used.has(f.key))
        .map((f) => ({ id: f.key, label: f.label, category: { label: branding.string.DocumentAttribute } })),
      { id: CUSTOM_FIELD_PREFIX, label: branding.string.CustomField, icon: IconAdd }
    ]
    showPopup(SelectPopup, { value: items, searchable: true }, eventToHTMLElement(e), (key: string | undefined) => {
      if (key === undefined) return
      if (key === CUSTOM_FIELD_PREFIX) {
        customFieldName = ''
        addingCustom = true
        void tick().then(() => customInput?.focus())
        return
      }
      void includeField(key)
    })
  }

  let addingCustom = false
  let customFieldName = ''
  let customInput: HTMLInputElement | undefined

  function addCustomField (): void {
    const name = customFieldName.trim().replace(/[^A-Za-z0-9_.-]+/g, '_')
    addingCustom = false
    if (name !== '') void includeField(`${CUSTOM_FIELD_PREFIX}${name}`)
  }

  async function includeField (key: string): Promise<void> {
    if (usedFields.includes(key)) return
    record()
    extraFields = [...extraFields, key]
    if (!key.startsWith(CUSTOM_FIELD_PREFIX)) {
      const value = await resolveFieldValues(client, object, [fieldPlaceholder(key)])
      resolved = { ...resolved, ...value }
      values = { ...values, [key]: value[key] ?? '' }
    } else {
      values = { ...values, [key]: '' }
    }
  }

  /**
   * Put a text box with the field on the first template page, ready to be moved in page editing.
   */
  function placeField (key: string): void {
    if (design === undefined) return
    const page = design.pages.find((p) => p.enabled) ?? design.pages[0]
    if (page === undefined) return
    const { width, height } = getPageDimensions(design.page)
    const el = createElement('text', {
      x: width / 2 - 40,
      y: height / 2,
      width: 80,
      height: 10,
      text: fieldPlaceholder(key),
      style: defaultTextStyle({ fontSize: 12 })
    })
    record()
    design.pages = design.pages.map((p) => (p.id === page.id ? { ...p, enabled: true, elements: [...p.elements, el] } : p))
    editPages = true
    selectedPageId = page.id
    selected = [el.id]
  }

  // ---- Document body
  let sources: BodySource[] = []
  let sourceIndex = 0
  let blocks: string[] = []
  let loadingBody = true
  let breaks = new Set<number>()
  let includeTitle = true
  let bodyPages = 1

  $: source = sources[sourceIndex]
  // Rich text and images are laid out here, so page breaks can be set
  $: layoutBody =
    source !== undefined &&
    (source.kind === 'content' || (source.kind === 'file' && source.contentType.startsWith('image/')))
  $: void loadBody(source)

  void detectBodySources(client, object).then(
    (res) => {
      sources =
        file !== undefined ? [{ kind: 'file', file: file as Ref<Blob>, contentType: 'application/pdf', name: title }] : res
      sourceIndex = 0
    },
    (err: unknown) => {
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
      sources = [{ kind: 'page' }]
      loadingBody = false
    }
  )

  let bodyRequest = 0
  async function loadBody (s: BodySource | undefined): Promise<void> {
    if (s === undefined) return
    const request = ++bodyRequest
    breaks = new Set()
    blocks = []
    if (s.kind === 'page' || (s.kind === 'file' && !s.contentType.startsWith('image/'))) {
      loadingBody = false
      return
    }
    loadingBody = true
    try {
      const result = s.kind === 'content' ? await loadContentBlocks(client, object, s.attribute) : await imageBlocks(s)
      if (request === bodyRequest) blocks = result
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      Analytics.handleError(e)
      error = e.message
    } finally {
      if (request === bodyRequest) loadingBody = false
    }
  }

  function toggleBreak (index: number): void {
    record()
    const next = new Set(breaks)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    breaks = next
  }

  function sourceLabel (s: BodySource): IntlString {
    if (s.kind === 'content') return s.label
    if (s.kind === 'file') return getEmbeddedLabel(s.name)
    return branding.string.BodyPage
  }

  $: documentTitle = includeTitle && source?.kind === 'content' ? values.title ?? title : ''

  // ---- Direct editing of template pages
  let editPages = false
  let selectedPageId: string | undefined
  let selected: string[] = []
  let canPaste = hasClipboard()
  let savedToTemplate = false

  $: customFonts = fontAssets.map((f) => f.family)
  $: valueFields = [
    ...getFieldInfos(false),
    ...extraFields
      .filter((k) => k.startsWith(CUSTOM_FIELD_PREFIX))
      .map((key): FieldInfo => ({ key, label: fieldLabel(key) }))
  ]
  $: attributeFields = getAttributeFields(client, object._class)
  $: selectedRef = selectedPageId !== undefined ? ({ kind: 'page', id: selectedPageId } satisfies SurfaceRef) : undefined
  $: selectedElements =
    design !== undefined && editPages ? selectedSurface()?.elements.filter((el) => selected.includes(el.id)) ?? [] : []
  $: selectedElement = selectedElements.length === 1 ? selectedElements[0] : undefined

  function selectedSurface (): ReturnType<typeof getSurface> {
    return design !== undefined && selectedPageId !== undefined
      ? getSurface(design, { kind: 'page', id: selectedPageId })
      : undefined
  }

  function updatePageElements (fn: (elements: TemplateElement[]) => TemplateElement[], key?: string): void {
    if (design === undefined || selectedRef === undefined) return
    const surface = getSurface(design, selectedRef)
    if (surface === undefined) return
    record(key)
    setSurfaceElements(design, selectedRef, fn(surface.elements))
    design = design
  }

  function changeSelected (patch: Partial<TemplateElement>): void {
    const id = selectedElement?.id
    if (id === undefined) return
    updatePageElements(
      (elements) => elements.map((el) => (el.id === id ? ({ ...el, ...patch } as TemplateElement) : el)),
      `props-${id}-${Object.keys(patch).join()}`
    )
  }

  function removeSelected (): void {
    const ids = new Set(selected)
    updatePageElements((elements) => elements.filter((el) => !ids.has(el.id)))
    selected = []
  }

  function duplicateSelected (): void {
    copyElements(selectedElements)
    canPaste = true
    const copies = pasteElements()
    updatePageElements((elements) => [...elements, ...copies])
    selected = copies.map((el) => el.id)
  }

  function pasteIntoPage (): void {
    const pasted = pasteElements()
    if (pasted.length === 0) return
    updatePageElements((elements) => [...elements, ...pasted])
    selected = pasted.map((el) => el.id)
  }

  function selectionBounds (): { width: number, height: number } {
    const surface = selectedSurface()
    return { width: surface?.width ?? 0, height: surface?.height ?? 0 }
  }

  function customizeLayout (): void {
    if (design === undefined) return
    showPopup(
      TemplateEditor,
      {
        initialDesign: design,
        documentClass: object._class,
        onApply: (next: TemplateDesign) => {
          record()
          design = next
          selected = []
        }
      },
      'content'
    )
  }

  async function saveToTemplate (): Promise<void> {
    if (design === undefined || current === undefined) return
    try {
      await client.updateDoc(branding.class.PrintTemplate, current.space, current._id, { design: clone(design) })
      savedToTemplate = true
      setTimeout(() => {
        savedToTemplate = false
      }, 2500)
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      Analytics.handleError(e)
      error = e.message
    }
  }

  function isEditableTarget (target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    return el !== null && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  }

  function onKeyDown (e: KeyboardEvent): void {
    if (isEditableTarget(e.target)) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    let handled = true
    if (mod && key === 'z') {
      e.shiftKey ? redo() : undo()
    } else if (mod && key === 'y') {
      redo()
    } else if (editPages && mod && key === 'c' && selectedElements.length > 0) {
      copyElements(selectedElements)
      canPaste = true
    } else if (editPages && mod && key === 'v') {
      pasteIntoPage()
    } else if (editPages && mod && key === 'd' && selectedElements.length > 0) {
      duplicateSelected()
    } else if (editPages && (e.key === 'Delete' || e.key === 'Backspace') && selected.length > 0) {
      removeSelected()
    } else if (editPages && e.key === 'Escape' && selected.length > 0) {
      selected = []
    } else {
      handled = false
    }
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // ---- Save
  async function save (): Promise<void> {
    if (design === undefined) return
    saving = true
    error = undefined
    try {
      let body: ComposeDocumentOptions
      if (source === undefined || source.kind === 'page') {
        body = { usePage: true }
      } else if (layoutBody) {
        body = { contentHtml: buildContentHtml(blocks, breaks, documentTitle) }
      } else if (source.kind === 'file') {
        body = { file: source.file, fileContentType: source.contentType }
      } else {
        body = {}
      }
      let blob = await composeWithDesign(client, object, design, { values, overrides, ...body })
      if (signed) {
        blob = await signPDF(blob, getMetadata(presentation.metadata.Token) ?? '')
      }
      dispatch('close', blob)
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      Analytics.handleError(e)
      error = e.message
    } finally {
      saving = false
    }
  }

  $: templateItems = templates.map((t) => ({ id: t._id, label: t.name }))

  function selectTemplateId (id: string): void {
    selectedId = templates.find((t) => t._id === id)?._id
  }
</script>

<svelte:window on:keydown={onKeyDown} />

<svelte:head>
  {@html styleTag(fontFacesCss(fontAssets))}
</svelte:head>

<div class="hulyComponent preview">
  <Header adaptive={'disabled'} hideBefore={false}>
    <svelte:fragment slot="beforeTitle">
      <Button icon={IconClose} kind={'icon'} on:click={() => dispatch('close', undefined)} />
    </svelte:fragment>
    <Breadcrumb
      icon={branding.icon.Template}
      label={branding.string.PrintPreview}
      title={title !== "" ? ` · ${title}` : undefined}
      size={'large'}
      isCurrent
    />
    <svelte:fragment slot="actions">
      <Button icon={IconUndo} kind={'icon'} disabled={past.length === 0} showTooltip={{ label: branding.string.Undo }} on:click={undo} />
      <Button icon={IconRedo} kind={'icon'} disabled={future.length === 0} showTooltip={{ label: branding.string.Redo }} on:click={redo} />
      <div class="zoom">
        <button type="button" use:tooltip={{ label: branding.string.ZoomOut }} on:click={() => (zoom = Math.max(0.25, Math.round((zoom - 0.1) * 100) / 100))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" use:tooltip={{ label: branding.string.ZoomIn }} on:click={() => (zoom = Math.min(2, Math.round((zoom + 0.1) * 100) / 100))}>+</button>
      </div>
      <Button
        label={branding.string.SaveAsPdf}
        icon={branding.icon.Page}
        kind={'primary'}
        loading={saving}
        disabled={design === undefined || loadingValues}
        on:click={save}
      />
    </svelte:fragment>
  </Header>

  <div class="columns">
    <!-- Left: what is printed -->
    <div class="side left">
      <Scroller>
        <div class="section">
          <div class="section-title"><Label label={branding.string.Template} /></div>
          {#if templates.length === 0}
            <div class="hint"><Label label={branding.string.NoTemplates} /></div>
          {:else}
            <DropdownLabels
              items={templateItems}
              selected={selectedId}
              kind={'regular'}
              size={'medium'}
              width={'100%'}
              justify={'left'}
              enableSearch={templateItems.length > 7}
              on:selected={(e) => selectTemplateId(e.detail)}
            />
            {#if current !== undefined}
              <div class="hint"><Label label={templateTypeLabel(getTemplateType(current))} /></div>
            {/if}
          {/if}
        </div>

        {#if sources.length > 0}
          <div class="section">
            <div class="section-title"><Label label={branding.string.DocumentBody} /></div>
            {#if sources.length > 1}
              {#each sources as s, index}
                <label class="toggle">
                  <input type="radio" name="body-source" checked={index === sourceIndex} on:change={() => (sourceIndex = index)} />
                  <span><Label label={sourceLabel(s)} /></span>
                </label>
              {/each}
            {/if}
            {#if layoutBody}
              {#if source?.kind === 'content'}
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={includeTitle}
                    on:change={(e) => {
                      record()
                      includeTitle = e.currentTarget.checked
                    }}
                  />
                  <span><Label label={branding.string.IncludeTitle} /></span>
                </label>
              {/if}
              <div class="hint"><Label label={branding.string.PageBreaksHint} /></div>
              {#if breaks.size > 0}
                <Button
                  label={branding.string.ResetPageBreaks}
                  size={'small'}
                  on:click={() => {
                    record()
                    breaks = new Set()
                  }}
                />
              {/if}
            {:else if source?.kind === 'file'}
              <div class="hint"><Label label={branding.string.FileBodyHint} /></div>
            {:else}
              <div class="hint"><Label label={branding.string.PageBreaksUnavailable} /></div>
            {/if}
          </div>
        {/if}

        {#if design !== undefined}
          <div class="section">
            <div class="section-title">
              <Label label={branding.string.Values} />
              <div class="title-actions">
                <button
                  type="button"
                  class="link"
                  on:click={() => {
                    record()
                    values = { ...resolved }
                    overrides = {}
                  }}><Label label={branding.string.ResetValues} /></button
                >
                <Button icon={IconAdd} kind={'icon'} size={'small'} showTooltip={{ label: branding.string.AddField }} on:click={addField} />
              </div>
            </div>
            {#if loadingValues}
              <Loading size={'small'} />
            {:else}
              {#each usedFields as key (key)}
                <label class="value">
                  <span class="value-label">
                    <Label label={fieldLabel(key)} />
                    {#if extraFields.includes(key)}
                      <button type="button" class="link" on:click|preventDefault={() => placeField(key)}>
                        <Label label={branding.string.PlaceOnPage} />
                      </button>
                    {/if}
                  </span>
                  <input
                    type="text"
                    value={values[key] ?? ''}
                    on:input={(e) => {
                      record(`value-${key}`)
                      values = { ...values, [key]: e.currentTarget.value }
                    }}
                  />
                </label>
              {/each}
              {#if addingCustom}
                <div class="custom">
                  <input
                    bind:this={customInput}
                    bind:value={customFieldName}
                    type="text"
                    on:keydown={(e) => {
                      if (e.key === 'Enter') addCustomField()
                      if (e.key === 'Escape') addingCustom = false
                    }}
                  />
                  <Button label={branding.string.AddField} size={'small'} kind={'primary'} on:click={addCustomField} />
                </div>
              {/if}
            {/if}
          </div>
        {/if}
        {#if error !== undefined}
          <div class="error"><Label label={branding.string.PrintFailed} />: {error}</div>
        {/if}
      </Scroller>
    </div>

    <!-- Centre: the pages as they will be printed -->
    <div class="pages">
      <Scroller horizontal>
        <div class="stage">
          {#if templates.length === 0}
            <div class="empty"><Label label={branding.string.NoTemplates} /></div>
          {:else if design === undefined || loadingValues}
            <Loading />
          {:else}
            {#each beforePages as page, pageIndex (page.id)}
              {#if editPages}
                {@const surface = getSurface(design, { kind: 'page', id: page.id })}
                {#if surface !== undefined}
                  <PageCanvas
                    {surface}
                    margins={design.page.margins}
                    {zoom}
                    selected={selectedPageId === page.id ? selected : []}
                    resolveFile={ctx.resolveFile}
                    {values}
                    keepPlaceholders={false}
                    on:select={(e) => {
                      selectedPageId = page.id
                      selected = e.detail.ids
                    }}
                    on:begin={() => {
                      selectedPageId = page.id
                      record()
                    }}
                    on:update={(e) => {
                      if (design === undefined) return
                      setSurfaceElements(design, { kind: 'page', id: page.id }, e.detail.elements)
                      design = design
                    }}
                    on:textEdit={(e) => {
                      selectedPageId = page.id
                      const { id, text } = e.detail
                      updatePageElements((elements) =>
                        elements.map((el) => (el.id === id && el.kind === 'text' ? { ...el, text } : el))
                      )
                    }}
                  />
                {/if}
              {:else}
                <PreviewPage
                  {design}
                  {page}
                  {ctx}
                  {zoom}
                  pos={positions[pageIndex]}
                  on:edit={(e) => {
                    record(`override-${e.detail.id}`)
                    overrides = { ...overrides, [e.detail.id]: e.detail.text }
                  }}
                />
              {/if}
            {/each}

            {#if loadingBody}
              <Loading />
            {:else if layoutBody}
              <BodyPages
                {design}
                {blocks}
                {breaks}
                title={documentTitle}
                {zoom}
                {ctx}
                beforeCount={beforePages.length}
                afterCount={afterPages.length}
                on:layout={(e) => (bodyPages = e.detail.pages)}
                on:toggleBreak={(e) => toggleBreak(e.detail.index)}
              />
            {:else}
              <!-- The body is rendered by the print service; a sample shows how text will be formatted -->
              <TypographyPreview
                {design}
                {zoom}
                resolveFile={ctx.resolveFile}
                {values}
                pages={source?.kind === 'file' ? [''] : SAMPLE_CONTENT_PAGES.slice(0, 1)}
                interactive={false}
                beforeCount={beforePages.length}
                afterCount={afterPages.length}
              >
                <div slot="overlay" class="content-badge" style={`top:${contentTop + 2}mm;right:${margins.right + 2}mm`}>
                  <span class="content-title"><Label label={branding.string.DocumentContent} /></span>
                  <span class="content-hint">
                    <Label label={source?.kind === 'file' ? branding.string.FileBodyHint : branding.string.DocumentContentHint} />
                  </span>
                </div>
              </TypographyPreview>
            {/if}

            {#each afterPages as page, pageIndex (page.id)}
              {#if editPages}
                {@const surface = getSurface(design, { kind: 'page', id: page.id })}
                {#if surface !== undefined}
                  <PageCanvas
                    {surface}
                    margins={design.page.margins}
                    {zoom}
                    selected={selectedPageId === page.id ? selected : []}
                    resolveFile={ctx.resolveFile}
                    {values}
                    keepPlaceholders={false}
                    on:select={(e) => {
                      selectedPageId = page.id
                      selected = e.detail.ids
                    }}
                    on:begin={() => {
                      selectedPageId = page.id
                      record()
                    }}
                    on:update={(e) => {
                      if (design === undefined) return
                      setSurfaceElements(design, { kind: 'page', id: page.id }, e.detail.elements)
                      design = design
                    }}
                    on:textEdit={(e) => {
                      selectedPageId = page.id
                      const { id, text } = e.detail
                      updatePageElements((elements) =>
                        elements.map((el) => (el.id === id && el.kind === 'text' ? { ...el, text } : el))
                      )
                    }}
                  />
                {/if}
              {:else}
                <PreviewPage
                  {design}
                  {page}
                  {ctx}
                  {zoom}
                  pos={positions[beforePages.length + contentCount + pageIndex]}
                  on:edit={(e) => {
                    record(`override-${e.detail.id}`)
                    overrides = { ...overrides, [e.detail.id]: e.detail.text }
                  }}
                />
              {/if}
            {/each}
          {/if}
        </div>
      </Scroller>
    </div>

    <!-- Right: changes for this print only -->
    <div class="side right">
      <Scroller>
        {#if design !== undefined}
          <div class="section actions">
            <Button
              label={branding.string.EditOnPage}
              icon={branding.icon.Rectangle}
              kind={editPages ? 'primary' : 'regular'}
              width={'100%'}
              justify={'left'}
              on:click={() => {
                editPages = !editPages
                selected = []
              }}
            />
            <Button
              label={branding.string.CustomizeLayout}
              icon={branding.icon.Template}
              kind={'regular'}
              width={'100%'}
              justify={'left'}
              on:click={customizeLayout}
            />
            {#if current !== undefined}
              <Button
                label={savedToTemplate ? branding.string.SavedToTemplate : branding.string.SaveToTemplate}
                kind={'ghost'}
                width={'100%'}
                justify={'left'}
                disabled={past.length === 0}
                on:click={saveToTemplate}
              />
            {/if}
          </div>

          {#if selectedElements.length > 0}
            <ArrangeBar
              count={selectedElements.length}
              {canPaste}
              on:align={(e) => {
                const ids = new Set(selected)
                const bounds = selectionBounds()
                updatePageElements((elements) => alignElements(elements, ids, e.detail, bounds))
              }}
              on:distribute={(e) => {
                const ids = new Set(selected)
                updatePageElements((elements) => distributeElements(elements, ids, e.detail))
              }}
              on:order={(e) => {
                const ids = new Set(selected)
                updatePageElements((elements) => reorderElements(elements, ids, e.detail))
              }}
              on:copy={() => {
                copyElements(selectedElements)
                canPaste = true
              }}
              on:paste={pasteIntoPage}
            />
            {#if selectedElement !== undefined}
              {#key selectedElement.id}
                <ElementProperties
                  element={selectedElement}
                  fields={valueFields}
                  {attributeFields}
                  {customFonts}
                  on:change={(e) => changeSelected(e.detail)}
                  on:remove={removeSelected}
                  on:duplicate={duplicateSelected}
                />
              {/key}
            {/if}
          {:else}
            <QuickChanges
              {design}
              on:change={(e) => {
                record(e.detail.key)
                design = e.detail.design
              }}
            />
          {/if}
        {/if}
      </Scroller>
    </div>
  </div>
</div>

<style lang="scss">
  .preview {
    width: 100%;
    height: 100%;
    background: var(--theme-comp-header-color);
  }
  .columns {
    display: flex;
    flex-grow: 1;
    min-height: 0;
    border-top: 1px solid var(--theme-divider-color);
  }
  .side {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-height: 0;
    background: var(--theme-panel-color);

    &.left {
      width: 18rem;
      border-right: 1px solid var(--theme-divider-color);
    }
    &.right {
      width: 19rem;
      border-left: 1px solid var(--theme-divider-color);
    }
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);

    &.actions {
      gap: 0.375rem;
    }
  }
  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 1.5rem;
    font-weight: 600;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--theme-dark-color);
  }
  .title-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--primary-button-default);
    font-size: 0.75rem;
    text-transform: none;
    letter-spacing: normal;
    cursor: pointer;
  }
  .hint {
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--theme-dark-color);
  }
  .value {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;

    .value-label {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--theme-dark-color);
    }
  }
  .value input,
  .custom input {
    border: 1px solid var(--theme-button-border);
    border-radius: 0.25rem;
    background: var(--theme-button-default);
    color: var(--theme-caption-color);
    padding: 0.3rem 0.4rem;
    font-size: 0.8125rem;
    outline: none;

    &:focus {
      border-color: var(--primary-button-default);
    }
  }
  .custom {
    display: flex;
    gap: 0.375rem;

    input {
      flex-grow: 1;
      min-width: 0;
    }
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--theme-caption-color);
    cursor: pointer;

    input {
      accent-color: var(--primary-button-default);
    }
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    margin: 0 0.25rem;
    font-size: 0.8125rem;
    color: var(--theme-content-color);

    span {
      min-width: 2.75rem;
      text-align: center;
    }
    button {
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
  }
  .error {
    margin: 0.75rem;
    padding: 0.5rem;
    border-radius: 0.25rem;
    color: var(--theme-error-color);
    border: 1px solid var(--theme-error-color);
    font-size: 0.8125rem;
    word-break: break-word;
  }
  .pages {
    display: flex;
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    background: var(--theme-bg-dark-color);
  }
  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    min-width: 100%;
    width: max-content;
    padding: 2rem;
  }
  .empty {
    padding: 4rem;
    color: var(--theme-dark-color);
  }
  .content-badge {
    position: absolute;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 1mm;
    max-width: 70mm;
    padding: 2.5mm 3mm;
    border-radius: 1.5mm;
    background: rgba(17, 24, 39, 0.82);
    pointer-events: none;
  }
  .content-title {
    font: 600 3.4mm sans-serif;
    color: #fff;
  }
  .content-hint {
    font: 2.6mm sans-serif;
    color: #d1d5db;
  }
</style>
