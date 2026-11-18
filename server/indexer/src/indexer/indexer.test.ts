// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Anticrm Platform Contributors.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { NoSuchKeyError } from '@hcengineering/server-core'
import { FullTextIndexPipeline } from './indexer'

interface TestContext {
  debug: jest.Mock
  error: jest.Mock
  with: jest.Mock
}

interface TestPipeline {
  storageAdapter: { read: jest.Mock, stat: jest.Mock }
  workspace: { uuid: string, dataId: string }
  processCollaborativeDoc: (
    ctx: TestContext,
    value: { value: string, attr: { name: string } },
    indexedDoc: { fulltextSummary: string }
  ) => Promise<void>
}

const BLOB_REF = '0123456789abcdef01234567-description-1710000000000'

function createPipeline (read: jest.Mock): TestPipeline {
  return Object.assign(Object.create(FullTextIndexPipeline.prototype), {
    storageAdapter: { read, stat: jest.fn() },
    workspace: { uuid: 'workspace', dataId: 'data' }
  }) as TestPipeline
}

function createContext (): TestContext {
  const ctx: TestContext = { debug: jest.fn(), error: jest.fn(), with: jest.fn() }
  ctx.with.mockImplementation(async (_name: string, _params: object, fn: (child: TestContext) => Promise<void>) => {
    await fn(ctx)
  })
  return ctx
}

