// SPDX-License-Identifier: EPL-2.0

import core, {
  TxFactory,
  TxProcessor,
  type Data,
  type Doc,
  type Ref,
  type Space,
  type Tx,
  type TxCUD,
  type TxCreateDoc,
  type TxUpdateDoc
} from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'
import tracker, { type Issue, type IssueIdentifierAlias, type Project } from '@hcengineering/tracker'
import { OnIssueUpdate, OnProjectRemove } from '../index'

const A = 'project-a' as Ref<Space>
const B = 'project-b' as Ref<Space>
const C = 'private-project-c' as Ref<Space>
const factory = new TxFactory(core.account.System)
const derived = new TxFactory(core.account.System, true)

function makeWorld (): {
  create: TxCreateDoc<Issue>
  docs: Map<Ref<Doc>, Doc>
  creates: Map<Ref<Doc>, TxCreateDoc<Doc>>
  previousUpdates: Map<Ref<Doc>, TxUpdateDoc<Issue>>
  archived: Set<Ref<Space>>
  control: TriggerControl
  findAll: jest.Mock
  apply: (txes: Tx[]) => Promise<Tx[]>
  move: (identifier: string, space: Ref<Space>) => Tx
  aliases: () => IssueIdentifierAlias[]
} {
  const create = factory.createTxCreateDoc(
    tracker.class.Issue,
    A,
    { identifier: 'A-1', parents: [], childInfo: [], estimation: 0, reportedTime: 0 } as unknown as Data<Issue>,
    'issue' as Ref<Issue>,
    1
  )
  const docs = new Map<Ref<Doc>, Doc>([[create.objectId, TxProcessor.createDoc2Doc(create)]])
  const creates = new Map<Ref<Doc>, TxCreateDoc<Doc>>([[create.objectId, create]])
  const previousUpdates = new Map<Ref<Doc>, TxUpdateDoc<Issue>>()
  const archived = new Set<Ref<Space>>()
  const findAll = jest.fn(
    async (_ctx: unknown, cls: string, query: Record<string, unknown>, options?: { showArchived?: boolean }) => {
      if (cls === core.class.TxUpdateDoc) {
        const previous = previousUpdates.get(query.objectId as Ref<Doc>)
        return previous === undefined ? [] : [previous]
      }
      if (cls === core.class.TxCreateDoc) {
        const created = creates.get(query.objectId as Ref<Doc>)
        return created === undefined ? [] : [created]
      }
      const ids = cls === tracker.class.Issue ? (query._id as { $in: Ref<Doc>[] } | undefined)?.$in : undefined
      const issueIds =
        cls === tracker.class.IssueIdentifierAlias ? (query.issue as { $in: Ref<Doc>[] } | undefined)?.$in : undefined
      return [...docs.values()].filter(
        (doc) =>
          doc._class === cls &&
          (!archived.has(doc.space) || options?.showArchived === true) &&
          (ids === undefined || ids.includes(doc._id)) &&
          (issueIds === undefined || issueIds.includes((doc as IssueIdentifierAlias).issue))
      )
    }
  )
  const control = {
    ctx: { warn: jest.fn(), contextData: { broadcast: { targets: {} } } },
    findAll,
    txFactory: derived,
    hierarchy: { isDerived: (a: string, b: string) => a === b },
    txes: [] as Tx[],
    removedMap: new Map()
  } as unknown as TriggerControl

  function persist (txes: Tx[]): void {
    for (const tx of txes) {
      const cud = tx as TxCUD<Doc>
      if (tx._class === core.class.TxCreateDoc) {
        docs.set(cud.objectId, TxProcessor.createDoc2Doc(cud as Parameters<typeof TxProcessor.createDoc2Doc>[0]))
      } else if (tx._class === core.class.TxUpdateDoc) {
        const doc = docs.get(cud.objectId)
        if (doc !== undefined) TxProcessor.updateDoc2Doc(doc, cud as Parameters<typeof TxProcessor.updateDoc2Doc>[1])
      } else if (tx._class === core.class.TxRemoveDoc) {
        docs.delete(cud.objectId)
      }
    }
  }

  async function apply (txes: Tx[]): Promise<Tx[]> {
    persist(txes)
    control.txes = [...txes]
    const result = await OnIssueUpdate(txes, control)
    persist(result)
    for (const tx of txes) {
      if (tx._class === core.class.TxCreateDoc) {
        const createTx = tx as TxCreateDoc<Doc>
        creates.set(createTx.objectId, createTx)
      } else if (tx._class === core.class.TxUpdateDoc) {
        const updateTx = tx as TxUpdateDoc<Issue>
        if (updateTx.operations.identifier !== undefined) previousUpdates.set(updateTx.objectId, updateTx)
      }
    }
    return result
  }

  function move (identifier: string, space: Ref<Space>): Tx {
    const issue = docs.get(create.objectId) as Issue
    return factory.createTxUpdateDoc(tracker.class.Issue, issue.space, issue._id, { identifier, space })
  }

  function aliases (): IssueIdentifierAlias[] {
    return [...docs.values()].filter(
      (doc): doc is IssueIdentifierAlias => doc._class === tracker.class.IssueIdentifierAlias
    )
  }
  return { create, docs, creates, previousUpdates, archived, control, findAll, apply, move, aliases }
}

