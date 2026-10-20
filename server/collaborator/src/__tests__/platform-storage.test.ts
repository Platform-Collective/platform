// SPDX-License-Identifier: EPL-2.0

import activity from '@hcengineering/activity'
import core, { MeasureMetricsContext, type Blob, type Ref, type TxOperations } from '@hcengineering/core'
import { loadCollabYdoc, saveCollabJson, saveCollabYdoc } from '@hcengineering/collaboration'
import type { StorageAdapter } from '@hcengineering/server-core'
import { Doc } from 'yjs'
import type { Context } from '../context'
import type { AuthorSegment, DocumentSaveBatch } from '../storage/adapter'
import { PlatformStorageAdapter } from '../storage/platform'

jest.mock('@hcengineering/collaboration', () => ({
  saveCollabJson: jest.fn().mockResolvedValue('blob'),
  saveCollabYdoc: jest.fn().mockResolvedValue('blob'),
  loadCollabYdoc: jest.fn()
}))
jest.mock('@hcengineering/collaborator-client', () => ({
  decodeDocumentId: () => ({ documentId: { objectAttr: 'content', objectClass: 'document', objectId: 'doc' } })
}))

const ctx = new MeasureMetricsContext('test', {})
const markup = (text: string): string =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: text === '' ? [] : [{ type: 'text', text }] }]
  })

function makeClient (account: string): {
  txFactory: { account: string }
  getHierarchy: jest.Mock
  findOne: jest.Mock
  diffUpdate: jest.Mock
  addCollection: jest.Mock
  domainRequest: jest.Mock
  close: jest.Mock
  saved: Map<string, unknown>
} {
  const saved = new Map<string, unknown>()
  return {
    txFactory: { account },
    getHierarchy: jest.fn().mockReturnValue({
      findAttribute: () => ({ type: { _class: core.class.TypeCollaborativeDoc } }),
      isDerived: (a: string, b: string) => a === b,
      isMixin: () => false
    }),
    findOne: jest
      .fn()
      .mockImplementation(async (_class, query) =>
        _class === activity.class.DocUpdateMessage
          ? saved.get(query._id)
          : { _id: 'doc', _class: 'document', space: 'space' }
      ),
    diffUpdate: jest.fn().mockResolvedValue(undefined),
    addCollection: jest.fn().mockImplementation(async (_class, _space, _id, _attachedClass, _collection, data, id) => {
      saved.set(id, data)
      return id
    }),
    domainRequest: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    saved
  }
}

function setup (): {
  adapter: PlatformStorageAdapter
  batch: DocumentSaveBatch
  clients: ReturnType<typeof makeClient>[]
  contexts: Context[]
} {
  const clients = ['A', 'B'].map(makeClient)
  const contexts = clients.map((client, index) => ({
    account: index === 0 ? 'A' : 'B',
    connectionId: String(index),
    wsIds: { uuid: 'workspace' },
    clientFactory: jest.fn().mockResolvedValue(client)
  })) as unknown as Context[]
  const segment = (index: number, prev: string, curr: string, id: string): AuthorSegment => ({
    context: contexts[index],
    prev: { content: markup(prev) },
    curr: { content: markup(curr) },
    id,
    timestamp: Number(id)
  })
  return {
    adapter: new PlatformStorageAdapter({} as unknown as StorageAdapter, { retryCount: 1 }),
    batch: { segments: [segment(0, '', 'a', '1'), segment(1, 'a', 'ab', '2'), segment(0, 'ab', 'abc', '3')] },
    clients,
    contexts
  }
}

beforeEach(() => jest.clearAllMocks())

