// Coverage for the `if (q.result instanceof Promise) { q.result = await q.result }` guards that
// protect every per-query handler from a tx landing while the query's initial findAll is still
// pending. The guard is exercised for real: the client's findAll is gated so a subscription's
// result stays a Promise, txes are pushed through liveQuery.tx() while it is still pending, and
// only then is the gate released. The contract under test is that the tx is neither lost nor
// applied twice once the initial load lands - not just that the guard line executed.
//
// Some `if (q.result instanceof Promise)` guards in src/index.ts are unreachable through the
// public API: their only callers already resolve q.result (via an identical guard) earlier in
// the very same synchronous continuation, so by the time the inner guard runs, q.result can never
// still be a Promise. This was verified empirically (a racing test against each, checked against
// istanbul line coverage) before being written off - see the report for the full list.

import core, {
  createClient,
  generateId,
  SortingOrder,
  TxOperations,
  type AccountUuid,
  type Class,
  type Client,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type FindResult,
  type OperationDomain,
  type Ref,
  type Space,
  type Tx
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'
import { test, type ParticipantsHolder } from './minmodel'

interface TestProject extends Space {
  prjName: string
}

function makeDeferred (): { promise: Promise<void>, resolve: () => void } {
  let resolveFn!: () => void
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve
  })
  return { promise, resolve: resolveFn }
}

// Wraps the client's findAll so a call matching the armed predicate blocks (does not even reach
// the real findAll) until release() is called. Armed once, auto-disarms on the first match.
async function getGatedClient (): Promise<{
  liveQuery: LiveQuery
  factory: TxOperations
  storage: Client
  arm: (predicate: (_class: Ref<Class<Doc>>) => boolean) => void
  release: () => void
  findAllCalls: () => number
}> {
  const storage = await createClient(connect)
  const rawFindAll = storage.findAll.bind(storage)
  let armed: ((_class: Ref<Class<Doc>>) => boolean) | null = null
  let deferred: ReturnType<typeof makeDeferred> | null = null
  let released = false
  let calls = 0
  const gated: Client = Object.assign(Object.create(Object.getPrototypeOf(storage)), storage, {
    findAll: async (_class: any, query: any, options: any) => {
      calls++
      if (armed?.(_class) === true) {
        armed = null
        // Snapshot before any gated tx touches the store - a write during the gated window
        // would reach the result via this same findAll once released, masking the tx path.
        const snapshot = await rawFindAll(_class, query, options)
        if (!released) {
          deferred = makeDeferred()
          await deferred.promise
        }
        return snapshot
      }
      return await rawFindAll(_class, query, options)
    }
  })
  const liveQuery = new LiveQuery(gated)
  storage.notify = (...tx: Tx[]) => {
    liveQuery.tx(...tx).catch((err) => {
      console.log(err)
    })
  }
  return {
    liveQuery,
    factory: new TxOperations(storage, core.account.System),
    storage,
    arm: (predicate) => {
      armed = predicate
    },
    release: () => {
      released = true
      deferred?.resolve()
    },
    findAllCalls: () => calls
  }
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

// pushCallback's guard fires from a setTimeout(0) macrotask; microtask work (incl. ungated
// findAll) drains first, so without this tick a subscribe sees an already-resolved q.result.
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 3))
}

async function createProject (factory: TxOperations, prjName: string): Promise<Ref<TestProject>> {
  return await factory.createDoc(test.class.TestProject, core.space.Model, {
    name: prjName,
    description: '',
    private: false,
    members: [],
    archived: false,
    prjName
  })
}

async function createHolder (factory: TxOperations, participants: Ref<Doc>[] = []): Promise<Ref<ParticipantsHolder>> {
  return await factory.createDoc(test.class.ParticipantsHolder, core.space.Model, { participants })
}

