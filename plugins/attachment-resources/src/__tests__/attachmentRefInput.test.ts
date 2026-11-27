/** @jest-environment jsdom */
//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import type { Class, Doc, Ref, Space } from '@hcengineering/core'
import { tick } from 'svelte'
import type * as svelteCompiler from 'svelte/compiler'
import type * as ts from 'typescript'
import AttachmentRefInput from '../components/AttachmentRefInput.svelte'

const objectRef: Ref<Doc> = 'object' as Ref<Doc>
const spaceRef: Ref<Space> = 'space' as Ref<Space>
const classRef: Ref<Class<Doc>> = 'class' as Ref<Class<Doc>>

interface PreviewDocument {
  _id: string
  _class: string
  collection: string
  space: string
  attachedTo: string
  attachedToClass: string
  type: string
  name: string
  file: string
  metadata?: { url?: string, title?: string }
}

interface MockState {
  sequence: number
  draft: boolean
  initial: PreviewDocument[]
  callbacks: Array<(docs: PreviewDocument[]) => void>
  fetchDetails: jest.MockedFunction<(url: string) => Promise<typeof details>>
  upload: jest.MockedFunction<UploadFn>
  updateCollection: jest.MockedFunction<(...args: unknown[]) => Promise<void>>
  addCollection: jest.MockedFunction<(...args: unknown[]) => Promise<void>>
  saveDraft: jest.MockedFunction<(draft: Record<string, PreviewDocument>) => void>
  queryOptions: unknown[]
}

type UploadFn = (file?: File) => Promise<{ uuid: string, metadata?: Record<string, unknown> }>

let mockState: MockState

function mockComponent (source: string): unknown {
  const { compile } = jest.requireActual<typeof svelteCompiler>('svelte/compiler')
  const typescript = jest.requireActual<typeof ts>('typescript')
  const { js } = compile(source, { generate: 'dom', css: 'external' })
  const code = typescript.transpileModule(js.code, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 }
  }).outputText
  const output: { exports: Record<string, unknown> } = { exports: {} }
  const load = (id: string): unknown => jest.requireActual<Record<string, unknown>>(id)
  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
  new Function('require', 'module', 'exports', code)(load, output, output.exports)
  return output.exports.default
}

jest.mock('@hcengineering/attachment', () => ({}))
jest.mock('@hcengineering/core', () => ({
  generateId: () => 'attachment-' + ++mockState.sequence,
  toIdMap: (docs: PreviewDocument[]) => new Map(docs.map((doc) => [doc._id, doc])),
  SortingOrder: { Ascending: 1, Descending: -1 },
  RateLimiter: class {
    async add (fn: () => Promise<void>): Promise<void> {
      await fn()
    }
    async exec<T> (fn: () => Promise<T>): Promise<T> {
      return await fn()
    }
    async waitProcessing (): Promise<void> {}
  }
}))
jest.mock('@hcengineering/platform', () => ({
  setPlatformStatus: jest.fn(),
  unknownError: (err: Error) => ({ code: 'unknown', message: err.message })
}))
jest.mock('@hcengineering/presentation', () => ({
  getClient: () => ({
    updateCollection: async (...args: unknown[]): Promise<void> => {
      await mockState.updateCollection(...args)
    },
    addCollection: async (...args: unknown[]): Promise<void> => {
      await mockState.addCollection(...args)
    }
  }),
  getFileUrl: (file: string) => '/files/' + file,
  createQuery: () => ({
    query: (_class: unknown, _query: unknown, callback: (docs: PreviewDocument[]) => void, options?: unknown) => {
      mockState.callbacks.push(callback)
      mockState.queryOptions.push(options)
    },
    unsubscribe: () => {}
  }),
  DraftController: class {
    save (draft: Record<string, PreviewDocument>): void {
      mockState.saveDraft(draft)
    }
    remove (): void {}
  },
  draftsStore: {
    subscribe: (fn: (value: Record<string, Record<string, PreviewDocument>>) => void): (() => void) => {
      fn(mockState.draft ? { object_attachments: Object.fromEntries(mockState.initial.map((a) => [a._id, a])) } : {})
      return () => {}
    }
  },
  isLinkPreviewEnabled: () => true,
  fetchLinkPreviewDetails: async (url: string) => await mockState.fetchDetails(url),
  canDisplayLinkPreview: () => true,
  generateFileId: () => 'preview-' + ++mockState.sequence,
  uploadFile: async (file?: File) => await mockState.upload(file),
  deleteFile: jest.fn()
}))
jest.mock('@hcengineering/text', () => ({ EmptyMarkup: '', isEmptyMarkup: () => true }))
jest.mock('@hcengineering/text-editor', () => ({
  __esModule: true,
  default: { string: { Attach: 'Attach' } }
}))
jest.mock('@hcengineering/uploader', () => ({ getUploadHandlers: () => [] }))
jest.mock('../plugin', () => ({
  __esModule: true,
  default: { class: { Attachment: 'attachment' } }
}))

