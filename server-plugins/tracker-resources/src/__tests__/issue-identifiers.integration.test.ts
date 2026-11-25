// SPDX-License-Identifier: EPL-2.0

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="node" />

import core, {
  Hierarchy,
  MeasureMetricsContext,
  ModelDb,
  type Class,
  type Data,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type FindResult,
  type MeasureContext,
  type Ref,
  type Space,
  type Tx,
  TxFactory,
  type TxCreateDoc,
  type TxRemoveDoc,
  type TxUpdateDoc,
  type WorkspaceUuid
} from '@hcengineering/core'
import buildModel from '@hcengineering/model-all'
import { createMongoAdapter, createMongoTxAdapter, getMongoClient, shutdownMongo } from '@hcengineering/mongo'
import { addLocation, getResourcePlugin } from '@hcengineering/platform'
import { createPostgresAdapter, createPostgresTxAdapter, getDBClient, shutdownPostgres } from '@hcengineering/postgres'
import serverCore, { Triggers, type DbAdapter, type Trigger, type TriggerControl } from '@hcengineering/server-core'
import tracker, { type Issue, type IssueIdentifierAlias } from '@hcengineering/tracker'
import trackerResources from '../index'

const A = 'project-a' as Ref<Space>
const B = 'project-b' as Ref<Space>
const C = 'project-c' as Ref<Space>
const factory = new TxFactory(core.account.System)
const modelBuilder = buildModel()
const modelTxes = modelBuilder.getTxes()
const postgresUrl = process.env.DB_URL ?? 'postgresql://root@localhost:26258/defaultdb?sslmode=disable'
const mongoUrl = process.env.MONGO_URL ?? 'mongodb://localhost:27018'
const postgresClient = getDBClient(postgresUrl)

let hierarchy: Hierarchy
let model: ModelDb
let triggers: Triggers
let closeWorld: (() => Promise<void>) | undefined

jest.setTimeout(30000)

beforeAll(async () => {
  hierarchy = modelBuilder.hierarchy
  model = new ModelDb(hierarchy)
  for (const tx of modelTxes) {
    await model.tx(tx)
  }
  const trackerTriggers = modelTxes.filter(
    (tx): tx is TxCreateDoc<Trigger> =>
      tx._class === core.class.TxCreateDoc &&
      (tx as TxCreateDoc<Trigger>).objectClass === serverCore.class.Trigger &&
      getResourcePlugin((tx as TxCreateDoc<Trigger>).attributes.trigger) === 'server-tracker'
  )
  addLocation(getResourcePlugin(trackerTriggers[0].attributes.trigger), async () => ({ default: trackerResources }))
  triggers = new Triggers(hierarchy)
  await triggers.tx(trackerTriggers)
}, 30000)

afterEach(async () => {
  await closeWorld?.()
})

afterAll(async () => {
  postgresClient.close()
  await Promise.all([shutdownMongo(), shutdownPostgres()])
})

interface AdapterWorld {
  create: (identifier?: string, withHistory?: boolean) => Promise<TxCreateDoc<Issue>>
  persist: (tx: Tx, withHistory?: boolean) => Promise<void>
  apply: (txes: Tx[]) => Promise<Tx[]>
  historyReads: Array<{ kind: Ref<Class<Doc>>, issue: unknown, excluded: unknown }>
  aliasReads: unknown[]
  peakHistoryReads: () => number
}