it('emits exact A/B/A diffs in both representations with one final blob update and cached clients', async () => {
  const { adapter, batch, clients, contexts } = setup()
  const doc = new Doc()
  const curr = batch.segments[2].curr
  const saveStarted = Date.now()
  expect(
    await adapter.saveDocument(
      ctx,
      'doc',
      doc,
      contexts[0],
      {
        prev: () => batch.segments[0].prev,
        curr: () => curr
      },
      batch
    )
  ).toEqual(curr)
  expect(saveCollabYdoc).toHaveBeenCalledTimes(1)
  expect(saveCollabJson).toHaveBeenCalledTimes(1)
  expect(clients[0].diffUpdate).toHaveBeenCalledTimes(1)
  expect(clients[1].diffUpdate).not.toHaveBeenCalled()
  for (const client of clients) {
    expect(client.close).toHaveBeenCalledTimes(1)
    for (const call of client.domainRequest.mock.calls) {
      const event = call[1].event
      const segment = batch.segments.find(({ messageId }) => messageId === event.messageId) as AuthorSegment
      expect(event.socialId).toBe(segment.context.account)
      expect(event.extra.update).toMatchObject({ prevValue: segment.prev.content, value: segment.curr.content })
      expect(event.messageId).toMatch(/^[A-Za-z0-9_-]{11}$/)
      expect(event.messageId.length).toBeLessThanOrEqual(22)
      expect(event.messageId).not.toBe(segment.id)
      expect(event.date.getTime()).toBe(segment.emittedAt)
      expect(segment.emittedAt).toBeGreaterThanOrEqual(saveStarted)
    }
    for (const call of client.addCollection.mock.calls) {
      const segment = batch.segments.find(({ id }) => id === call[6]) as AuthorSegment
      expect(client.txFactory.account).toBe(segment.context.account)
      expect(call[5].attributeUpdates).toMatchObject({ prevValue: segment.prev.content, set: [segment.curr.content] })
      expect(call[7]).toBe(segment.emittedAt)
    }
  }
  expect(contexts[0].clientFactory).toHaveBeenCalledTimes(1)
  expect(contexts[1].clientFactory).toHaveBeenCalledTimes(1)
  expect(clients.map((client) => client.domainRequest.mock.calls.length)).toEqual([2, 1])
  expect(clients.map((client) => client.addCollection.mock.calls.length)).toEqual([2, 1])
  doc.destroy()
})

it.each(['connect', 'event', 'collection', 'ambiguous-event', 'ambiguous-collection'])(
  'resumes a failed second author (%s) without replaying acknowledged writes',
  async (failure) => {
    const { adapter, batch, clients, contexts } = setup()
    const doc = new Doc()
    const getMarkup = { prev: () => batch.segments[0].prev, curr: () => batch.segments[2].curr }
    const events = new Set<string>()
    for (const client of clients) {
      client.domainRequest.mockImplementation(async (_domain, { event }) => {
        events.add(event.messageId)
        if (
          failure === 'ambiguous-event' &&
          event.messageId === batch.segments[1].messageId &&
          client.domainRequest.mock.calls.length === 1
        ) {
          throw new Error('lost event acknowledgement')
        }
      })
    }
    if (failure === 'connect') {
      jest.mocked(contexts[1].clientFactory).mockRejectedValueOnce(new Error('social id unavailable'))
    } else if (failure === 'event') {
      clients[1].domainRequest.mockRejectedValueOnce(new Error('event failed'))
    } else if (failure === 'collection') {
      clients[1].addCollection.mockRejectedValueOnce(new Error('collection failed'))
    } else if (failure === 'ambiguous-collection') {
      clients[1].addCollection.mockImplementationOnce(async (...args) => {
        const [, , , , , data, id] = args
        clients[1].saved.set(id, data)
        throw new Error('lost collection acknowledgement')
      })
    }
    await expect(adapter.saveDocument(ctx, 'doc', doc, contexts[0], getMarkup, batch)).rejects.toThrow()
    const secondTimestamp = batch.segments[1].emittedAt
    await adapter.saveDocument(ctx, 'doc', doc, contexts[0], getMarkup, batch)
    if (secondTimestamp !== undefined) expect(batch.segments[1].emittedAt).toBe(secondTimestamp)
    expect(clients[0].domainRequest).toHaveBeenCalledTimes(2)
    expect(clients[0].addCollection).toHaveBeenCalledTimes(2)
    expect(clients[0].diffUpdate).toHaveBeenCalledTimes(1)
    expect(clients[1].saved.size).toBe(1)
    expect(events).toEqual(new Set(batch.segments.map(({ messageId }) => messageId)))
    expect(
      clients[1].domainRequest.mock.calls.every((call) => call[1].event.messageId === batch.segments[1].messageId)
    ).toBe(true)
    expect(saveCollabYdoc).toHaveBeenCalledTimes(1)
    expect(saveCollabJson).toHaveBeenCalledTimes(1)
    doc.destroy()
  }
)

