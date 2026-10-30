/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { compile } from 'svelte/compiler'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { concatLink } from '@hcengineering/core'
import '@testing-library/jest-dom'

interface TranslationCatalog {
  string: Record<string, string>
}

const english = JSON.parse(readFileSync(resolve(__dirname, '../../lang/en.json'), 'utf8')) as TranslationCatalog

interface MountedComponent {
  $destroy: () => void
  $on: (event: string, callback: (event: CustomEvent) => void) => void
  $set: (props: Record<string, unknown>) => void
}

type ComponentConstructor = new (options: { target: HTMLElement, props?: Record<string, unknown> }) => MountedComponent

interface PreviewFixture {
  popup: MountedComponent
  actionHandler: Pick<MountedComponent, '$destroy'>
  modes: unknown[]
  actions: string[]
  pendingActions: PendingAction[]
  tick: () => Promise<void>
  fileUrls: jest.Mock<string, [string, string, string?]>
  finishPreviewType: () => Promise<void>
}

interface PreviewStorage {
  getFileUrl: (workspace: string, file: string, filename?: string) => string
}

type StorageConstructor = new (baseUrl: string) => PreviewStorage

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

interface PendingAction {
  id: string
  resolveResource: () => void
  completed: Promise<void>
}

interface KeyAction {
  action: string
  keyBinding: string[]
}

interface ContextStoreValue {
  getLastContext: () => { mode: unknown } | undefined
}

interface DrawingProps {
  drawingAvailable: boolean
  createDrawing: (data: unknown) => Promise<unknown>
  drawings?: unknown[]
  loadDrawings?: () => Promise<unknown[]>
}

interface PreviewOptions {
  omitTitle?: boolean
  drawingProps?: DrawingProps
  name?: string
  showIcon?: boolean
  fullSize?: boolean
  file?: string
  storage?: 'front' | 'datalake'
}

function createDeferred<T> (): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  if (resolvePromise === undefined) throw new Error('Missing deferred resolver')
  return { promise, resolve: resolvePromise }
}

// Resolve sources of presentation's own dependencies through its node_modules links.
function dependencySource (name: string, path: string): string {
  return resolve(__dirname, '../../node_modules/@hcengineering', name, path)
}