it('writes aliases from ordinary issue updates without any new client payload', async () => {
  const world = makeWorld()
  const result = await world.apply([world.move('B-7', B)])
  expect(world.aliases()).toEqual([expect.objectContaining({ identifier: 'A-1', issue: 'issue', space: B })])
  expect(result[0].space).toBe(core.space.DerivedTx)
})

it('keeps every alias in the current private project when an old client moves an issue again', async () => {
  const world = makeWorld()
  await world.apply([world.move('B-7', B)])
  await world.apply([world.move('C-3', C)])
  expect(world.aliases().map(({ identifier, space }) => ({ identifier, space }))).toEqual([
    { identifier: 'A-1', space: C },
    { identifier: 'B-7', space: C }
  ])
})

it('retains both identifiers when an issue moves back', async () => {
  const world = makeWorld()
  await world.apply([world.move('B-7', B)])
  await world.apply([world.move('A-9', A)])
  expect(world.aliases().map((alias) => alias.identifier)).toEqual(['A-1', 'B-7'])
  expect(world.aliases().every((alias) => alias.space === A)).toBe(true)
})

it('does not create an alias for unchanged identifiers, and still repairs alias spaces', async () => {
  const world = makeWorld()
  await world.apply([world.move('B-7', B)])
  await world.apply([world.move('B-7', C)])
  expect(world.aliases()).toHaveLength(1)
  expect(world.aliases()[0].space).toBe(C)
})

it('records every transition when multiple moves are in the same batch', async () => {
  const world = makeWorld()
  await world.apply([world.move('B-7', B), world.move('C-3', C)])
  expect(world.aliases().map((alias) => alias.identifier)).toEqual(['A-1', 'B-7'])
  expect(world.aliases().every((alias) => alias.space === C)).toBe(true)
})

it('handles subissues in a batch and ignores non-Issue attachments', async () => {
  const world = makeWorld()
  const child = factory.createTxCreateDoc(
    tracker.class.Issue,
    A,
    { identifier: 'A-2', parents: [], childInfo: [], estimation: 0, reportedTime: 0 } as unknown as Data<Issue>,
    'child' as Ref<Issue>,
    1
  )
  await world.apply([child])
  const childMove = factory.createTxUpdateDoc(tracker.class.Issue, A, child.objectId, { identifier: 'B-8', space: B })
  const attachment = factory.createTxUpdateDoc(core.class.Doc, A, 'attachment' as Ref<Doc>, { space: B })
  await world.apply([world.move('B-7', B), childMove, attachment])
  expect(world.aliases().map((alias) => alias.identifier)).toEqual(['A-1', 'A-2'])
  await world.apply([
    factory.createTxRemoveDoc(tracker.class.Issue, B, world.create.objectId),
    factory.createTxRemoveDoc(tracker.class.Issue, B, child.objectId)
  ])
  expect(world.aliases()).toEqual([])
})