jest.mock('@hcengineering/text-editor-resources', () => ({
  ReferenceInput: mockComponent(`
    <script>
      import { createEventDispatcher } from 'svelte'
      const dispatch = createEventDispatcher()
    </script>
    <div>
      <button data-testid="reference-update" on:click={() => dispatch('update', '')}></button>
      <slot name="header"></slot>
    </div>
  `),
  AttachIcon: {}
}))

jest.mock('../components/AttachmentPresenter.svelte', () => ({
  __esModule: true,
  default: mockComponent(`
    <script>
      import { createEventDispatcher } from 'svelte'
      export let value
      const dispatch = createEventDispatcher()
    </script>
    <button
      data-attachment-id={value._id}
      data-attachment-name={value.name}
      data-testid="attachment-remove"
      on:click={() => dispatch('remove')}
    ></button>
  `)
}))

jest.mock('@hcengineering/ui', () => ({ Loading: mockComponent('<span></span>') }))

function deferred<T> (): { promise: Promise<T>, resolve: (value: T) => void } {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: settle }
}

const url = 'https://example.com/a'
const details = { title: 'Example', url }

interface StoredResponse {
  ok: boolean
  json: () => Promise<unknown>
}

type StoredFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<StoredResponse>

interface AttachmentListState {
  size: number
  values: () => Array<string | null>
  get: (id: string) => string | null | undefined
  clear: () => void
}

interface ComponentState {
  attachments: AttachmentListState
  removeAttachment: (doc: unknown) => Promise<void>
}

interface Composer {
  state: () => ComponentState
  update: (urls: string[]) => void
  settle: () => Promise<void>
  fetch: jest.MockedFunction<(url: string) => Promise<typeof details>>
  upload: jest.MockedFunction<UploadFn>
  fetchStored: jest.MockedFunction<StoredFetch>
  updateCollection: jest.MockedFunction<(...args: unknown[]) => Promise<void>>
  addCollection: jest.MockedFunction<(...args: unknown[]) => Promise<void>>
  queryOptions: () => unknown[]
  names: () => Array<string | null>
  selectFiles: (files: File[]) => void
  createAttachments: () => Promise<void>
  saveDraft: jest.MockedFunction<(draft: Record<string, PreviewDocument>) => void>
  switchObject: (next: Ref<Doc>) => Promise<void>
  platform: { setPlatformStatus: jest.Mock }
}

const cleanups: Array<() => void> = []
afterEach((): void => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  jest.requireMock<{ setPlatformStatus: jest.Mock }>('@hcengineering/platform').setPlatformStatus.mockClear()
})

