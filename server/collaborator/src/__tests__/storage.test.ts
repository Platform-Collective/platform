// SPDX-License-Identifier: EPL-2.0

import { Connection, Debugger, Document, Hocuspocus, OutgoingMessage } from '@hocuspocus/server'
import { EventEmitter } from 'events'
import { IncomingMessage } from 'http'
import { Socket } from 'net'
import type { Transformer } from '@hocuspocus/transformer'
import { Doc, applyUpdate, encodeStateAsUpdate } from 'yjs'
import { MeasureMetricsContext, type AccountUuid } from '@hcengineering/core'
import type { Context } from '../context'
import type { CollabStorageAdapter, DocumentSaveBatch } from '../storage/adapter'
import { StorageExtension } from '../extensions/storage'

const ctx = new MeasureMetricsContext('test', {})
const A = { account: 'A' as AccountUuid, connectionId: 'A', wsIds: { uuid: 'workspace' } } as unknown as Context
const B = { ...A, account: 'B' as AccountUuid, connectionId: 'B' }
const C = { ...A, account: 'C' as AccountUuid, connectionId: 'C' }
const transformer: Transformer = {
  fromYdoc: (doc: Doc) => ({ content: doc.getText('content').toString() }),
  toYdoc: () => new Doc()
}

function deferred (): { promise: Promise<void>, resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((_resolve) => {
    resolve = _resolve
  })
  return { promise, resolve }
}

async function setup (saveDocument: CollabStorageAdapter['saveDocument']): Promise<{
  extension: StorageExtension
  document: Document
  edit: (context: Context, value: string) => void
  store: (context: Context) => Promise<void>
}> {
  const extension = new StorageExtension({
    ctx,
    transformer,
    adapter: {
      loadDocument: async () => undefined,
      saveDocument
    },
    saveRetryInterval: 1
  })
  const document = new Document('doc', undefined, { gc: false })
  document.isLoading = false
  document.getText('content').insert(0, 'old')
  await extension.afterLoadDocument({ documentName: 'doc', document, context: A } as unknown as Parameters<
    StorageExtension['afterLoadDocument']
  >[0])
  const edit = (context: Context, value: string): void => {
    document.transact(
      () => {
        document.getText('content').insert(document.getText('content').length, value)
      },
      { context }
    )
    void extension.onChange({ context, document, documentName: 'doc' } as unknown as Parameters<
      StorageExtension['onChange']
    >[0])
  }
  const store = async (context: Context): Promise<void> => {
    await extension.onStoreDocument({ context, document, documentName: 'doc' } as unknown as Parameters<
      StorageExtension['onStoreDocument']
    >[0])
  }
  return { extension, document, edit, store }
}

it('freezes bytes/markup/authors before I/O and preserves edits arriving during a failed save', async () => {
  const started = deferred()
  const release = deferred()
  const batches: DocumentSaveBatch[] = []
  const bytes: string[] = []
  const save = jest
    .fn<ReturnType<CollabStorageAdapter['saveDocument']>, Parameters<CollabStorageAdapter['saveDocument']>>()
    .mockImplementation(async (_ctx, _name, document, _context, markup, batch) => {
      batches.push(batch as DocumentSaveBatch)
      // Block before reading markup, matching delayed blob storage/client connection.
      if (save.mock.calls.length === 1) {
        started.resolve()
        await release.promise
        throw new Error('retry')
      }
      bytes.push(document.getText('content').toString())
      return markup.curr()
    })
  const { extension, document, edit, store } = await setup(save)
  edit(A, 'a')
  edit(B, 'b')
  const saving = store(B)
  await started.promise
  edit(B, 'c')
  edit(C, 'd')
  release.resolve()
  await saving
  await store(C)
  expect(batches[1]).toBe(batches[0])
  expect(batches[0].segments.map(({ context, prev, curr }) => [context.account, prev.content, curr.content])).toEqual([
    ['A', 'old', 'olda'],
    ['B', 'olda', 'oldab']
  ])
  expect(batches[2].segments.map(({ context, prev, curr }) => [context.account, prev.content, curr.content])).toEqual([
    ['B', 'oldab', 'oldabc'],
    ['C', 'oldabc', 'oldabcd']
  ])
  expect(bytes).toEqual(['oldab', 'oldabcd'])
  await extension.afterUnloadDocument({ documentName: 'doc' } as unknown as Parameters<
    StorageExtension['afterUnloadDocument']
  >[0])
  document.destroy()
})