async function createWorld (kind: 'mongo' | 'postgres'): Promise<AdapterWorld> {
  const ctx = new MeasureMetricsContext('test', {})
  const workspaceUuid = crypto.randomUUID() as WorkspaceUuid
  let storage: DbAdapter
  let txStorage: DbAdapter
  let timestamp = Date.now()

  if (kind === 'postgres') {
    const client = await postgresClient.getClient()
    await client`CREATE DATABASE ${client(workspaceUuid)}`
    const url = postgresUrl.replace('defaultdb', workspaceUuid)
    const ids = { uuid: workspaceUuid, url }
    storage = await createPostgresAdapter(ctx, hierarchy, url, ids, model)
    txStorage = await createPostgresTxAdapter(ctx, hierarchy, url, ids, model)
    await storage.init?.(ctx, {}, [
      hierarchy.getDomain(tracker.class.Issue),
      hierarchy.getDomain(tracker.class.IssueIdentifierAlias),
      hierarchy.getDomain(core.class.Tx)
    ])
    await txStorage.init?.(ctx, {})
    closeWorld = async () => {
      await storage.close()
      await txStorage.close()
      const client = await postgresClient.getClient()
      await client`DROP DATABASE ${client(workspaceUuid)}`
    }
  } else {
    const ids = { uuid: workspaceUuid, url: workspaceUuid }
    storage = await createMongoAdapter(ctx, hierarchy, mongoUrl, ids, model)
    txStorage = await createMongoTxAdapter(ctx, hierarchy, mongoUrl, ids, model)
    await txStorage.init?.(ctx, {})
    closeWorld = async () => {
      await storage.close()
      await txStorage.close()
      const client = getMongoClient(mongoUrl)
      await (await client.getClient()).db(workspaceUuid).dropDatabase()
      client.close()
    }
  }

  const historyReads: AdapterWorld['historyReads'] = []
  const aliasReads: AdapterWorld['aliasReads'] = []
  let activeHistoryReads = 0
  let peakHistoryReads = 0
  const findAll = async <T extends Doc> (
    ctx: MeasureContext,
    kind: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: FindOptions<T>
  ): Promise<FindResult<T>> => {
    if (kind === tracker.class.IssueIdentifierAlias) aliasReads.push(query.issue)
    if (kind !== core.class.TxUpdateDoc && kind !== core.class.TxCreateDoc) {
      return await storage.findAll(ctx, kind, query, options)
    }
    historyReads.push({ kind, issue: query.objectId, excluded: query._id })
    activeHistoryReads++
    peakHistoryReads = Math.max(peakHistoryReads, activeHistoryReads)
    try {
      return await storage.findAll(ctx, kind, query, options)
    } finally {
      activeHistoryReads--
    }
  }
  const control = {
    ctx,
    findAll,
    hierarchy,
    workspace: { uuid: workspaceUuid },
    removedMap: new Map()
  } as unknown as Omit<TriggerControl, 'txFactory' | 'txes'>

  async function persist (tx: Tx, withHistory = true): Promise<void> {
    tx.modifiedOn = ++timestamp
    await storage.tx(ctx, tx)
    if (withHistory) await txStorage.tx(ctx, tx)
  }

  return {
    create: async (identifier = 'A-1', withHistory = true) => {
      const tx = factory.createTxCreateDoc(tracker.class.Issue, A, {
        identifier,
        parents: [],
        childInfo: [],
        estimation: 0,
        reportedTime: 0
      } as unknown as Data<Issue>)
      await persist(tx, withHistory)
      return tx
    },
    persist,
    apply: async (txes) => {
      for (const tx of txes) await persist(tx)
      const result = await triggers.apply(ctx, txes, { ...control, txes: [...txes] }, 'sync')
      for (const tx of result) await persist(tx, false)
      return result
    },
    historyReads,
    aliasReads,
    peakHistoryReads: () => peakHistoryReads
  }
}

function move (issue: Ref<Issue>, from: Ref<Space>, identifier: string, space: Ref<Space>): TxUpdateDoc<Issue> {
  return factory.createTxUpdateDoc(tracker.class.Issue, from, issue, { identifier, space })
}

function createdAliases (txes: Tx[]): TxCreateDoc<IssueIdentifierAlias>[] {
  return txes.filter(
    (tx): tx is TxCreateDoc<IssueIdentifierAlias> =>
      tx._class === core.class.TxCreateDoc &&
      (tx as TxCreateDoc<IssueIdentifierAlias>).objectClass === tracker.class.IssueIdentifierAlias
  )
}