describe('LiveQuery - tx arrives while the initial findAll is still in flight', () => {
  it('TxCreateDoc: a doc created during load is not duplicated once the load lands', async () => {
    const { liveQuery, factory, arm, release } = await getGatedClient()

    arm((c) => c === test.class.TestProject)
    let last: TestProject[] = []
    liveQuery.query<TestProject>(test.class.TestProject, { prjName: 'racy-create' }, (res) => {
      last = res
    })

    // Created while findAll is gated: the eventual findAll response will already include it too.
    const id = await createProject(factory, 'racy-create')
    release()
    await settle()

    expect(last).toHaveLength(1)
    expect(last[0]._id).toBe(id)
  })

  it('TxUpdateDoc + lookup: an update during load is applied exactly once, lookup included', async () => {
    const { liveQuery, factory, arm, release } = await getGatedClient()
    const space = await factory.createDoc(core.class.Space, core.space.Model, {
      name: 'lookup-space',
      description: '',
      private: false,
      members: [],
      archived: false
    })
    const commentId = await factory.addCollection(test.class.TestComment, space, space, core.class.Space, 'comments', {
      message: 'before'
    })

    arm((c) => c === test.class.TestComment)
    let last: any[] = []
    liveQuery.query(
      test.class.TestComment,
      {},
      (res) => {
        last = res
      },
      { lookup: { space: core.class.Space } }
    )

    await new Promise((resolve) => setTimeout(resolve, 3)) // known trap: distinct ms so modifiedOn strictly advances
    await factory.updateDoc(test.class.TestComment, space, commentId, { message: 'after' })
    release()
    await settle()

    expect(last).toHaveLength(1)
    expect(last[0].message).toBe('after')
    expect(last[0].$lookup?.space?.name).toBe('lookup-space')
  })

  it('TxRemoveDoc: a doc removed during load is gone once the load lands (L1383)', async () => {
    const { liveQuery, factory, arm, release } = await getGatedClient()
    const id = await createProject(factory, 'racy-remove')

    arm((c) => c === test.class.TestProject)
    let last: TestProject[] = []
    liveQuery.query<TestProject>(test.class.TestProject, { prjName: 'racy-remove' }, (res) => {
      last = res
    })

    await factory.removeDoc(test.class.TestProject, core.space.Model, id)
    release()
    await settle()

    expect(last).toHaveLength(0)
  })

  it('TxMixin: a mixin applied during load is not lost once the load lands (L712)', async () => {
    const { liveQuery, factory, arm, release } = await getGatedClient()
    const id = await createProject(factory, 'racy-mixin')

    arm((c) => c === test.class.TestProject)
    let last: TestProject[] = []
    liveQuery.query<TestProject>(test.class.TestProject, { prjName: 'racy-mixin' }, (res) => {
      last = res
    })

    await new Promise((resolve) => setTimeout(resolve, 3)) // known trap: modifiedOn must be strictly newer
    await factory.createMixin(id, test.class.TestProject, core.space.Model, test.mixin.TestProjectMixin, {
      someField: 'applied-during-flight'
    })
    release()
    await settle()

    const hierarchy = liveQuery.getHierarchy()
    const mixed = hierarchy.as(last[0], test.mixin.TestProjectMixin) as unknown as { someField?: string }
    expect(mixed.someField).toBe('applied-during-flight')
  })

  it('associations: a Relation created during load fills $associations exactly once (L1224)', async () => {
    const { liveQuery, factory, arm, release } = await getGatedClient()
    const projectId = await createProject(factory, 'racy-assoc')
    const holderId = await createHolder(factory)

    arm((c) => c === test.class.TestProject)
    let last: any[] = []
    liveQuery.query(
      test.class.TestProject,
      { _id: projectId },
      (res) => {
        last = res
      },
      { associations: [[test.association.ProjectHolder, 1]] }
    )

    await factory.createDoc(core.class.Relation, core.space.Model, {
      docA: projectId,
      docB: holderId,
      association: test.association.ProjectHolder
    })
    release()
    await settle()

    const linked = last[0]?.$associations?.[`${test.association.ProjectHolder}_b`]
    expect(linked).toHaveLength(1)
    expect(linked?.[0]._id).toBe(holderId)
  })

  it('callback path: a second subscribe for the same query while pending reuses it, not a new server call (L399)', async () => {
    const { liveQuery, factory, arm, release, findAllCalls } = await getGatedClient()
    await createProject(factory, 'racy-double')

    arm((c) => c === test.class.TestProject)
    let r1: TestProject[] = []
    let r2: TestProject[] = []
    liveQuery.query<TestProject>(test.class.TestProject, { prjName: 'racy-double' }, (res) => {
      r1 = res
    })
    const before = findAllCalls()
    liveQuery.query<TestProject>(test.class.TestProject, { prjName: 'racy-double' }, (res) => {
      r2 = res
    })
    await tick() // let the second subscribe's setTimeout(0) callback run while still gated
    release()
    await settle()

    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
    expect(r1[0].prjName).toBe('racy-double')
    expect(r2[0].prjName).toBe('racy-double')
    expect(findAllCalls()).toBe(before) // the second subscribe did not trigger its own findAll
  })

  it('refresh path: queryFind() on the same still-pending query returns the resolved result (L558)', async () => {
    const { liveQuery, factory, arm, release } = await getGatedClient()
    await createProject(factory, 'racy-queryfind')

    arm((c) => c === test.class.TestProject)
    let subscribed: TestProject[] = []
    liveQuery.query<TestProject>(test.class.TestProject, { prjName: 'racy-queryfind' }, (res) => {
      subscribed = res
    })

    const queryFindPromise = liveQuery.queryFind<TestProject>(test.class.TestProject, { prjName: 'racy-queryfind' })
    release()
    const queryFindResult = await queryFindPromise
    await settle()

    expect(queryFindResult).toHaveLength(1)
    expect(queryFindResult[0].prjName).toBe('racy-queryfind')
    expect(subscribed).toHaveLength(1)
  })
})