// Load the browser runtime together with compiled components, without replacing
// their lifecycle or event forwarding.
// This is a synthetic focus/action-dispatch fixture: actions and selection are
// invented, most cases supply no file, and the drawing object tests only the callback
// wrapper. Modal, ButtonIcon, ButtonBase and Label are real in the normal fixture.
// Keyboard actions go through a stand-in for view-resources' ActionHandler (see below).
// General Button, DownloadFileButton, FileTypeIcon, Header, Scroller, content and
// extensions are slot replacements; registerFocus is stubbed. The missing-title
// case also replaces Modal to omit its title slot.
// Storage cases additionally load real FilePreview, DownloadFileButton, FileTypeIcon,
// presentation getFileUrl, FrontStorage/DatalakeStorage and path encoding. Metadata,
// preview-type lookup, resize observation and upload helpers are stubs. A synthetic
// file ID exercises URL forwarding/download attributes, without fetching a blob.
// FilePreview's SCSS is removed before compilation; no fixture attaches CSS.
// It does not cover image rendering/switching, actual selection/navigation, the
// popup host (showPopup/PopupInstance, emulated by destroying the popup on close),
// the ProseMirror editor itself, CSS, native Enter/Space button activation,
// persistence or assistive-technology announcements. Translation uses the English catalog.
function createPreview (options: PreviewOptions = {}): PreviewFixture {
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  const svelteRoot = dirname(require.resolve('svelte/package.json'))
  const components = resolve(__dirname, '../components')
  const ui = dependencySource('ui', 'src/components')
  const storageClients = dependencySource('storage-client', 'src/client')
  const modes: unknown[] = []
  const actions: string[] = []
  const pendingActions: PendingAction[] = []
  const previewType = createDeferred<undefined>()
  let storage: PreviewStorage | undefined
  const fileUrls = jest.fn<string, [string, string, string?]>((workspace, file, filename) => {
    if (storage === undefined) throw new Error('Missing fixture storage')
    return storage.getFileUrl(workspace, file, filename)
  })
  const compilerOptions = { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 }
  const mockedImports = [
    '../index',
    '../plugin',
    '..',
    '../focus',
    '../tooltips',
    '../filetypes',
    '../preview',
    '../image',
    '../upload',
    './plugin',
    './filetypes',
    'uuid'
  ]

  function load (filename: string): Record<string, unknown> {
    const cached = cache.get(filename)
    if (cached !== undefined) return cached.exports
    const module = { exports: {} }
    cache.set(filename, module)
    let source = readFileSync(filename, 'utf8')
    if (filename.endsWith('.svelte')) {
      if (filename === resolve(components, 'FilePreview.svelte')) {
        source = source.replace(/<style[\s\S]*?<\/style>/, '')
      }
      source = source.replace(/<script lang="ts">([\s\S]*?)<\/script>/, (_, script: string) => {
        const result = transpileModule(script, {
          compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022, verbatimModuleSyntax: true }
        })
        return `<script>${result.outputText}</script>`
      })
      source = compile(source, { filename, generate: 'dom', css: 'external' }).js.code
    }
    const code = transpileModule(source, { compilerOptions }).outputText
    const localRequire = (id: string): unknown => {
      if (id === 'svelte' || id === 'svelte/internal' || id === 'svelte/store' || id === 'svelte/transition') {
        return load(resolve(svelteRoot, 'src/runtime', id === 'svelte' ? 'index.js' : `${id.slice(7)}/index.js`))
      }
      if (id.endsWith('/disclose-version')) return {}
      if (id === '../context') return load(resolve(components, '../context.ts'))
      if (id === '../file') return load(resolve(components, '../file.ts'))
      if (id === './utils' && filename.startsWith(storageClients)) return load(resolve(storageClients, 'utils.ts'))
      if (id.startsWith('@hcengineering/') || mockedImports.includes(id)) return mocks
      if (id.endsWith('.svelte')) {
        if (['Modal', 'ButtonIcon', 'ButtonBase', 'Label'].some((name) => id === `./${name}.svelte`)) {
          return load(resolve(ui, id))
        }
        if (id === './ActionContext.svelte') return load(resolve(components, id))
        if (
          options.storage !== undefined &&
          ['FilePreview', 'DownloadFileButton', 'FileTypeIcon'].some((name) => id === `./${name}.svelte`)
        ) {
          return load(resolve(components, id))
        }
        return { default: slot }
      }
      return load(resolve(dirname(filename), id))
    }
    // Execute locally compiled modules in the same browser realm as the mounted components.
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports)
    return module.exports
  }

  function createSlot (markup: string): ComponentConstructor {
    const slotCode = compile(markup, { generate: 'dom' }).js.code
    const slotModule: { exports: { default?: ComponentConstructor } } = { exports: {} }
    const slotRequire = (id: string): unknown => {
      return id.endsWith('/disclose-version') ? {} : load(resolve(svelteRoot, 'src/runtime/internal/index.js'))
    }
    // Execute the compiled slot with the same runtime as the components above.
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    new Function('require', 'module', 'exports', transpileModule(slotCode, { compilerOptions }).outputText)(
      slotRequire,
      slotModule,
      slotModule.exports
    )
    if (slotModule.exports.default === undefined) throw new Error('Missing compiled slot component')
    return slotModule.exports.default
  }

  const slot = createSlot('<slot name="beforeTitle"/><slot name="title"/><slot name="actions"/><slot/>')
  const modalWithoutTitle = createSlot('<slot name="beforeTitle"/><slot name="actions"/><slot/>')
  const { writable, get } = load(resolve(svelteRoot, 'src/runtime/store/index.js')) as {
    writable: (value: unknown) => unknown
    get: (store: unknown) => unknown
  }
  const { tick } = load(resolve(svelteRoot, 'src/runtime/index.js')) as { tick: () => Promise<void> }
  const mocks = {
    default: {
      string: { DocumentPreview: 'DocumentPreview' },
      extension: {},
      metadata: { WorkspaceUuid: 'workspace', FileStorage: 'storage' }
    },
    Analytics: { handleError: jest.fn() },
    SortingOrder: { Descending: -1 },
    generateId: () => 'preview',
    concatLink,
    getMetadata: (key: string): unknown => {
      if (key === 'workspace') return 'w'
      if (key === 'storage') return { getFileUrl: fileUrls }
      throw new Error(`Unexpected metadata key: ${key}`)
    },
    getPreviewType: () => previewType.promise,
    resizeObserver: () => ({}),
    getEmbeddedLabel: (value: string) => value,
    translateCB: (label: string, _params: unknown, _language: string, callback: (value: string) => void) => {
      callback(english.string[label])
    },
    tooltip: () => ({}),
    registerFocus: () => ({ idx: -1 }),
    themeStore: writable({ language: 'en' }),
    deviceOptionsStore: writable({ docHeight: 1000, fontSize: 16 }),
    previewTypes: writable([]),
    ComponentExtensions: slot,
    Component: slot,
    Loading: slot,
    Button: slot,
    get Label () {
      return load(resolve(ui, 'Label.svelte')).default
    },
    get Modal () {
      return options.omitTitle === true ? modalWithoutTitle : load(resolve(ui, 'Modal.svelte')).default
    },
    get ButtonIcon () {
      return load(resolve(ui, 'ButtonIcon.svelte')).default
    }
  }
  if (options.storage !== undefined) {
    const storageName = options.storage === 'front' ? 'FrontStorage' : 'DatalakeStorage'
    const Storage = load(resolve(storageClients, `${options.storage}.ts`))[storageName] as StorageConstructor
    storage = new Storage('https://files.example')
  }
  function getContextActions (mode: unknown): KeyAction[] {
    modes.push(mode)
    return mode === 'browser'
      ? ['ArrowLeft', 'ArrowRight', 'Enter', ' '].map((key) => ({ action: key, keyBinding: [key] }))
      : []
  }

  async function getActionResource (action: string): Promise<() => void> {
    const resource = createDeferred<() => void>()
    const completed = createDeferred<undefined>()
    pendingActions.push({
      id: action,
      resolveResource: () => {
        resource.resolve(() => {
          actions.push(action)
          completed.resolve(undefined)
        })
      },
      completed: completed.promise
    })
    return await resource.promise
  }

  // Stand-in for view-resources' ActionHandler, which presentation cannot depend on. It applies the same
  // rule: a focused input, button or textarea selects input-mode actions, any other target uses the mode
  // of the last ActionContext. Actions are cached per target and their resources resolve asynchronously.
  function createActionHandler (): Pick<MountedComponent, '$destroy'> {
    const { contextStore } = load(resolve(components, '../context.ts')) as { contextStore: unknown }
    let currentElement: EventTarget | null = null
    let currentActions: KeyAction[] = []
    function handleKeys (evt: KeyboardEvent): void {
      const context = (get(contextStore) as ContextStoreValue).getLastContext()
      if (context?.mode === 'none') return
      if (currentElement !== evt.target) {
        currentElement = evt.target
        const tag = evt.target instanceof HTMLElement ? evt.target.tagName.toLowerCase() : ''
        currentActions = getContextActions(['input', 'button', 'textarea'].includes(tag) ? 'input' : context?.mode)
      }
      const action = currentActions.find((it) => it.keyBinding.includes(evt.key))
      if (action === undefined) return
      evt.preventDefault()
      void getActionResource(action.action).then((run) => {
        run()
      })
    }
    window.addEventListener('keydown', handleKeys)
    return {
      $destroy: () => {
        window.removeEventListener('keydown', handleKeys)
      }
    }
  }

  const Preview = load(resolve(components, 'FilePreviewPopup.svelte')).default as ComponentConstructor
  const actionHandler = createActionHandler()
  const popup = new Preview({
    target: document.body,
    props: {
      name: Object.prototype.hasOwnProperty.call(options, 'name') ? options.name : 'image.png',
      showIcon: options.showIcon ?? true,
      fullSize: options.fullSize ?? false,
      contentType: 'image/png',
      metadata: undefined,
      file: options.file,
      props: options.drawingProps
    }
  })
  return {
    popup,
    actionHandler,
    modes,
    actions,
    pendingActions,
    tick,
    fileUrls,
    finishPreviewType: async (): Promise<void> => {
      previewType.resolve(undefined)
      await previewType.promise
      await tick()
    }
  }
}