describe.each(['mongo', 'postgres'] as const)('%s issue identifier history', (kind) => {
  it('uses only the latest identifier before the current move', async () => {
    const world = await createWorld(kind)
    const { objectId } = await world.create()
    await world.persist(move(objectId, A, 'B-7', B))
    await world.persist(move(objectId, B, 'B-8', B))
    const result = await world.apply([move(objectId, B, 'C-3', C)])
    expect(createdAliases(result).map((tx) => tx.attributes.identifier)).toEqual(['B-8'])
  })

  it('recovers the previous identifier without a create transaction', async () => {
    const world = await createWorld(kind)
    const { objectId } = await world.create('A-1', false)
    await world.persist(move(objectId, A, 'B-7', B))
    const result = await world.apply([move(objectId, B, 'C-3', C)])
    expect(createdAliases(result).map((tx) => tx.attributes.identifier)).toEqual(['B-7'])
  })

  it('limits concurrent history reads and excludes only the matching issue transactions', async () => {
    const world = await createWorld(kind)
    const issues: TxCreateDoc<Issue>[] = []
    for (let i = 0; i < 6; i++) issues.push(await world.create(`A-${i + 1}`))
    await world.persist(move(issues[0].objectId, A, 'B-7', B))
    const moves = issues.map((issue, i) => move(issue.objectId, i === 0 ? B : A, `C-${i + 1}`, C))
    const secondMove = move(issues[0].objectId, C, 'C-7', C)
    const other = await world.create('A-7')
    const spaceOnly = factory.createTxUpdateDoc(tracker.class.Issue, A, other.objectId, { space: B })

    const result = await world.apply([...moves, spaceOnly, secondMove])
    const aliases = createdAliases(result)
    expect(aliases).toHaveLength(7)
    expect(new Map(aliases.map((tx) => [tx.attributes.identifier, tx.attributes.issue]))).toEqual(
      new Map([
        ['B-7', issues[0].objectId],
        ['C-1', issues[0].objectId],
        ...issues.slice(1).map((issue): [string, Ref<Issue>] => [issue.attributes.identifier, issue.objectId])
      ])
    )
    expect(aliases.every((tx) => tx.objectSpace === C)).toBe(true)
    expect(world.peakHistoryReads()).toBeGreaterThan(0)
    expect(world.peakHistoryReads()).toBeLessThanOrEqual(4)
    expect(world.historyReads).toHaveLength(11)
    for (const [i, tx] of moves.entries()) {
      const reads = world.historyReads.filter((read) => read.issue === tx.objectId)
      const excluded = i === 0 ? [tx._id, secondMove._id] : [tx._id]
      const classes = i === 0 ? [core.class.TxUpdateDoc] : [core.class.TxUpdateDoc, core.class.TxCreateDoc]
      expect(reads).toEqual(classes.map((kind) => ({ kind, issue: tx.objectId, excluded: { $nin: excluded } })))
    }
  })

  it('loads aliases for all removed issues in one query and leaves other aliases alone', async () => {
    const world = await createWorld(kind)
    const first = await world.create('A-1')
    const second = await world.create('A-2')
    const other = await world.create('A-3')
    const aliases = createdAliases(
      await world.apply([
        move(first.objectId, A, 'B-1', B),
        move(second.objectId, A, 'B-2', B),
        move(other.objectId, A, 'B-3', B)
      ])
    )
    expect(aliases).toHaveLength(3)
    world.aliasReads.length = 0

    const result = await world.apply(
      [first, second, first].map((issue) => factory.createTxRemoveDoc(tracker.class.Issue, B, issue.objectId))
    )
    const removed = result.filter(
      (tx): tx is TxRemoveDoc<IssueIdentifierAlias> =>
        tx._class === core.class.TxRemoveDoc &&
        (tx as TxRemoveDoc<IssueIdentifierAlias>).objectClass === tracker.class.IssueIdentifierAlias
    )
    expect(world.aliasReads).toEqual([{ $in: [first.objectId, second.objectId] }])
    expect(removed).toHaveLength(2)
    expect(new Set(removed.map((tx) => tx.objectId))).toEqual(
      new Set(aliases.filter((tx) => tx.attributes.issue !== other.objectId).map((tx) => tx.objectId))
    )
  })
})