describe('LiveQuery - option and LRU branches', () => {
  it('extends a caller-supplied projection with _class/space/modifiedOn before it reaches the server (findAll, L273)', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    const factory = new TxOperations(storage, core.account.System)
    await createProject(factory, 'projected-findall')

    const rawFindAll = storage.findAll.bind(storage)
    let seenProjection: FindOptions<Doc>['projection']
    storage.findAll = async <T extends Doc> (
      _class: Ref<Class<T>>,
      query: DocumentQuery<T>,
      options?: FindOptions<T>
    ): Promise<FindResult<T>> => {
      seenProjection = options?.projection
      return await rawFindAll(_class, query, options)
    }

    const result = await liveQuery.findAll(
      test.class.TestProject,
      { prjName: 'projected-findall' },
      {
        projection: { prjName: 1 }
      }
    )

    expect(result[0].prjName).toBe('projected-findall')
    expect(seenProjection).toEqual({ prjName: 1, _class: 1, space: 1, modifiedOn: 1 })
  })

  it('extends a caller-supplied projection with _class/space/modifiedOn before it reaches the server (findOne, L319)', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    const factory = new TxOperations(storage, core.account.System)
    await createProject(factory, 'projected-findone')

    // findOne funnels through createQuery -> client.findAll (with limit: 1), not client.findOne.
    const rawFindAll = storage.findAll.bind(storage)
    let seenProjection: FindOptions<Doc>['projection']
    storage.findAll = async <T extends Doc> (
      _class: Ref<Class<T>>,
      query: DocumentQuery<T>,
      options?: FindOptions<T>
    ): Promise<FindResult<T>> => {
      seenProjection = options?.projection
      return await rawFindAll(_class, query, options)
    }

    const result = await liveQuery.findOne(
      test.class.TestProject,
      { prjName: 'projected-findone' },
      {
        projection: { prjName: 1 }
      }
    )

    expect(result?.prjName).toBe('projected-findone')
    expect(seenProjection).toEqual({ prjName: 1, _class: 1, space: 1, modifiedOn: 1 })
  })

  it('passes domainRequest straight through to the underlying client (L303)', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    // OperationDomain is a branded string; a plain literal needs a cast to satisfy it.
    const domain = 'test-domain' as OperationDomain
    const spyResult = { domain, value: 'ok' }
    storage.domainRequest = jest.fn().mockResolvedValue(spyResult)

    const result = await liveQuery.domainRequest(domain, { field: 1 }, { retry: true })

    expect(storage.domainRequest).toHaveBeenCalledWith('test-domain', { field: 1 }, { retry: true })
    expect(result).toBe(spyResult)
  })

  it('evicts the LRU queue from inside query creation, not just on unsubscribe (L468)', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    const factory = new TxOperations(storage, core.account.System)
    const id = await createProject(factory, 'lru-survivor')
    // Park it in the queue (unsubscribed queries live there too), then hold it warm with
    // findOne calls.
    const unsubscribe = liveQuery.query<TestProject>(test.class.TestProject, { _id: id }, () => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    unsubscribe()

    const rawFindAll = storage.findAll.bind(storage)
    let calls = 0
    storage.findAll = async <T extends Doc> (
      _class: Ref<Class<T>>,
      query: DocumentQuery<T>,
      options?: FindOptions<T>
    ): Promise<FindResult<T>> => {
      calls++
      return await rawFindAll(_class, query, options)
    }

    // CACHE_SIZE is 125: each findOne creates its own dump query via createQuery, tripping
    // `this.queue.size > CACHE_SIZE` at creation - unlike the check refs-cache.test.ts covers.
    for (let i = 0; i < 140; i++) {
      await liveQuery.findOne(test.class.TestProject, { prjName: `lru-filler-${i}` })
    }

    const before = calls
    const doc = await liveQuery.findOne(test.class.TestProject, { _id: id })
    expect(doc?.prjName).toBe('lru-survivor')
    expect(calls).toBeGreaterThan(before) // evicted: answering it needed a fresh server call
  })

  it('resorts on an update whose operator keys touch a sorted field (checkNeedSort, L1740)', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    const factory = new TxOperations(storage, core.account.System)
    storage.notify = (...tx: Tx[]) => {
      liveQuery.tx(...tx).catch((err) => {
        console.log(err)
      })
    }
    const p1 = await createProject(factory, 'aaa')
    const p2 = await createProject(factory, 'bbb')

    let last: TestProject[] = []
    await new Promise<void>((resolve) => {
      liveQuery.query<TestProject>(
        test.class.TestProject,
        {},
        (res) => {
          last = res
          resolve()
        },
        { sort: { members: SortingOrder.Ascending } }
      )
    })
    void p1
    // $push on `members` (sorted field) hits the `opKey in sort` branch, distinct from a plain
    // field update. AccountUuid is branded - a fresh id needs any unique value cast to it.
    await factory.updateDoc(test.class.TestProject, core.space.Model, p2, {
      $push: { members: `member-${generateId()}` as AccountUuid }
    })
    await settle()

    expect(last).toHaveLength(2)
  })

  it('re-sorts after a lookup-add and after a lookup-remove (L1314, L1444)', async () => {
    const storage = await createClient(connect)
    const liveQuery = new LiveQuery(storage)
    const factory = new TxOperations(storage, core.account.System)
    storage.notify = (...tx: Tx[]) => {
      liveQuery.tx(...tx).catch((err) => {
        console.log(err)
      })
    }
    await createProject(factory, 'bbb-sort')
    const aId = await createProject(factory, 'aaa-sort')

    let last: any[] = []
    await new Promise<void>((resolve) => {
      liveQuery.query(
        test.class.TestProject,
        {},
        (res) => {
          last = res
          resolve()
        },
        {
          lookup: { _id: { comments: test.class.TestComment } },
          sort: { prjName: SortingOrder.Ascending }
        }
      )
    })
    expect(last.map((d: any) => d.prjName)).toEqual(['aaa-sort', 'bbb-sort'])

    const commentId = await factory.addCollection(
      test.class.TestComment,
      core.space.Model,
      aId,
      test.class.TestProject,
      'comments',
      {
        message: 'hi'
      }
    )
    await settle()
    expect(last.map((d: any) => d.prjName)).toEqual(['aaa-sort', 'bbb-sort'])
    expect(last[0].$lookup?.comments).toHaveLength(1)

    await factory.removeCollection(
      test.class.TestComment,
      core.space.Model,
      commentId,
      aId,
      test.class.TestProject,
      'comments'
    )
    await settle()
    expect(last.map((d: any) => d.prjName)).toEqual(['aaa-sort', 'bbb-sort'])
    expect(last[0].$lookup?.comments).toHaveLength(0)
  })
})
