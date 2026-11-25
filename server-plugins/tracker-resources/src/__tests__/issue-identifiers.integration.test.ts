// SPDX-License-Identifier: EPL-2.0

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="node" />

import core, {
  Hierarchy,
  MeasureMetricsContext,
  ModelDb,
  type Data,
  type Ref,
  type Space,
  type Tx,
  TxFactory,
  type TxCreateDoc,
  type WorkspaceUuid
} from '@hcengineering/core'
import buildModel from '@hcengineering/model-all'
import { createMongoAdapter, createMongoTxAdapter, getMongoClient, shutdownMongo } from '@hcengineering/mongo'
import { createPostgresAdapter, createPostgresTxAdapter, getDBClient, shutdownPostgres } from '@hcengineering/postgres'
import { type DbAdapter, type TriggerControl } from '@hcengineering/server-core'
import tracker, { type Issue, type IssueIdentifierAlias } from '@hcengineering/tracker'
import { updateIssueIdentifierAliases } from '../issue-identifiers'

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
let closeWorld: (() => Promise<void>) | undefined

jest.setTimeout(30000)

beforeAll(async () => {
  hierarchy = modelBuilder.hierarchy
  model = new ModelDb(hierarchy)
  for (const tx of modelTxes) {
    await model.tx(tx)
  }
}, 30000)

afterEach(async () => {
  await closeWorld?.()
})

afterAll(async () => {
  postgresClient.close()
  await Promise.all([shutdownMongo(), shutdownPostgres()])
})

interface AdapterWorld {
  create: (withHistory?: boolean) => Promise<TxCreateDoc<Issue>>
  move: (identifier: string, space: Ref<Space>, withTrigger?: boolean) => Promise<Tx[]>
}

async function createWorld (kind: 'mongo' | 'postgres'): Promise<AdapterWorld> {
  const ctx = new MeasureMetricsContext('test', {})
  const workspaceUuid = crypto.randomUUID() as WorkspaceUuid
  const issueId = crypto.randomUUID() as Ref<Issue>
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

  const control = {
    ctx,
    findAll: storage.findAll.bind(storage),
    txFactory: new TxFactory(core.account.System, true),
    hierarchy,
    txes: [] as Tx[],
    removedMap: new Map()
  } as unknown as TriggerControl
  let currentSpace = A

  async function persist (tx: Tx, withHistory: boolean): Promise<void> {
    tx.modifiedOn = ++timestamp
    await storage.tx(ctx, tx)
    if (withHistory) await txStorage.tx(ctx, tx)
  }

  return {
    create: async (withHistory = true) => {
      const tx = factory.createTxCreateDoc(
        tracker.class.Issue,
        A,
        { identifier: 'A-1', parents: [], childInfo: [], estimation: 0, reportedTime: 0 } as unknown as Data<Issue>,
        issueId
      )
      await persist(tx, withHistory)
      return tx
    },
    move: async (identifier, space, withTrigger = false) => {
      const tx = factory.createTxUpdateDoc(tracker.class.Issue, currentSpace, issueId, { identifier, space })
      currentSpace = space
      await persist(tx, true)
      if (!withTrigger) return []
      control.txes = [tx]
      return await updateIssueIdentifierAliases([tx], control)
    }
  }
}

describe.each(['mongo', 'postgres'] as const)('%s issue identifier history', (kind) => {
  it('uses only the latest identifier before the current move', async () => {
    const world = await createWorld(kind)
    await world.create()
    await world.move('B-7', B)
    await world.move('B-8', B)
    const result = await world.move('C-3', C, true)
    const aliases = result.filter(
      (tx): tx is TxCreateDoc<IssueIdentifierAlias> =>
        tx._class === core.class.TxCreateDoc &&
        (tx as TxCreateDoc<IssueIdentifierAlias>).objectClass === tracker.class.IssueIdentifierAlias
    )
    expect(aliases.map((tx) => tx.attributes.identifier)).toEqual(['B-8'])
  })

  it('recovers the previous identifier without a create transaction', async () => {
    const world = await createWorld(kind)
    await world.create(false)
    await world.move('B-7', B)
    const result = await world.move('C-3', C, true)
    const aliases = result.filter(
      (tx): tx is TxCreateDoc<IssueIdentifierAlias> =>
        tx._class === core.class.TxCreateDoc &&
        (tx as TxCreateDoc<IssueIdentifierAlias>).objectClass === tracker.class.IssueIdentifierAlias
    )
    expect(aliases.map((tx) => tx.attributes.identifier)).toEqual(['B-7'])
  })
})
