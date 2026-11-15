// SPDX-License-Identifier: EPL-2.0

import core, {
  type Class,
  type Doc,
  type DocumentQuery,
  type Domain,
  type Ref,
  type Tx,
  type TxCreateDoc,
  type TxResult,
  TxProcessor,
  toFindResult
} from '@hcengineering/core'
import { leadId } from '@hcengineering/lead'
import { type MigrationUpgradeClient } from '@hcengineering/model'
import tags, { type TagCategory } from '@hcengineering/tags'
import task, { taskOperation } from '@hcengineering/model-task'

import { leadOperation } from '../migration'
import lead from '../plugin'

function createClient (): { client: MigrationUpgradeClient, tx: jest.Mock<Promise<TxResult>, [Tx]> } {
  const docs: Doc[] = []
  function find (_class: Ref<Class<Doc>>, query: DocumentQuery<Doc>): Doc[] {
    return docs.filter(
      (doc) =>
        (doc._class === _class || (_class === core.class.Space && doc._class === lead.class.Funnel)) &&
        Object.entries(query).every(([key, value]) => (doc as unknown as Record<string, unknown>)[key] === value)
    )
  }

  const tx = jest.fn(async (transaction: Tx) => {
    if (transaction._class !== core.class.TxCreateDoc) {
      throw new Error('Unexpected transaction in category fixture')
    }
    docs.push(TxProcessor.createDoc2Doc(transaction as TxCreateDoc<Doc>))
    return {}
  })
  // Stub only storage and hierarchy checks; run the production upgrade,
  // createOrUpdate and TxOperations implementations.
  const client = {
    findOne: jest.fn(async (_class: Ref<Class<Doc>>, query: DocumentQuery<Doc>) => find(_class, query)[0]),
    findAll: jest.fn(async (_class: Ref<Class<Doc>>, query: DocumentQuery<Doc>) => toFindResult(find(_class, query))),
    getHierarchy: () => ({ isDerived: () => false, findDomain: () => 'tags' as Domain }),
    tx
  } as unknown as MigrationUpgradeClient
  return { client, tx }
}

async function leadCategories (client: MigrationUpgradeClient): Promise<TagCategory[]> {
  // Match the popup's exact class query instead of looking up a Task ancestor.
  return await client.findAll(tags.class.TagCategory, { targetClass: lead.class.Lead })
}

describe('Lead label category upgrade', () => {
  it('creates a default for Quick Add on a fresh workspace alongside the funnel and sequence', async () => {
    const { client } = createClient()
    await taskOperation.upgrade(new Map(), async () => client, 'create')
    const taskCategories = await client.findAll(tags.class.TagCategory, { targetClass: task.class.Task })
    expect(taskCategories).toHaveLength(1)

    await leadOperation.upgrade(new Map(), async () => client, 'create')

    expect(await leadCategories(client)).toEqual(
      toFindResult([
        expect.objectContaining({
          _id: expect.any(String),
          space: core.space.Workspace,
          icon: tags.icon.Tags,
          label: 'Other',
          targetClass: lead.class.Lead,
          tags: [],
          default: true
        })
      ])
    )
    expect(await client.findAll(lead.class.Funnel, { _id: lead.space.DefaultFunnel })).toHaveLength(1)
    expect(await client.findAll(core.class.Sequence, { attachedTo: lead.class.Lead })).toHaveLength(1)
    expect(await client.findAll(tags.class.TagCategory, { targetClass: task.class.Task })).toEqual(taskCategories)
  })

  it('backfills existing workspaces after the funnel defaults have already run', async () => {
    const { client } = createClient()
    const state = new Map([[leadId, new Set(['u-default-funnel'])]])

    await leadOperation.upgrade(state, async () => client, 'upgrade')

    expect(await leadCategories(client)).toEqual(
      toFindResult([expect.objectContaining({ targetClass: lead.class.Lead, default: true, tags: [] })])
    )
    expect(
      await client.findAll(core.class.MigrationState, {
        plugin: leadId,
        state: 'create-default-lead-label-category'
      })
    ).toHaveLength(1)
    expect(await client.findAll(lead.class.Funnel, {})).toHaveLength(0)
    expect(await client.findAll(core.class.Sequence, {})).toHaveLength(0)
  })

  it('does not duplicate the category when an incomplete upgrade is retried', async () => {
    const { client, tx } = createClient()
    const state = new Map([[leadId, new Set(['u-default-funnel'])]])

    await leadOperation.upgrade(state, async () => client, 'upgrade')
    await leadOperation.upgrade(state, async () => client, 'upgrade')

    expect(await leadCategories(client)).toHaveLength(1)
    const categoryWrites = tx.mock.calls.filter(
      ([transaction]) => (transaction as TxCreateDoc<Doc>).objectClass === tags.class.TagCategory
    )
    expect(categoryWrites).toHaveLength(1)
  })

  it('preserves a category edited by a user when an incomplete upgrade is retried', async () => {
    const { client, tx } = createClient()
    const state = new Map([[leadId, new Set(['u-default-funnel'])]])
    await leadOperation.upgrade(state, async () => client, 'upgrade')
    const [category] = await leadCategories(client)
    expect(category).toBeDefined()
    category.modifiedBy = 'test-user' as typeof category.modifiedBy
    category.label = 'Custom labels'
    category.tags = ['Priority']

    tx.mockClear()
    await leadOperation.upgrade(state, async () => client, 'upgrade')

    expect(await leadCategories(client)).toEqual(
      toFindResult([expect.objectContaining({ _id: category._id, label: 'Custom labels', tags: ['Priority'] })])
    )
    expect(
      tx.mock.calls.filter(([transaction]) => (transaction as TxCreateDoc<Doc>).objectClass === tags.class.TagCategory)
    ).toHaveLength(0)
  })

  it('skips the backfill after its migration state is recorded', async () => {
    const { client, tx } = createClient()
    const state = new Map([[leadId, new Set(['u-default-funnel', 'create-default-lead-label-category'])]])
    const getClient = jest.fn(async () => client)

    await leadOperation.upgrade(state, getClient, 'upgrade')

    expect(getClient).not.toHaveBeenCalled()
    expect(tx).not.toHaveBeenCalled()
  })
})