async function composer (
  initial: PreviewDocument[] = [],
  draft = false,
  stored: StoredFetch = async () => ({ ok: true, json: async () => details })
): Promise<Composer> {
  const fetchDetails = jest.fn(async (_url: string) => details)
  const upload = jest.fn<ReturnType<UploadFn>, Parameters<UploadFn>>(async () => ({
    uuid: 'blob-' + ++mockState.sequence
  }))
  const updateCollection = jest.fn(async (..._args: unknown[]) => {})
  const addCollection = jest.fn(async (..._args: unknown[]) => {})
  const saveDraft = jest.fn((_draft: Record<string, PreviewDocument>) => {})
  mockState = {
    sequence: 0,
    draft,
    initial,
    callbacks: [],
    fetchDetails,
    upload,
    updateCollection,
    addCollection,
    saveDraft,
    queryOptions: []
  }
  const fetchStored = jest.fn(stored)
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchStored })
  const target = document.createElement('div')
  document.body.appendChild(target)
  const component = new AttachmentRefInput({
    target,
    props: { objectId: objectRef, space: spaceRef, _class: classRef, shouldSaveDraft: draft, attachments: new Map() }
  })
  cleanups.push(() => {
    component.$destroy()
    if (originalFetch === undefined) Reflect.deleteProperty(globalThis, 'fetch')
    else Object.defineProperty(globalThis, 'fetch', originalFetch)
    target.remove()
  })
  if (!draft && mockState.callbacks.length > 0) mockState.callbacks[mockState.callbacks.length - 1](initial)
  const container = target.querySelector('.no-print')
  if (container === null) throw new Error('Attachment container was not rendered')
  const state = (): ComponentState => {
    const ids = Array.from(container.querySelectorAll('[data-attachment-id]')).map((element) =>
      element.getAttribute('data-attachment-id')
    )
    return {
      attachments: {
        size: ids.length,
        values: () => ids,
        get: (id: string) => (ids.includes(id) ? id : undefined),
        clear: () => {
          component.$set({ attachments: new Map() })
        }
      },
      removeAttachment: async (_doc: unknown) => {
        const button = container.querySelector('[data-testid="attachment-remove"]')
        if (!(button instanceof HTMLButtonElement)) throw new Error('Attachment presenter was not rendered')
        button.click()
      }
    }
  }
  const update = (urls: string[]): void => {
    const anchors = urls.map((href) => {
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      return anchor
    })
    for (const anchor of Array.from(container.getElementsByTagName('a'))) anchor.remove()
    container.append(...anchors)
    const button = container.querySelector('[data-testid="reference-update"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Reference input was not rendered')
    button.click()
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  const switchObject = async (next: Ref<Doc>): Promise<void> => {
    component.$set({ objectId: next })
    await tick()
  }
  const names = (): Array<string | null> =>
    Array.from(container.querySelectorAll('[data-attachment-name]')).map((element) =>
      element.getAttribute('data-attachment-name')
    )
  const selectFiles = (files: File[]): void => {
    const input = target.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('File input was not rendered')
    const list = { length: files.length, item: (index: number) => files[index] ?? null }
    Object.defineProperty(input, 'files', { configurable: true, value: list })
    input.dispatchEvent(new Event('change'))
  }
  const platform = jest.requireMock<{ setPlatformStatus: jest.Mock }>('@hcengineering/platform')
  return {
    state,
    update,
    settle,
    fetch: fetchDetails,
    upload,
    fetchStored,
    updateCollection,
    addCollection,
    queryOptions: () => mockState.queryOptions,
    names,
    selectFiles,
    createAttachments: async () => {
      await (component as unknown as { createAttachments: () => Promise<void> }).createAttachments()
    },
    saveDraft,
    switchObject,
    platform
  }
}

function preview (source = url): PreviewDocument {
  return {
    _id: 'saved',
    _class: 'attachment',
    collection: 'attachments',
    space: 'space',
    attachedTo: 'object',
    attachedToClass: 'class',
    type: 'application/link-preview',
    name: 'opaque-file-id',
    file: 'saved-blob',
    metadata: { url: source }
  }
}