it('cleans aliases when an issue (including a subissue) is removed', async () => {
  const world = makeWorld()
  await world.apply([world.move('B-7', B)])
  const result = await world.apply([factory.createTxRemoveDoc(tracker.class.Issue, B, world.create.objectId)])
  expect(world.aliases()).toEqual([])
  expect(result.some((tx) => (tx as TxCUD<Doc>).objectClass === tracker.class.IssueIdentifierAlias)).toBe(true)
  expect(world.findAll.mock.calls.some((call) => call[1] === tracker.class.IssueIdentifierAlias)).toBe(true)
})

it('cleans aliases through the project deletion cascade, including archived aliases', async () => {
  const world = makeWorld()
  await world.apply([world.move('B-7', B)])
  world.archived.add(B)
  const projectTx = factory.createTxRemoveDoc(tracker.class.Project, core.space.Space, B as Ref<Project>)
  const cascade = await OnProjectRemove([projectTx], world.control)
  await world.apply(cascade)
  expect(world.aliases()).toEqual([])
  expect(world.findAll.mock.calls.find((call) => call[1] === tracker.class.IssueIdentifierAlias)).toBeDefined()
})

it('records only the new transition, without backfilling historical moves', async () => {
  const world = makeWorld()
  const oldMove = world.move('B-7', B) as TxUpdateDoc<Issue>
  world.previousUpdates.set(world.create.objectId, oldMove)
  TxProcessor.updateDoc2Doc(world.docs.get(world.create.objectId) as Issue, oldMove)
  await world.apply([world.move('C-3', C)])
  expect(world.aliases().map((alias) => alias.identifier)).toEqual(['B-7'])
})

it('queries the latest pre-batch identifier update and falls back to a projected create', async () => {
  const world = makeWorld()
  const move = world.move('B-7', B)
  await world.apply([move])
  const updateCall = world.findAll.mock.calls.find((call) => call[1] === core.class.TxUpdateDoc)
  expect(updateCall?.[2]).toEqual({
    _id: { $nin: [move._id] },
    objectId: 'issue',
    'operations.identifier': { $exists: true }
  })
  expect(updateCall?.[3]).toEqual({
    sort: { modifiedOn: -1, _id: -1 },
    limit: 1,
    projection: { 'operations.identifier': 1 }
  })
  const createCall = world.findAll.mock.calls.find((call) => call[1] === core.class.TxCreateDoc)
  expect(createCall?.[2]).toEqual({ _id: { $nin: [move._id] }, objectId: 'issue' })
  expect(createCall?.[3]).toEqual({ limit: 1, projection: { 'attributes.identifier': 1 } })
})

it('uses the latest identifier update when the create transaction is no longer available', async () => {
  const world = makeWorld()
  const oldMove = world.move('B-7', B) as TxUpdateDoc<Issue>
  world.creates.delete(world.create.objectId)
  world.previousUpdates.set(world.create.objectId, oldMove)
  TxProcessor.updateDoc2Doc(world.docs.get(world.create.objectId) as Issue, oldMove)
  await world.apply([world.move('C-3', C)])
  expect(world.aliases().map((alias) => alias.identifier)).toEqual(['B-7'])
  expect(world.findAll.mock.calls.some((call) => call[1] === core.class.TxCreateDoc)).toBe(false)
})

it('logs when an identifier change has no recoverable previous identifier', async () => {
  const world = makeWorld()
  world.creates.clear()
  await world.apply([world.move('B-7', B)])
  expect(world.aliases()).toEqual([])
  expect(world.control.ctx.warn).toHaveBeenCalledWith(
    'Cannot create issue identifier alias without previous identifier',
    {
      issueId: 'issue',
      txId: expect.any(String)
    }
  )
})
