// Tests for Refs class to improve coverage
//
// Copyright © 2024 Hardcore Engineering Inc.
//

import core, { createClient, TxOperations, Hierarchy } from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'
import { Refs } from '../refs'

async function getClient (): Promise<{ liveQuery: LiveQuery, factory: TxOperations, close: () => Promise<void> }> {
  const storage = await createClient(connect)
  const liveQuery = new LiveQuery(storage)
  storage.notify = (...tx) => {
    void liveQuery.tx(...tx)
  }
  return {
    liveQuery,
    factory: new TxOperations(storage, core.account.System),
    close: async () => {
      await liveQuery.close()
    }
  }
}

describe('Refs Class Coverage Tests', () => {
  it('should find document from refs cache with specific _id', async () => {
    const { liveQuery, factory, close } = await getClient()

    // Create a document
    const space1 = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'cached-space-1',
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    // Query it to cache it
    const callback = jest.fn()
    liveQuery.query(core.class.Space, { _id: space1 }, callback)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Now findOne should use cached version
    const result = await liveQuery.findOne(core.class.Space, { _id: space1 })

    expect(result).toBeDefined()
    expect(result?._id).toBe(space1)

    await close()
  })

  it('should handle findOne with limit=1 without sort', async () => {
    const { liveQuery, factory, close } = await getClient()

    // Create multiple documents
    await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'test-1',
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'test-2',
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    // findOne with limit should use refs optimization
    const result = await liveQuery.findOne(core.class.Space, { private: false }, { limit: 1 })

    expect(result).toBeDefined()

    await close()
  })

  it('should handle findOne with associations and lookup', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'lookup-test',
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    // Query with lookup to populate refs cache
    const callback = jest.fn()
    liveQuery.query(core.class.Space, { _id: space }, callback, { lookup: { _id: { docs: core.class.Doc } } })

    await new Promise((resolve) => setTimeout(resolve, 100))

    // FindOne should use refs cache
    const result = await liveQuery.findOne(
      core.class.Space,
      { _id: space },
      { lookup: { _id: { docs: core.class.Doc } } }
    )

    expect(result).toBeDefined()

    await close()
  })

  it('should strip $lookup and $associations when finding from cache without them', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'strip-test',
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    // Query with lookup to cache with $lookup
    const callback = jest.fn()
    liveQuery.query(core.class.Space, { _id: space }, callback, { lookup: { _id: { docs: core.class.Doc } } })

    await new Promise((resolve) => setTimeout(resolve, 100))

    // FindOne without lookup should strip $lookup from cached doc
    const result = await liveQuery.findOne(core.class.Space, { _id: space })

    expect(result).toBeDefined()
    expect((result as any).$lookup).toBeUndefined()

    await close()
  })

  it('should handle mixin class in findOne', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'mixin-findone',
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    // Query to cache
    const callback = jest.fn()
    liveQuery.query(core.class.Space, { _id: space }, callback)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Find with different class to test mixin path
    const result = await liveQuery.findOne(core.class.Space, { _id: space })

    expect(result).toBeDefined()

    await close()
  })

  it('should handle query with lookup and associations together', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'both-options',
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    const callback = jest.fn()

    liveQuery.query(core.class.Space, { _id: space }, callback, {
      lookup: { _id: { docs: core.class.Doc } },
      associations: []
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(callback).toHaveBeenCalled()

    await close()
  })

  it('should handle updating refs cache on document changes', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'update-refs',
      description: 'original',
      private: false,
      members: [],
      archived: false
    })

    // Cache it
    const callback = jest.fn()
    liveQuery.query(core.class.Space, { _id: space }, callback)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Update it
    await factory.updateDoc(core.class.Space, core.space.Model, space, {
      description: 'updated'
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Find should have updated version
    const result = await liveQuery.findOne(core.class.Space, { _id: space })

    expect(result).toBeDefined()
    expect(result?.description).toBe('updated')

    await close()
  })

  it('should clean refs cache when query is removed', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'clean-refs',
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    // Cache it
    const callback = jest.fn()
    const unsubscribe = liveQuery.query(core.class.Space, { _id: space }, callback)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Unsubscribe to clean refs
    unsubscribe()

    await new Promise((resolve) => setTimeout(resolve, 100))

    await close()
  })

  it('should handle multiple queries referencing same document', async () => {
    const { liveQuery, factory, close } = await getClient()

    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'multi-ref',
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    // Multiple queries on same document
    const callback1 = jest.fn()
    const callback2 = jest.fn()
    const callback3 = jest.fn()

    liveQuery.query(core.class.Space, { _id: space }, callback1)
    liveQuery.query(core.class.Space, { _id: space }, callback2)
    liveQuery.query(core.class.Space, { _id: space }, callback3)

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(callback1).toHaveBeenCalled()
    expect(callback2).toHaveBeenCalled()
    expect(callback3).toHaveBeenCalled()

    await close()
  })

  it('should use refs cache for descendants check', async () => {
    const { liveQuery, factory, close } = await getClient()

    // Create documents
    const space1 = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'desc-test-1',
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    // Cache with callback
    const callback = jest.fn()
    liveQuery.query(core.class.Space, {}, callback)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // FindOne by _id should check descendants
    const result = await liveQuery.findOne(core.class.Space, { _id: space1 })

    expect(result).toBeDefined()

    await close()
  })

  it('should remove single-element cached query when document stops matching', async () => {
    const { liveQuery, factory, close } = await getClient()

    const sname = 'single-remove-' + Date.now()
    const s = await factory.createDoc(core.class.Space, core.space.Model, {
      name: sname,
      description: 'test',
      private: false,
      members: [],
      archived: false
    })

    // Prime cache with a query that will return this single doc (unique name filter)
    const cb = jest.fn()
    liveQuery.query(core.class.Space, { name: sname }, cb, { limit: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Update document so it no longer matches the query (rename to something else)
    await factory.updateDoc(core.class.Space, core.space.Model, s, { name: sname + '-updated' })

    // Give LiveQuery some time to process txes and update refs
    await new Promise((resolve) => setTimeout(resolve, 200))

    const res = await liveQuery.findOne(core.class.Space, { name: sname }, { limit: 1 })
    expect(res).toBeUndefined()

    await close()
  })

  it('should update cached document when multiple txes have equal modifiedOn', async () => {
    const { liveQuery, factory, close } = await getClient()

    const s = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'eq-mod',
      description: 'original',
      private: false,
      members: [],
      archived: false
    })

    // Prime the cache
    const cb = jest.fn()
    liveQuery.query(core.class.Space, { _id: s }, cb)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const ts = Date.now()

    await factory.updateDoc(
      core.class.Space,
      core.space.Model,
      s,
      { description: 'first' },
      undefined,
      ts,
      core.account.System
    )

    // Simulate a later transaction with the same modifiedOn but different content
    await factory.updateDoc(
      core.class.Space,
      core.space.Model,
      s,
      { description: 'second' },
      undefined,
      ts,
      core.account.System
    )

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 200))

    const r = await liveQuery.findOne(core.class.Space, { _id: s })
    expect(r).toBeDefined()
    // Desired behaviour: latest (second) update should be visible even if modifiedOn equals
    expect(r?.description).toBe('second')

    await close()
  })

  it('should handle two queries where object stops matching first but continues matching second (equal modifiedOn)', async () => {
    const { liveQuery, factory, close } = await getClient()

    const unique = 'two-queries-' + Date.now()
    const s = await factory.createDoc(core.class.Space, core.space.Model, {
      name: unique,
      // fieldA used by query1, fieldB used by query2
      fieldA: 'A',
      fieldB: 'B',
      description: 'before',
      private: false,
      members: [],
      archived: false
    } as any)

    // Two queries: one on fieldA, another on fieldB
    const cb1 = jest.fn()
    const cb2 = jest.fn()
    liveQuery.query(core.class.Space, { fieldA: 'A' }, cb1)
    liveQuery.query(core.class.Space, { fieldB: 'B' }, cb2)
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Both queries should find the document initially
    const r1 = await liveQuery.findOne(core.class.Space, { fieldA: 'A' }, { limit: 1 })
    const r2 = await liveQuery.findOne(core.class.Space, { fieldB: 'B' }, { limit: 1 })
    expect(r1).toBeDefined()
    expect(r2).toBeDefined()

    // Now perform updates with the same modifiedOn timestamp:
    const ts = Date.now()
    // Update so it stops matching query1 (change fieldA), but still matches query2 (fieldB unchanged)
    await factory.updateDoc(
      core.class.Space,
      core.space.Model,
      s,
      { fieldA: 'X' } as any,
      undefined,
      ts,
      core.account.System
    )
    // Another tx with same modifiedOn that updates description
    await factory.updateDoc(
      core.class.Space,
      core.space.Model,
      s,
      { description: 'after' },
      undefined,
      ts,
      core.account.System
    )

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 200))

    // findOne by _id should return the updated document (no stale version)
    const updated = await liveQuery.findOne(core.class.Space, { _id: s })
    expect(updated).toBeDefined()
    expect(updated?.description).toBe('after')
    expect((updated as any)?.fieldA).toBe('X')

    // It should still be visible via the second query (fieldB still 'B')
    const still = await liveQuery.findOne(core.class.Space, { fieldB: 'B' }, { limit: 1 })
    expect(still).toBeDefined()

    await close()
  })

  // Unit tests for Refs internals (fast, isolated)
  it('Refs internals: removes document from cache when clean=true', () => {
    const refs = new Refs(() => new Hierarchy())
    const q = { id: 1001, options: {} } as any

    const doc: any = { _id: 'unit-doc1', _class: core.class.Space, modifiedOn: 1000 }

    // Add doc under query q
    refs.updateDocuments(q, [doc])

    const classKey = (core.class.Space as string) + ':' + JSON.stringify({}) + ':' + JSON.stringify({})
    const docMap = (refs as any).documentRefs.get(classKey)
    expect(docMap).toBeDefined()
    expect(docMap.get('unit-doc1')).toBeDefined()

    // Now remove association (clean=true) - should delete entry if no more queries
    refs.updateDocuments(q, [doc], true)

    expect(docMap.get('unit-doc1')).toBeUndefined()
  })

  it('Refs internals: replaces stored document when incoming doc has same modifiedOn', () => {
    const refs = new Refs(() => new Hierarchy())
    const q1 = { id: 21, options: {} } as any
    const q2 = { id: 22, options: {} } as any

    const doc1: any = { _id: 'unit-doc2', _class: core.class.Space, modifiedOn: 2000, v: 'old' }
    const doc2: any = { _id: 'unit-doc2', _class: core.class.Space, modifiedOn: 2000, v: 'new' }

    // First transaction writes doc1
    refs.updateDocuments(q1, [doc1])
    // Later transaction (same modifiedOn) writes doc2
    refs.updateDocuments(q2, [doc2])

    const classKey = (core.class.Space as string) + ':' + JSON.stringify({}) + ':' + JSON.stringify({})
    const docMap = (refs as any).documentRefs.get(classKey)
    const stored = docMap.get('unit-doc2')
    expect(stored).toBeDefined()
    // Newer (later processed) document should replace the earlier one despite equal modifiedOn
    expect(stored.doc).toBe(doc2)
    expect(stored.queries).toEqual(new Set([q1.id, q2.id]))
  })

  it('Refs internals: maintains queries and removes doc only when all queries are gone', () => {
    const refs = new Refs(() => new Hierarchy())
    const q1 = { id: 31, options: {} } as any
    const q2 = { id: 32, options: {} } as any

    const doc: any = { _id: 'unit-doc3', _class: core.class.Space, modifiedOn: 3000 }

    // Add same doc under two queries
    refs.updateDocuments(q1, [doc])
    refs.updateDocuments(q2, [doc])

    const classKey = (core.class.Space as string) + ':' + JSON.stringify({}) + ':' + JSON.stringify({})
    const docMap = (refs as any).documentRefs.get(classKey)
    const stored = docMap.get('unit-doc3')
    expect(stored.queries).toEqual(new Set([q1.id, q2.id]))

    // Remove only q1 association; entry must remain and contain q2
    refs.updateDocuments(q1, [doc], true)
    expect(docMap.get('unit-doc3').queries).toEqual(new Set([q2.id]))

    // Remove q2 as well; entry must be deleted
    refs.updateDocuments(q2, [doc], true)
    expect(docMap.get('unit-doc3')).toBeUndefined()
  })
})