describe('file preview keyboard focus', () => {
  let preview: ReturnType<typeof createPreview>

  afterEach(() => {
    preview?.popup.$destroy()
    preview?.actionHandler.$destroy()
    document.body.innerHTML = ''
    jest.restoreAllMocks()
  })

  function press (key: string): void {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }))
  }

  async function pressAction (key: string): Promise<void> {
    const previousActions = [...preview.actions]
    press(key)
    expect(preview.pendingActions).toHaveLength(1)
    const request = preview.pendingActions.shift()
    if (request === undefined) throw new Error('Missing action resource request')
    expect(request.id).toBe(key)
    expect(preview.actions).toEqual(previousActions)
    request.resolveResource()
    await request.completed
  }

  it('focuses the existing title on open and dispatches both arrow actions', async () => {
    const focus = jest.spyOn(HTMLElement.prototype, 'focus')
    preview = createPreview()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(document.activeElement?.classList.contains('antiTitle')).toBe(true)
    expect(document.querySelector('.hulyModal-container')?.parentElement).toBe(document.body)
    await pressAction('ArrowRight')
    await pressAction('ArrowLeft')
    expect(preview.modes).toEqual(['browser'])
    expect(preview.actions).toEqual(['ArrowRight', 'ArrowLeft'])
  })

  it('restores browser navigation after maximizing and minimizing', async () => {
    preview = createPreview()
    const sizes: boolean[] = []
    preview.popup.$on('fullsize', (event) => sizes.push(event.detail))
    const toggle = document.querySelectorAll('button')[1]
    const focus = jest.spyOn(HTMLElement.prototype, 'focus')
    for (let i = 0; i < 2; i++) {
      toggle.focus()
      focus.mockClear()
      toggle.click()
      expect(focus).toHaveBeenCalledWith({ preventScroll: true })
      await pressAction('ArrowRight')
      await pressAction('ArrowLeft')
      expect(document.activeElement?.classList.contains('antiTitle')).toBe(true)
    }
    expect(sizes).toEqual([true, false])
    expect(preview.actions).toEqual(['ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft'])
  })

  it('preserves input mode for focused buttons, including after arrow navigation', async () => {
    preview = createPreview()
    await pressAction('ArrowRight')
    const close = document.querySelector('button')
    close?.focus()
    for (const key of ['Enter', ' ', 'ArrowRight', 'ArrowLeft']) {
      press(key)
      expect(preview.modes).toEqual(['browser', 'input'])
      expect(preview.pendingActions).toHaveLength(0)
    }
    expect(preview.modes).toEqual(['browser', 'input'])
    expect(preview.actions).toEqual(['ArrowRight'])
    expect(document.activeElement).toBe(close)
  })

  it('initializes drawing support and handles both size changes without a title slot', async () => {
    const drawing = { _id: 'drawing' }
    const createDrawing = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue(drawing)
    const drawingProps: DrawingProps = { drawingAvailable: true, createDrawing }
    preview = createPreview({ omitTitle: true, drawingProps })
    expect(document.querySelector('.antiTitle')).toBeNull()
    expect(drawingProps.createDrawing).not.toBe(createDrawing)

    const data = { content: 'drawing data' }
    await expect(drawingProps.createDrawing(data)).resolves.toBe(drawing)
    expect(createDrawing).toHaveBeenCalledWith(data)
    expect(drawingProps.drawings).toEqual([drawing])

    const sizes: boolean[] = []
    preview.popup.$on('fullsize', (event) => sizes.push(event.detail))
    const toggle = document.querySelectorAll('button')[1]
    toggle.focus()
    toggle.click()
    toggle.click()
    expect(sizes).toEqual([true, false])
    expect(document.activeElement).toBe(toggle)
  })

  it('keeps the current attachment drawings when an older load finishes later', async () => {
    const first = createDeferred<unknown[]>()
    const second = createDeferred<unknown[]>()
    const loadDrawings = jest
      .fn<Promise<unknown[]>, []>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const drawingProps: DrawingProps = {
      drawingAvailable: true,
      createDrawing: async () => undefined,
      loadDrawings
    }
    preview = createPreview({ file: 'first', drawingProps })
    expect(loadDrawings).toHaveBeenCalledTimes(1)

    preview.popup.$set({ file: 'second' })
    await preview.tick()
    expect(loadDrawings).toHaveBeenCalledTimes(2)
    const current = [{ _id: 'current-drawing' }]
    second.resolve(current)
    await second.promise
    await preview.tick()
    expect(drawingProps.drawings).toBe(current)

    first.resolve([{ _id: 'old-drawing' }])
    await first.promise
    await preview.tick()
    expect(drawingProps.drawings).toBe(current)
  })

  it('ignores drawing loads that finish after the popup is destroyed', async () => {
    const drawings = createDeferred<unknown[]>()
    const drawingProps: DrawingProps = {
      drawingAvailable: true,
      createDrawing: async () => undefined,
      loadDrawings: () => drawings.promise
    }
    preview = createPreview({ file: 'f', drawingProps })
    preview.popup.$destroy()

    drawings.resolve([{ _id: 'old-drawing' }])
    await drawings.promise
    await preview.tick()
    expect(drawingProps.drawings).toBeUndefined()
  })

  it.each(['Escape', 'the close button'])(
    'returns focus to the text editor whose image opened the preview after closing with %s',
    async (closeWith) => {
      // Shaped like the text editor: a contenteditable host whose image opens the preview on double-click
      // with the editor's popup props. The popup host is emulated by destroying the popup on close.
      const editor = document.body.appendChild(document.createElement('div'))
      editor.setAttribute('contenteditable', 'true')
      const image = editor.appendChild(document.createElement('img'))
      image.addEventListener('dblclick', () => {
        preview = createPreview({ name: '', showIcon: false, fullSize: true })
        preview.popup.$on('close', () => {
          preview.popup.$destroy()
        })
      })
      editor.focus()
      image.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      expect(document.activeElement?.classList.contains('antiTitle')).toBe(true)
      await pressAction('ArrowRight')
      await pressAction('ArrowLeft')

      const restore = jest.spyOn(editor, 'focus')
      if (closeWith === 'Escape') {
        press('Escape')
      } else {
        const close = document.querySelector('.hulyModal-container button')
        if (!(close instanceof HTMLButtonElement)) throw new Error('Missing close button')
        close.focus()
        close.click()
      }
      expect(restore).toHaveBeenCalledWith({ preventScroll: true })
      expect(document.activeElement).toBe(editor)
      expect(document.querySelector('.antiTitle')).toBeNull()

      const typed: string[] = []
      editor.addEventListener('keydown', (event) => typed.push(event.key))
      press('a')
      expect(typed).toEqual(['a'])
      expect(preview.pendingActions).toHaveLength(0)
      expect(preview.actions).toEqual(['ArrowRight', 'ArrowLeft'])
    }
  )

  it('does not restore focus to a removed element or away from a newer focus target', () => {
    const removed = document.body.appendChild(document.createElement('textarea'))
    removed.focus()
    preview = createPreview()
    removed.remove()
    const restoreRemoved = jest.spyOn(removed, 'focus')
    preview.popup.$destroy()
    expect(restoreRemoved).not.toHaveBeenCalled()

    const editor = document.body.appendChild(document.createElement('textarea'))
    editor.focus()
    const second = createPreview()
    const other = document.body.appendChild(document.createElement('input'))
    other.focus()
    const restoreEditor = jest.spyOn(editor, 'focus')
    second.popup.$destroy()
    second.actionHandler.$destroy()
    expect(restoreEditor).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(other)
  })

  it('focuses a named heading outside the tab order', () => {
    preview = createPreview()
    const title = document.querySelector('[role="heading"]')
    expect(document.activeElement).toBe(title)
    expect(title?.getAttribute('aria-level')).toBe('1')
    expect(title).toHaveAccessibleName('image.png')
    expect(title?.textContent).toContain('image.png')
    expect(title?.getAttribute('tabindex')).toBe('-1')
  })

  it.each([
    { name: '', showIcon: false },
    { name: '   ', showIcon: false },
    { name: undefined, showIcon: true }
  ])('names an unnamed preview with filename $name and showIcon $showIcon', async ({ name, showIcon }) => {
    preview = createPreview({ name, showIcon })
    const title = document.querySelector('[role="heading"]')
    expect(document.activeElement).toBe(title)
    expect(title?.getAttribute('aria-level')).toBe('1')
    expect(title?.getAttribute('tabindex')).toBe('-1')
    expect(title?.querySelector('.wrapped-icon') !== null).toBe(showIcon)
    expect(title).toHaveAccessibleName(english.string.DocumentPreview)
    expect(title?.textContent).toContain(english.string.DocumentPreview)

    preview.popup.$set({ name: 'updated.png' })
    await preview.tick()
    expect(title).toHaveAccessibleName('updated.png')
    expect(title?.textContent).toContain('updated.png')
    expect(document.activeElement).toBe(title)

    preview.popup.$set({ name })
    await preview.tick()
    expect(title).toHaveAccessibleName(english.string.DocumentPreview)
    expect(title?.textContent).toContain(english.string.DocumentPreview)
    expect(document.activeElement).toBe(title)
  })

  it.each([
    {
      storage: 'front' as const,
      absentUrl: 'https://files.example/w/f?file=f&workspace=w',
      namedUrl: 'https://files.example/w/updated.png?file=f&workspace=w',
      emptyUrl: 'https://files.example/w/?file=f&workspace=w'
    },
    {
      storage: 'datalake' as const,
      absentUrl: 'https://files.example/blob/w/f',
      namedUrl: 'https://files.example/blob/w/f/updated.png',
      emptyUrl: 'https://files.example/blob/w/f/'
    }
  ])(
    'preserves absent and empty filenames through $storage storage',
    async ({ storage, absentUrl, namedUrl, emptyUrl }) => {
      preview = createPreview({ file: 'f', name: undefined, storage })
      await preview.finishPreviewType()
      const title = document.querySelector('[role="heading"]')

      function expectFilename (name: string | undefined, url: string): void {
        expect(preview.fileUrls.mock.calls).toEqual([
          ['w', 'f', name],
          ['w', 'f', name]
        ])
        expect(preview.fileUrls.mock.results.map((result) => result.value)).toEqual([url, url])
        const links = document.querySelectorAll('a.no-line')
        expect(links).toHaveLength(2)
        links.forEach((link) => {
          expect(link.getAttribute('href')).toBe(url)
          expect(link.getAttribute('download')).toBe(name ?? null)
        })
        expect(title).toHaveAccessibleName(name === undefined || name === '' ? english.string.DocumentPreview : name)
        expect(document.activeElement).toBe(title)
      }

      expectFilename(undefined, absentUrl)
      for (const { name, url } of [
        { name: 'updated.png', url: namedUrl },
        { name: undefined, url: absentUrl },
        { name: '', url: emptyUrl }
      ]) {
        preview.fileUrls.mockClear()
        preview.popup.$set({ name })
        await preview.tick()
        expectFilename(name, url)
      }
    }
  )
})