describe('AttachmentRefInput URL preview lifecycle', () => {
  it('removes a preview with its URL and allows it to be added again', async () => {
    const c = await composer()
    c.update([url])
    await c.settle()
    expect(c.state().attachments.size).toBe(1)
    c.update([])
    await c.settle()
    expect(c.state().attachments.size).toBe(0)
    c.update([url])
    await c.settle()
    expect(c.fetch).toHaveBeenCalledTimes(2)
    expect(c.state().attachments.size).toBe(1)
  })

  it('releases a slot at the three-preview limit', async () => {
    const c = await composer()
    c.update([url, url + '2', url + '3'])
    await c.settle()
    expect(c.state().attachments.size).toBe(3)
    c.update([url + '2', url + '3', url + '4'])
    await c.settle()
    expect(c.fetch).toHaveBeenCalledWith(url + '4')
    expect(c.state().attachments.size).toBe(3)
  })

  it('keeps X dismissed while the URL stays, then permits removal/re-add', async () => {
    const c = await composer()
    c.update([url])
    await c.settle()
    await c.state().removeAttachment(Array.from(c.state().attachments.values())[0])
    c.update([url])
    await c.settle()
    expect(c.state().attachments.size).toBe(0)
    expect(c.fetch).toHaveBeenCalledTimes(1)
    c.update([])
    c.update([url])
    await c.settle()
    expect(c.fetch).toHaveBeenCalledTimes(2)
    expect(c.state().attachments.size).toBe(1)
  })

  it('discards metadata completing after URL removal', async () => {
    const c = await composer()
    const pending = deferred<typeof details>()
    c.fetch.mockImplementationOnce(async () => await pending.promise)
    c.update([url])
    c.update([])
    pending.resolve(details)
    await c.settle()
    expect(c.state().attachments.size).toBe(0)
    expect(c.upload).not.toHaveBeenCalled()
  })

  it('discards an upload completing after URL removal', async () => {
    const c = await composer()
    const pending = deferred<{ uuid: string }>()
    c.upload.mockImplementationOnce(async () => await pending.promise)
    c.update([url])
    await c.settle()
    c.update([])
    pending.resolve({ uuid: 'late' })
    await c.settle()
    expect(c.state().attachments.size).toBe(0)
  })

  it('does not attach an obsolete request to a removed and re-added URL', async () => {
    const c = await composer()
    const old = deferred<typeof details>()
    const current = deferred<typeof details>()
    c.fetch
      .mockImplementationOnce(async () => await old.promise)
      .mockImplementationOnce(async () => await current.promise)
    c.update([url])
    c.update([])
    c.update([url])
    old.resolve(details)
    await c.settle()
    expect(c.state().attachments.size).toBe(0)
    current.resolve(details)
    await c.settle()
    expect(c.state().attachments.size).toBe(1)
  })

  it.each([false, true])('restores tracking from %s (false=edited message, true=draft)', async (draft) => {
    const c = await composer([preview()], draft)
    c.update([url])
    await c.settle()
    expect(c.fetch).not.toHaveBeenCalled()
    c.update([])
    await c.settle()
    expect(c.state().attachments.size).toBe(0)
  })
})

describe('legacy preview source restoration', () => {
  function legacy (): PreviewDocument {
    return { ...preview(), metadata: { title: 'Legacy' } }
  }

  it('persists the restored source URL on a saved legacy preview', async () => {
    const c = await composer([legacy()])
    await c.settle()
    expect(c.updateCollection).toHaveBeenCalledTimes(1)
    expect(c.updateCollection).toHaveBeenCalledWith('attachment', 'space', 'saved', 'object', 'class', 'attachments', {
      metadata: { title: 'Legacy', url }
    })
    expect(c.saveDraft).not.toHaveBeenCalled()
  })

  it('saves the restored source URL in a draft without updating a saved document', async () => {
    const doc = legacy()
    const c = await composer([doc], true)
    await c.settle()
    expect(doc.metadata).toEqual({ title: 'Legacy', url })
    expect(c.saveDraft).toHaveBeenCalledWith({
      saved: expect.objectContaining({ metadata: { title: 'Legacy', url } })
    })
    expect(c.updateCollection).not.toHaveBeenCalled()
  })

  it.each([false, true])('reads original JSON and avoids duplicate previews (draft=%s)', async (draft) => {
    const pending = deferred<StoredResponse>()
    const c = await composer([legacy()], draft, async () => await pending.promise)
    c.update([url])
    await c.settle()
    expect(c.fetch).not.toHaveBeenCalled()
    pending.resolve({ ok: true, json: async () => details })
    await c.settle()
    expect(c.fetchStored).toHaveBeenCalledWith('/files/saved-blob', expect.any(Object))
    expect(c.state().attachments.size).toBe(1)
    expect(c.fetch).not.toHaveBeenCalled()
    c.update([])
    await c.settle()
    expect(c.state().attachments.size).toBe(0)
    c.update([url])
    await c.settle()
    expect(c.fetch).toHaveBeenCalledTimes(1)
    expect(c.state().attachments.size).toBe(1)
  })

  it.each([false, true])('reconciles text changed while original JSON loads (draft=%s)', async (draft) => {
    const pending = deferred<StoredResponse>()
    const c = await composer([legacy()], draft, async () => await pending.promise)
    c.update([url])
    c.update([])
    pending.resolve({ ok: true, json: async () => details })
    await c.settle()
    expect(c.state().attachments.size).toBe(0)
    expect(c.fetch).not.toHaveBeenCalled()
  })

  it('does not resurrect a dismissed legacy preview after JSON completion', async () => {
    const pending = deferred<StoredResponse>()
    const c = await composer([legacy()], true, async () => await pending.promise)
    c.update([url])
    await c.state().removeAttachment(c.state().attachments.get('saved'))
    pending.resolve({ ok: true, json: async () => details })
    await c.settle()
    expect(c.state().attachments.size).toBe(0)
    expect(c.fetch).not.toHaveBeenCalled()
  })

  it('ignores original JSON from an earlier object even after switching back', async () => {
    const pending = deferred<StoredResponse>()
    const c = await composer([legacy()], false, async () => await pending.promise)
    c.update([url])
    await c.switchObject('other' as Ref<Doc>)
    await c.switchObject(objectRef)
    c.state().attachments.clear()
    c.update([])
    pending.resolve({ ok: true, json: async () => details })
    await c.settle()
    expect(c.state().attachments.size).toBe(0)
  })

  it('logs a legacy restoration failure without a platform status', async () => {
    const error = new Error('missing legacy blob')
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const c = await composer([legacy()], false, async () => {
        throw error
      })
      await c.settle()
      expect(c.platform.setPlatformStatus).not.toHaveBeenCalled()
      expect(errorLog).toHaveBeenCalledWith('Failed to restore legacy link preview', error)
    } finally {
      errorLog.mockRestore()
    }
  })
})