it('does not replay successful writes when closing the transport fails', async () => {
  const { adapter, batch, clients, contexts } = setup()
  clients[0].close.mockRejectedValueOnce(new Error('close failed'))
  const doc = new Doc()
  await expect(
    adapter.saveDocument(
      ctx,
      'doc',
      doc,
      contexts[0],
      {
        prev: () => batch.segments[0].prev,
        curr: () => batch.segments[2].curr
      },
      batch
    )
  ).resolves.toEqual(batch.segments[2].curr)
  expect(batch.segments.every((segment) => segment.eventSent === true && segment.activitySaved === true)).toBe(true)
  expect(clients[1].close).toHaveBeenCalledTimes(1)
  doc.destroy()
})

it('emits insert/delete runs when final equals initial and updates modifiedBy as the last editor', async () => {
  const { adapter, batch, clients, contexts } = setup()
  batch.segments.splice(2)
  batch.segments[1].curr = batch.segments[0].prev
  const doc = new Doc()
  await adapter.saveDocument(
    ctx,
    'doc',
    doc,
    contexts[1],
    {
      prev: () => batch.segments[0].prev,
      curr: () => batch.segments[1].curr
    },
    batch
  )
  expect(clients[0].domainRequest).toHaveBeenCalledTimes(1)
  expect(clients[1].domainRequest).toHaveBeenCalledTimes(1)
  expect(clients[1].diffUpdate).toHaveBeenCalledTimes(1)
  expect(clients[0].diffUpdate).not.toHaveBeenCalled()
  doc.destroy()
})

it('returns current normalized no-op markup on the legacy call path', async () => {
  const { adapter, clients, contexts } = setup()
  const curr = { content: markup('') }
  expect(
    await adapter.saveDocumentToPlatform(ctx, clients[0] as unknown as TxOperations, contexts[0], 'doc', {
      prev: () => ({ content: '{"type":"doc","content":[]}' }),
      curr: () => curr
    })
  ).toEqual(curr)
  expect(clients[0].domainRequest).not.toHaveBeenCalled()
  expect(clients[0].diffUpdate).not.toHaveBeenCalled()
})

it('freezes the old single-author adapter path before delayed storage', async () => {
  const { adapter, clients, contexts } = setup()
  const doc = new Doc()
  let curr = { content: markup('a') }
  jest.mocked(saveCollabYdoc).mockImplementationOnce(async () => {
    curr = { content: markup('later') }
    return 'blob' as Ref<Blob>
  })
  const result = await adapter.saveDocument(ctx, 'doc', doc, contexts[0], {
    prev: () => ({ content: markup('') }),
    curr: () => curr
  })
  expect(result).toEqual({ content: markup('a') })
  expect(clients[0].domainRequest.mock.calls[0][1].event.extra.update.value).toBe(markup('a'))
  doc.destroy()
})

it('loads an existing Yjs blob and retains its content as the next diff baseline', async () => {
  const { adapter, clients, contexts } = setup()
  const doc = new Doc()
  doc.getText('content').insert(0, 'old')
  jest.mocked(loadCollabYdoc).mockResolvedValueOnce(doc)
  const loaded = await adapter.loadDocument(ctx, 'doc', contexts[0])
  expect(loaded).toBe(doc)
  const prev = { content: markup(loaded?.getText('content').toString() ?? '') }
  await adapter.saveDocument(ctx, 'doc', doc, contexts[0], {
    prev: () => prev,
    curr: () => ({ content: markup('old + new') })
  })
  expect(clients[0].domainRequest.mock.calls[0][1].event.extra.update.prevValue).toBe(markup('old'))
  doc.destroy()
})