it('retains the actual baseline even if an old adapter returns undefined for normalized no-op saves', async () => {
  const save = jest.fn().mockResolvedValue(undefined)
  const { extension, document, edit, store } = await setup(save)
  edit(A, 'a')
  await store(A)
  edit(B, 'b')
  await store(B)
  expect(save.mock.calls[1][4].prev()).toEqual({ content: 'olda' })
  document.destroy()
  await extension.onDestroy()
})

it('keeps the last actual editor on disconnect and removes listeners on unload/reload', async () => {
  const save = jest.fn().mockImplementation(async (_ctx, _name, _document, _context, markup) => markup.curr())
  const { extension, document, edit } = await setup(save)
  edit(A, 'a')
  edit(B, 'b')
  await extension.onDisconnect({ context: A, document, documentName: 'doc' } as unknown as Parameters<
    StorageExtension['onDisconnect']
  >[0])
  expect(save.mock.calls[0][3].account).toBe('B')
  expect(save.mock.calls[0][5].segments.map(({ context }: { context: Context }) => context.account)).toEqual(['A', 'B'])
  await extension.afterUnloadDocument({ documentName: 'doc' } as unknown as Parameters<
    StorageExtension['afterUnloadDocument']
  >[0])
  edit(C, 'c')
  await extension.afterLoadDocument({ documentName: 'doc', document, context: A } as unknown as Parameters<
    StorageExtension['afterLoadDocument']
  >[0])
  edit(A, 'd')
  await extension.onStoreDocument({ context: A, document, documentName: 'doc' } as unknown as Parameters<
    StorageExtension['onStoreDocument']
  >[0])
  expect(save.mock.calls[1][5].segments).toHaveLength(1)
  expect(save.mock.calls[1][5].segments[0].prev.content).toBe('oldabc')
  document.destroy()
})

it('recognizes real Hocuspocus DirectConnection origins used by updateContent RPC', async () => {
  const save = jest.fn().mockImplementation(async (_ctx, _name, _document, _context, markup) => markup.curr())
  const extension = new StorageExtension({
    ctx,
    transformer,
    adapter: {
      loadDocument: async () => new Doc(),
      saveDocument: save
    }
  })
  const server = new Hocuspocus({ extensions: [extension], debounce: 60000, maxDebounce: 60000 })
  const connection = await server.openDirectConnection('rpc-doc', A)
  await connection.transact((document) => {
    const source = new Doc()
    source.getText('content').insert(0, 'rpc')
    document.transact(() => {
      applyUpdate(document, encodeStateAsUpdate(source))
    }, connection)
    source.destroy()
  })
  expect(save.mock.calls[0][5].segments[0]).toMatchObject({ context: A, curr: { content: 'rpc' } })
  await connection.disconnect()
  // Cancel the normal debounce queued by the same update; no listening socket is needed.
  await server.destroy()
})