describe('FullTextIndexPipeline collaborative documents', () => {
  it('indexes normalized inline text when no collaborative blob exists', async () => {
    const read = jest.fn().mockRejectedValue({ code: 'NoSuchKey' })
    const pipeline = createPipeline(read)
    const ctx = createContext()
    const indexedDoc = { fulltextSummary: '' }
    const inlineText = 'Phase:  Biotechnology\n\n**Milestone**'

    await pipeline.processCollaborativeDoc(ctx, { value: inlineText, attr: { name: 'description' } }, indexedDoc)

    expect(indexedDoc.fulltextSummary).toBe('\nPhase: Biotechnology\n**Milestone**')
    expect(read).toHaveBeenCalledWith(ctx, pipeline.workspace, inlineText)
    expect(pipeline.storageAdapter.stat).not.toHaveBeenCalled()
    expect(ctx.debug).toHaveBeenCalledWith('indexing inline collaborative document', {
      workspace: 'workspace',
      attribute: 'description',
      size: inlineText.length
    })
    expect(ctx.error).not.toHaveBeenCalled()
  })

  it('converts inline markup JSON to text when no collaborative blob exists', async () => {
    const read = jest.fn().mockRejectedValue({ code: 'NoSuchKey' })
    const pipeline = createPipeline(read)
    const ctx = createContext()
    const indexedDoc = { fulltextSummary: '' }
    const inlineMarkup = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inline collaborative document' }] }]
    })

    await pipeline.processCollaborativeDoc(ctx, { value: inlineMarkup, attr: { name: 'description' } }, indexedDoc)

    expect(indexedDoc.fulltextSummary).toBe('\nInline collaborative document')
    expect(ctx.error).not.toHaveBeenCalled()
  })

  it.each([
    '{"hello":"world"}',
    '{not valid JSON',
    '{"type":"custom","content":[]}',
    '{"type":"doc","content":[{"text":"searchable"}]}'
  ])('preserves inline text that is not a markup document: %s', async (value) => {
    const pipeline = createPipeline(jest.fn().mockRejectedValue(new NoSuchKeyError('missing', { code: 'NoSuchKey' })))
    const ctx = createContext()
    const indexedDoc = { fulltextSummary: '' }

    await pipeline.processCollaborativeDoc(ctx, { value, attr: { name: 'description' } }, indexedDoc)

    expect(indexedDoc.fulltextSummary).toBe('\n' + value)
    expect(ctx.error).not.toHaveBeenCalled()
  })

  it.each([
    '{"type":"doc","content":[]}',
    '{"type":"doc"}'
  ])('preserves empty markup document semantics: %s', async (value) => {
    const pipeline = createPipeline(jest.fn().mockRejectedValue({ code: 'NoSuchKey' }))
    const ctx = createContext()
    const indexedDoc = { fulltextSummary: '' }

    await pipeline.processCollaborativeDoc(
      ctx,
      { value, attr: { name: 'description' } },
      indexedDoc
    )

    expect(indexedDoc.fulltextSummary).toBe('\n')
    expect(ctx.error).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } },
    { code: 'NoSuchKey' },
    { statusCode: 404 }
  ])('indexes inline text for a wrapped missing object: %j', async (cause) => {
    const pipeline = createPipeline(jest.fn().mockRejectedValue(new NoSuchKeyError('missing', cause)))
    const ctx = createContext()
    const indexedDoc = { fulltextSummary: '' }

    await pipeline.processCollaborativeDoc(ctx, { value: 'hello', attr: { name: 'description' } }, indexedDoc)

    expect(indexedDoc.fulltextSummary).toBe('\nhello')
    expect(ctx.error).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } },
    { code: 'ETIMEDOUT' },
    { name: 'InternalError', $metadata: { httpStatusCode: 500 } },
    { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }
  ])('reports wrapped storage failures without indexing inline text: %j', async (cause) => {
    const pipeline = createPipeline(jest.fn().mockRejectedValue(new NoSuchKeyError('read failed', cause)))
    const ctx = createContext()
    const indexedDoc = { fulltextSummary: 'existing' }

    await pipeline.processCollaborativeDoc(ctx, { value: 'hello', attr: { name: 'description' } }, indexedDoc)

    expect(indexedDoc.fulltextSummary).toBe('existing')
    expect(ctx.debug).not.toHaveBeenCalled()
    expect(ctx.error).toHaveBeenCalledWith('failed to handle blob', { _id: 'hello', workspace: 'workspace' })
  })

  it('reports a cyclic storage error without entering the inline fallback', async () => {
    const failure = new NoSuchKeyError('read failed')
    Object.assign(failure, { cause: failure })
    const pipeline = createPipeline(jest.fn().mockRejectedValue(failure))
    const ctx = createContext()
    const indexedDoc = { fulltextSummary: '' }

    await pipeline.processCollaborativeDoc(ctx, { value: 'hello', attr: { name: 'description' } }, indexedDoc)

    expect(indexedDoc.fulltextSummary).toBe('')
    expect(ctx.error).toHaveBeenCalled()
  })

  it('continues to index an existing collaborative blob as markup text', async () => {
    const markup = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Existing collaborative document' }] }]
    })
    const read = jest.fn().mockResolvedValue([Buffer.from(markup)])
    const pipeline = createPipeline(read)
    const ctx = createContext()
    const indexedDoc = { fulltextSummary: '' }

    await pipeline.processCollaborativeDoc(ctx, { value: BLOB_REF, attr: { name: 'description' } }, indexedDoc)

    expect(indexedDoc.fulltextSummary).toBe('\nExisting collaborative document')
    expect(read).toHaveBeenCalledWith(ctx, pipeline.workspace, BLOB_REF)
    expect(pipeline.storageAdapter.stat).not.toHaveBeenCalled()
    expect(ctx.debug).not.toHaveBeenCalled()
    expect(ctx.error).not.toHaveBeenCalled()
  })

  it('does not index a missing collaborative blob reference as inline text', async () => {
    const read = jest.fn().mockRejectedValue({ code: 'NoSuchKey' })
    const pipeline = createPipeline(read)
    const ctx = createContext()
    const indexedDoc = { fulltextSummary: '' }

    await pipeline.processCollaborativeDoc(ctx, { value: BLOB_REF, attr: { name: 'description' } }, indexedDoc)

    expect(indexedDoc.fulltextSummary).toBe('')
    expect(ctx.debug).not.toHaveBeenCalled()
    expect(ctx.error).toHaveBeenCalledWith('failed to handle blob', { _id: BLOB_REF, workspace: 'workspace' })
  })

  it('skips an empty collaborative document value', async () => {
    const read = jest.fn()
    const pipeline = createPipeline(read)
    const ctx = createContext()
    const indexedDoc = { fulltextSummary: 'existing' }

    await pipeline.processCollaborativeDoc(ctx, { value: '', attr: { name: 'description' } }, indexedDoc)

    expect(indexedDoc.fulltextSummary).toBe('existing')
    expect(read).not.toHaveBeenCalled()
    expect(pipeline.storageAdapter.stat).not.toHaveBeenCalled()
    expect(ctx.debug).not.toHaveBeenCalled()
    expect(ctx.error).not.toHaveBeenCalled()
  })
})
