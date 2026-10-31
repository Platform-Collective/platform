// SPDX-License-Identifier: EPL-2.0

import core, {
  type Class,
  type Doc,
  type DocumentQuery,
  type Ref,
  type Tx,
  type TxCreateDoc,
  type TxResult,
  TxProcessor,
  toFindResult
} from '@hcengineering/core'
import { type MigrationUpgradeClient } from '@hcengineering/model'
import tags, { DOMAIN_TAGS, type TagCategory } from '@hcengineering/model-tags'
import { recruitId } from '@hcengineering/recruit'

import { recruitOperation } from '../migration'
import recruit from '../plugin'

// Skill templates are unrelated to label defaults; keep the fresh-workspace fixture small.
jest.mock('@anticrm/skillset', () => ({ getCategories: () => [] }))

function createClient (): { client: MigrationUpgradeClient, tx: jest.Mock<Promise<TxResult>, [Tx]> } {
  const docs: Doc[] = []
  function find (_class: Ref<Class<Doc>>, query: DocumentQuery<Doc>): Doc[] {
    return docs.filter(
      (doc) =>
        doc._class === _class &&
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
  // Only transport/storage and hierarchy checks are stubbed; upgrade dispatch,
  // createOrUpdate and TxOperations all run their production implementations.
  const client = {
    findOne: jest.fn(async (_class: Ref<Class<Doc>>, query: DocumentQuery<Doc>) => find(_class, query)[0]),
    findAll: jest.fn(async (_class: Ref<Class<Doc>>, query: DocumentQuery<Doc>) => toFindResult(find(_class, query))),
    getHierarchy: () => ({ isDerived: () => false, findDomain: () => DOMAIN_TAGS }),
    tx
  } as unknown as MigrationUpgradeClient
  return { client, tx }
}

async function applicantCategories (client: MigrationUpgradeClient): Promise<TagCategory[]> {
  // Use the popup's exact targetClass query, rather than a Task ancestor lookup.
  return await client.findAll(tags.class.TagCategory, { targetClass: recruit.class.Applicant })
}

describe('Applicant label category upgrade', () => {
  it('creates a default for Quick Add on a fresh workspace without changing Candidate skills', async () => {
    const { client } = createClient()

    await recruitOperation.upgrade(new Map(), async () => client, 'create')

    expect(await applicantCategories(client)).toEqual(
      toFindResult([
        expect.objectContaining({
          _id: expect.any(String),
          space: core.space.Workspace,
          icon: tags.icon.Tags,
          label: 'Other',
          targetClass: recruit.class.Applicant,
          tags: [],
          default: true
        })
      ])
    )
    expect(await client.findAll(tags.class.TagCategory, { targetClass: recruit.mixin.Candidate })).toEqual(
      toFindResult([
        expect.objectContaining({ _id: recruit.category.Other, targetClass: recruit.mixin.Candidate, default: true })
      ])
    )
  })

  it('backfills the default when the existing recruiting defaults have already run', async () => {
    const { client } = createClient()
    const state = new Map([[recruitId, new Set(['create-defaults-v2'])]])

    await recruitOperation.upgrade(state, async () => client, 'upgrade')

    expect(await applicantCategories(client)).toEqual(
      toFindResult([expect.objectContaining({ targetClass: recruit.class.Applicant, default: true, tags: [] })])
    )
    expect(
      await client.findAll(core.class.MigrationState, {
        plugin: recruitId,
        state: 'create-default-applicant-label-category'
      })
    ).toHaveLength(1)
  })

  it('does not duplicate the category when an incomplete upgrade is retried', async () => {
    const { client, tx } = createClient()
    const state = new Map([[recruitId, new Set(['create-defaults-v2'])]])

    await recruitOperation.upgrade(state, async () => client, 'upgrade')
    await recruitOperation.upgrade(state, async () => client, 'upgrade')

    expect(await applicantCategories(client)).toHaveLength(1)
    const categoryWrites = tx.mock.calls.filter(
      ([transaction]) => (transaction as TxCreateDoc<Doc>).objectClass === tags.class.TagCategory
    )
    expect(categoryWrites).toHaveLength(1)
  })

  it('skips the backfill after its migration state is recorded', async () => {
    const { client, tx } = createClient()
    const state = new Map([[recruitId, new Set(['create-defaults-v2', 'create-default-applicant-label-category'])]])
    const getClient = jest.fn(async () => client)

    await recruitOperation.upgrade(state, getClient, 'upgrade')

    expect(getClient).not.toHaveBeenCalled()
    expect(tx).not.toHaveBeenCalled()
  })
})