it('tracks authenticated Hocuspocus websocket update origins, ignoring duplicate sync on connect', async () => {
  const save = jest.fn().mockImplementation(async (_ctx, _name, _document, _context, markup) => markup.curr())
  const { extension, document, store } = await setup(save)
  document.onUpdate((_document, connection) => {
    void extension.onChange({
      context: connection.context,
      document,
      documentName: 'doc'
    } as unknown as Parameters<StorageExtension['onChange']>[0])
  })
  const connect = (context: Context): Connection => {
    const socket = Object.assign(new EventEmitter(), { send: jest.fn(), readyState: 1 })
    return new Connection(
      socket as unknown as ConstructorParameters<typeof Connection>[0],
      new IncomingMessage(new Socket()),
      document,
      60000,
      context.connectionId,
      context,
      false,
      new Debugger()
    ).beforeHandleMessage(async () => {})
  }
  const a = connect(A)
  const b = connect(B)
  const source = new Doc()
  const send = async (connection: Connection): Promise<void> => {
    connection.handleMessage(
      new OutgoingMessage('doc').createSyncMessage().writeUpdate(encodeStateAsUpdate(source)).toUint8Array()
    )
    await new Promise((resolve) => setImmediate(resolve))
  }
  applyUpdate(source, encodeStateAsUpdate(document))
  source.getText('content').insert(3, 'a')
  await send(a)
  await send(b) // B only synchronizes; it must not become an editor.
  await store(B)
  expect(save.mock.calls[0][3].account).toBe('A')
  expect(save.mock.calls[0][5].segments).toHaveLength(1)
  source.getText('content').insert(4, 'b')
  await send(b)
  a.close()
  b.close()
  await extension.onDisconnect({ context: B, document, documentName: 'doc' } as unknown as Parameters<
    StorageExtension['onDisconnect']
  >[0])
  expect(save.mock.calls[1][5].segments[0]).toMatchObject({
    context: B,
    prev: { content: 'olda' },
    curr: { content: 'oldab' }
  })
  source.destroy()
  document.destroy()
})

it('keeps disconnect and unload pending while a frozen save retries', async () => {
  const started = deferred()
  const retrying = deferred()
  const release = deferred()
  const save = jest.fn().mockImplementation(async (_ctx, _name, _document, _context, markup) => {
    if (save.mock.calls.length === 1) {
      started.resolve()
      throw new Error('blob unavailable')
    }
    retrying.resolve()
    await release.promise
    return markup.curr()
  })
  const { extension, document, edit, store } = await setup(save)
  edit(A, 'a')
  const saving = store(A)
  await started.promise
  let unloaded = false
  const disconnecting = extension
    .onDisconnect({ context: A, document, documentName: 'doc' } as unknown as Parameters<
      StorageExtension['onDisconnect']
    >[0])
    .then(async () => {
      await extension.afterUnloadDocument({ documentName: 'doc' } as unknown as Parameters<
        StorageExtension['afterUnloadDocument']
      >[0])
      unloaded = true
    })
  await retrying.promise
  expect(unloaded).toBe(false)
  expect(document.getText('content').toString()).toBe('olda')
  release.resolve()
  await Promise.all([saving, disconnecting])
  expect(unloaded).toBe(true)
  expect(save).toHaveBeenCalledTimes(2)
  document.destroy()
})

it('preserves a replacement document and its pending authors when an older save and unload finish', async () => {
  const started = deferred()
  const release = deferred()
  const save = jest.fn().mockImplementation(async (_ctx, _name, _document, _context, markup) => {
    if (save.mock.calls.length === 1) {
      started.resolve()
      await release.promise
    }
    return markup.curr()
  })
  const { extension, document, edit, store } = await setup(save)
  edit(A, 'a')
  const saving = store(A)
  await started.promise
  const unloading = extension.afterUnloadDocument({ documentName: 'doc' } as unknown as Parameters<
    StorageExtension['afterUnloadDocument']
  >[0])
  const replacement = new Document('doc', undefined, { gc: false })
  replacement.isLoading = false
  replacement.getText('content').insert(0, 'replacement')
  await extension.afterLoadDocument({ documentName: 'doc', document: replacement, context: A } as unknown as Parameters<
    StorageExtension['afterLoadDocument']
  >[0])
  replacement.transact(
    () => {
      replacement.getText('content').insert(11, 'b')
    },
    { context: B }
  )
  await extension.onChange({ context: B, document: replacement, documentName: 'doc' } as unknown as Parameters<
    StorageExtension['onChange']
  >[0])
  release.resolve()
  await Promise.all([saving, unloading])
  replacement.transact(
    () => {
      replacement.getText('content').insert(12, 'c')
    },
    { context: C }
  )
  await extension.onChange({ context: C, document: replacement, documentName: 'doc' } as unknown as Parameters<
    StorageExtension['onChange']
  >[0])
  await extension.onStoreDocument({ context: C, document: replacement, documentName: 'doc' } as unknown as Parameters<
    StorageExtension['onStoreDocument']
  >[0])
  expect(save.mock.calls[1][4].prev()).toEqual({ content: 'replacement' })
  expect(
    save.mock.calls[1][5].segments.map(({ context, prev, curr }: DocumentSaveBatch['segments'][number]) => [
      context.account,
      prev.content,
      curr.content
    ])
  ).toEqual([
    ['B', 'replacement', 'replacementb'],
    ['C', 'replacementb', 'replacementbc']
  ])
  document.destroy()
  replacement.destroy()
})

