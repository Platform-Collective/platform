// SPDX-License-Identifier: EPL-2.0

import { CONTENT_NOTICE_KEY, CONTENT_NOTICE_MAP } from '@hcengineering/collaborator-client'
import { MeasureMetricsContext, type WorkspaceUuid } from '@hcengineering/core'
import { DummyStorageAdapter } from '@hcengineering/server-core'
import { Hocuspocus } from '@hocuspocus/server'
import { applyUpdate, encodeStateAsUpdate } from 'yjs'
import type { Context } from '../../context'
import { MarkupTransformer } from '../../transformers/markup'
import { methods } from './index'

const ctx = new MeasureMetricsContext('test', {})
const context: Context = {
  connectionId: 'test',
  wsIds: { uuid: 'workspace' as WorkspaceUuid, url: 'workspace' },
  clientFactory: async () => {
    throw new Error('Unexpected workspace connection')
  }
}
const documentName = 'workspace|Document|doc|content'
const transformer = new MarkupTransformer()
const storageAdapter = new DummyStorageAdapter()
const original = 'Original content'
const replacement = 'Snapshot content'

describe('updateContent', () => {
  const hocuspocus = new Hocuspocus()
  const params = { hocuspocus, transformer, storageAdapter }
  let connection: Awaited<ReturnType<Hocuspocus['openDirectConnection']>>

  beforeEach(async () => {
    connection = await hocuspocus.openDirectConnection(documentName, context)
    await connection.transact((document) => {
      applyUpdate(document, encodeStateAsUpdate(transformer.toYdoc(original, 'content')))
    })
  })

  afterEach(async () => {
    await connection.disconnect()
  })

  it('is registered without a content deletion method', () => {
    expect(methods.updateContent).toBeDefined()
    expect(methods.deleteContent).toBeUndefined()
  })

  it.each([
    null,
    { type: 'document-restored' },
    { type: 123, params: { title: 'Snapshot' } },
    { type: 'document-restored', params: { title: 123 } }
  ])('rejects an invalid notice without changing existing content (%j)', async (notice) => {
    const result = await methods
      .updateContent(ctx, context, documentName, { content: { content: replacement }, notice }, params)
      .catch((err: unknown) => err)

    await connection.transact((document) => {
      expect(transformer.fromYdoc(document, 'content')).toContain(original)
      expect(document.share.has(CONTENT_NOTICE_MAP)).toBe(false)
    })
    expect(result).toEqual(new Error('Invalid collaboration notice'))
  })

  it.each([{ other: null }, { [CONTENT_NOTICE_MAP]: 'Text' }])(
    'rejects an invalid content field before changing any field (%j)',
    async (otherField) => {
      const payload = { content: { content: replacement, ...otherField } }
      const result = await methods
        .updateContent(ctx, context, documentName, payload, params)
        .catch((err: unknown) => err)

      await connection.transact((document) => {
        expect(transformer.fromYdoc(document, 'content')).toContain(original)
      })
      expect(result).toEqual(new Error('Invalid document content'))
    }
  )

  it('rejects a field that conflicts with a shared map before changing any field', async () => {
    await connection.transact((document) => {
      document.getMap('metadata').set('key', 'value')
    })

    const payload = { content: { content: replacement, metadata: 'Text' } }
    await expect(methods.updateContent(ctx, context, documentName, payload, params)).rejects.toThrow()

    await connection.transact((document) => {
      expect(transformer.fromYdoc(document, 'content')).toContain(original)
      expect(document.getMap('metadata').get('key')).toBe('value')
    })
  })

  it('publishes a version-only notice in the content transaction', async () => {
    const observeUpdate = jest.fn()
    await connection.transact((document) => {
      document.on('update', observeUpdate)
    })

    const notice = { type: 'document-restored', params: { title: 'Snapshot', name: 'Other user' } }
    await methods.updateContent(ctx, context, documentName, { content: { content: replacement }, notice }, params)

    await connection.transact((document) => {
      document.off('update', observeUpdate)
      expect(transformer.fromYdoc(document, 'content')).toContain(replacement)
      expect(document.getMap(CONTENT_NOTICE_MAP).get(CONTENT_NOTICE_KEY)).toEqual({
        type: 'document-restored',
        params: { title: 'Snapshot' }
      })
    })
    expect(observeUpdate).toHaveBeenCalledTimes(1)
  })

  it('keeps notices out of the content RPC and whole-document markup', async () => {
    const notice = { type: 'document-restored', params: { title: 'Snapshot' } }
    await methods.updateContent(ctx, context, documentName, { content: { content: replacement }, notice }, params)

    const expected = { content: expect.stringContaining(replacement) }
    await expect(methods.getContent(ctx, context, documentName, {}, params)).resolves.toEqual({ content: expected })
    await connection.transact((document) => {
      expect(transformer.fromYdoc(document)).toEqual(expected)
    })
  })

  it('still replaces content without a notice', async () => {
    await methods.updateContent(ctx, context, documentName, { content: { content: replacement } }, params)

    await connection.transact((document) => {
      expect(transformer.fromYdoc(document, 'content')).toContain(replacement)
      expect(document.share.has(CONTENT_NOTICE_MAP)).toBe(false)
    })
  })
})