describe('AttachmentRefInput file order', () => {
  function file (name: string): File {
    return new File([name], name, { type: 'text/plain' })
  }

  function rejected<T> (): { promise: Promise<T>, reject: (err: Error) => void } {
    let fail: (err: Error) => void = () => {}
    const promise = new Promise<T>((_resolve, reject) => {
      fail = reject
    })
    return { promise, reject: fail }
  }

  it('requests saved attachments sorted by createdOn, then _id', async () => {
    const c = await composer()
    expect(c.queryOptions()).toContainEqual({ sort: { createdOn: 1, _id: 1 } })
  })

  it('keeps selection order when the last upload finishes first and the middle one fails', async () => {
    const c = await composer()
    const first = deferred<{ uuid: string }>()
    const middle = rejected<{ uuid: string }>()
    c.upload.mockImplementation(async (selected?: File) => {
      if (selected?.name === 'first.txt') return await first.promise
      if (selected?.name === 'middle.txt') return await middle.promise
      return { uuid: 'blob-third' }
    })

    c.selectFiles([file('first.txt'), file('middle.txt'), file('third.txt')])
    await c.settle()
    // The third upload is done, but it must wait for the first one.
    expect(c.upload).toHaveBeenCalledTimes(3)
    expect(c.names()).toEqual([])

    middle.reject(new Error('upload failed'))
    await c.settle()
    expect(c.names()).toEqual([])

    first.resolve({ uuid: 'blob-first' })
    await c.settle()
    await tick()
    expect(c.names()).toEqual(['first.txt', 'third.txt'])
    expect(c.platform.setPlatformStatus).toHaveBeenCalledTimes(1)
  })

  it('saves new attachments one at a time in selection order', async () => {
    const c = await composer()
    c.upload.mockImplementation(async (selected?: File) => ({ uuid: 'blob-' + (selected?.name ?? '') }))
    c.selectFiles([file('first.txt'), file('second.txt'), file('third.txt')])
    await c.settle()
    await tick()
    expect(c.names()).toEqual(['first.txt', 'second.txt', 'third.txt'])

    const firstSave = deferred<undefined>()
    c.addCollection.mockImplementationOnce(async () => {
      await firstSave.promise
    })
    const saving = c.createAttachments()
    await c.settle()
    // The server assigns createdOn on arrival, so the next save must wait.
    expect(c.addCollection).toHaveBeenCalledTimes(1)

    firstSave.resolve(undefined)
    await saving
    const savedNames = c.addCollection.mock.calls.map((call) => (call[5] as { name: string }).name)
    expect(savedNames).toEqual(['first.txt', 'second.txt', 'third.txt'])
  })

  it('keeps going after a failed save', async () => {
    const c = await composer()
    c.upload.mockImplementation(async (selected?: File) => ({ uuid: 'blob-' + (selected?.name ?? '') }))
    c.selectFiles([file('first.txt'), file('second.txt'), file('third.txt')])
    await c.settle()
    c.addCollection.mockImplementation(async (...args: unknown[]) => {
      if ((args[5] as { name: string }).name === 'second.txt') throw new Error('save failed')
    })
    await c.createAttachments()
    const savedNames = c.addCollection.mock.calls.map((call) => (call[5] as { name: string }).name)
    expect(savedNames).toEqual(['first.txt', 'second.txt', 'third.txt'])
    expect(c.platform.setPlatformStatus).toHaveBeenCalledTimes(1)
  })
})