it('handles a rejected save during shutdown and still removes unloaded document listeners', async () => {
  const started = deferred()
  const release = deferred()
  const save = jest.fn().mockImplementation(async () => {
    started.resolve()
    await release.promise
    throw new Error('storage unavailable')
  })
  const { extension, document, edit, store } = await setup(save)
  const off = jest.spyOn(document, 'off')
  edit(A, 'a')
  const saving = expect(store(A)).rejects.toThrow('Aborted')
  await started.promise
  const unloading = expect(
    extension.afterUnloadDocument({ documentName: 'doc' } as unknown as Parameters<
      StorageExtension['afterUnloadDocument']
    >[0])
  ).resolves.toBeUndefined()
  const destroying = extension.onDestroy()
  release.resolve()
  await Promise.all([saving, unloading, destroying])
  expect(off).toHaveBeenCalledWith('beforeTransaction', expect.any(Function))
  expect(off).toHaveBeenCalledWith('afterTransaction', expect.any(Function))
  document.destroy()
})

it.each([false, true])('persists Yjs bytes when markup conversion fails (at load: %s)', async (failAtLoad) => {
  let fail = failAtLoad
  const fromYdoc = jest.fn((doc: Doc) => {
    if (fail) throw new Error('unsupported shared type')
    return { content: doc.getText('content').toString() }
  })
  const save = jest.fn().mockImplementation(async (_ctx, _name, document, _context, markup, batch) => {
    expect(document.getText('content').toString()).toBe('oldab')
    expect(markup.curr()).toEqual(failAtLoad ? {} : { content: 'old' })
    expect(batch.segments).toHaveLength(1)
    expect(batch.segments[0].curr).toEqual(batch.segments[0].prev)
    return markup.curr()
  })
  const extension = new StorageExtension({
    ctx,
    transformer: { fromYdoc, toYdoc: () => new Doc() },
    adapter: { loadDocument: async () => undefined, saveDocument: save }
  })
  const document = new Document('doc')
  document.isLoading = false
  document.getText('content').insert(0, 'old')
  await extension.afterLoadDocument({ context: A, document, documentName: 'doc' } as unknown as Parameters<
    StorageExtension['afterLoadDocument']
  >[0])
  document.transact(
    () => {
      document.getText('content').insert(3, 'a')
    },
    { context: A }
  )
  document.transact(
    () => {
      document.getText('content').insert(4, 'b')
    },
    { context: B }
  )
  fail = true
  await extension.onChange({ context: B, document, documentName: 'doc' } as unknown as Parameters<
    StorageExtension['onChange']
  >[0])
  await extension.onStoreDocument({ context: B, document, documentName: 'doc' } as unknown as Parameters<
    StorageExtension['onStoreDocument']
  >[0])
  expect(save).toHaveBeenCalledTimes(1)
  document.destroy()
})
