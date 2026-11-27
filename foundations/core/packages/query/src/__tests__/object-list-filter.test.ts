// SPDX-License-Identifier: EPL-2.0

import core, {
  type Class,
  createClient,
  type Doc,
  type Ref,
  SortingOrder,
  type Space,
  TxOperations
} from '@hcengineering/core'
import { LiveQuery } from '..'
import { connect } from './connection'

// Lists of { _id, _class } links, like an issue's "blocked by" or "related to", filtered with $in / $all.
// Every query below gets its own copies of the links, as a filter read back from storage would.
const link = (id: string): { _id: Ref<Doc>, _class: Ref<Class<Doc>> } => ({
  _id: id as Ref<Doc>,
  _class: 'class:Linked' as Ref<Class<Doc>>
})

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

async function settle (): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('LiveQuery - $in / $all over a list of links', () => {
  it('adds and removes documents as their links change', async () => {
    const { liveQuery, factory, close } = await getClient()

    const create = async (name: string, links: any[]): Promise<Ref<Space>> =>
      await factory.createDoc(core.class.Space, core.space.Model, {
        name,
        description: '',
        private: false,
        members: [],
        archived: false,
        links
      } as any)

    const s1 = await create('s1', [link('a'), link('b')])
    const s2 = await create('s2', [link('a')])
    await create('s3', [link('c')])

    let allNames: string[] = []
    let anyNames: string[] = []
    liveQuery.query(core.class.Space, { links: { $all: [link('a'), link('b')] } }, (res) => {
      allNames = res.map((it) => it.name).sort((a, b) => a.localeCompare(b))
    })
    liveQuery.query(core.class.Space, { links: { $in: [link('b'), link('c')] } }, (res) => {
      anyNames = res.map((it) => it.name).sort((a, b) => a.localeCompare(b))
    })
    await settle()
    expect(allNames).toEqual(['s1'])
    expect(anyNames).toEqual(['s1', 's3'])

    // s2 gains link b: it now holds both a and b, and one of b / c.
    await factory.updateDoc(core.class.Space, core.space.Model, s2, { $push: { links: link('b') } } as any)
    await settle()
    expect(allNames).toEqual(['s1', 's2'])
    expect(anyNames).toEqual(['s1', 's2', 's3'])

    // s1 loses link a, the way the tracker removes a link (by _id only).
    await factory.updateDoc(core.class.Space, core.space.Model, s1, { $pull: { links: { _id: 'a' } } } as any)
    await settle()
    expect(allNames).toEqual(['s2'])
    expect(anyNames).toEqual(['s1', 's2', 's3'])

    // s1 loses its last link and leaves the $in result.
    await factory.updateDoc(core.class.Space, core.space.Model, s1, { $pull: { links: { _id: 'b' } } } as any)
    await settle()
    expect(anyNames).toEqual(['s2', 's3'])

    await close()
  })

  it('keeps the sort order when a document enters the result', async () => {
    const { liveQuery, factory, close } = await getClient()

    const create = async (name: string, links: any[]): Promise<Ref<Space>> =>
      await factory.createDoc(core.class.Space, core.space.Model, {
        name,
        description: '',
        private: false,
        members: [],
        archived: false,
        links
      } as any)

    await create('Zulu', [link('a')])
    await create('Mike', [link('a')])
    const alpha = await create('Alpha', [])

    // Results in callback order, not sorted again by the test.
    const results = new Map<number | undefined, string[]>()
    for (const limit of [undefined, 3, 2]) {
      liveQuery.query(
        core.class.Space,
        { links: { $in: [link('a')] } },
        (res) => {
          results.set(
            limit,
            res.map((it) => it.name)
          )
        },
        { sort: { name: SortingOrder.Ascending }, ...(limit !== undefined ? { limit } : {}) }
      )
    }
    await settle()
    expect(results.get(undefined)).toEqual(['Mike', 'Zulu'])
    expect(results.get(3)).toEqual(['Mike', 'Zulu'])
    expect(results.get(2)).toEqual(['Mike', 'Zulu'])

    // Only the links change, not the sort key: Alpha must still come first.
    await factory.updateDoc(core.class.Space, core.space.Model, alpha, { $push: { links: link('a') } } as any)
    await settle()
    expect(results.get(undefined)).toEqual(['Alpha', 'Mike', 'Zulu'])
    expect(results.get(3)).toEqual(['Alpha', 'Mike', 'Zulu'])
    expect(results.get(2)).toEqual(['Alpha', 'Mike'])

    await close()
  })
})
