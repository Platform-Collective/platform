/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import {
  createRestClient,
  createRestTxOperations,
  getWorkspaceToken,
  loadServerConfig,
  type RestClient,
  type ServerConfig,
  type WorkspaceToken
} from '@hcengineering/api-client'
import { getClient as getAccountClient, type AccountClient } from '@hcengineering/account-client'
import chunter, { type Channel } from '@hcengineering/chunter'
import core, {
  AccountRole,
  generateId,
  SortingOrder,
  systemAccountUuid,
  type Ref,
  type TxOperations,
  type WithLookup
} from '@hcengineering/core'
import { generateToken } from '@hcengineering/server-token'

interface CollectedPages {
  docs: Array<WithLookup<Channel>>
  pageCount: number
  totals: number[]
}

describe('cursor-api', () => {
  const frontUrl = process.env.FRONT_URL ?? 'http://huly.local:8083'
  const workspaceName = 'api-tests'
  const runId = generateId()
  const prefix = `cursor-${runId}`
  const largeCount = 127

  let config: ServerConfig
  let ownerWorkspace: WorkspaceToken
  let readerWorkspace: WorkspaceToken
  let ownerClient: RestClient
  let readerClient: RestClient
  let fixtureClient: RestClient
  let txOperations: TxOperations
  const createdChannels: Array<Ref<Channel>> = []
  const publicChannels: Array<Ref<Channel>> = []
  const privateChannels: Array<Ref<Channel>> = []

  beforeAll(async () => {
    config = await loadServerConfig(frontUrl)
    ownerWorkspace = await getWorkspaceToken(
      frontUrl,
      {
        email: 'user1',
        password: '1234',
        workspace: workspaceName
      },
      config
    )

    try {
      readerWorkspace = await getWorkspaceToken(
        frontUrl,
        {
          email: 'user2',
          password: '1234',
          workspace: workspaceName
        },
        config
      )
    } catch {
      const adminClient: AccountClient = getAccountClient(
        config.ACCOUNTS_URL,
        generateToken(systemAccountUuid, undefined, { service: 'workspace', admin: 'true' }, 'secret')
      )
      await adminClient.assignWorkspace('user2', ownerWorkspace.workspaceId, AccountRole.User)
      readerWorkspace = await getWorkspaceToken(
        frontUrl,
        {
          email: 'user2',
          password: '1234',
          workspace: workspaceName
        },
        config
      )
    }

    ownerClient = createRestClient(ownerWorkspace.endpoint, ownerWorkspace.workspaceId, ownerWorkspace.token)
    readerClient = createRestClient(readerWorkspace.endpoint, readerWorkspace.workspaceId, readerWorkspace.token)
    fixtureClient = createRestClient(
      ownerWorkspace.endpoint,
      ownerWorkspace.workspaceId,
      generateToken(systemAccountUuid, ownerWorkspace.workspaceId, undefined, 'secret')
    )
    txOperations = await createRestTxOperations(
      ownerWorkspace.endpoint,
      ownerWorkspace.workspaceId,
      ownerWorkspace.token
    )

    for (let start = 0; start < largeCount; start += 20) {
      const end = Math.min(start + 20, largeCount)
      await Promise.all(
        Array.from({ length: end - start }, async (_, offset) => {
          const index = start + offset
          const isPrivate = index % 4 === 0
          // autoJoin is not a column of the space domain, it is kept in JSONB and extracted as text,
          // so it covers cursors over a custom boolean field.
          const autoJoin = index % 3 === 0
          const id = await fixtureClient.createDoc(chunter.class.Channel, core.space.Space, {
            name: `${prefix}-${index.toString().padStart(3, '0')}`,
            description: '',
            private: isPrivate,
            archived: false,
            members: isPrivate ? [ownerWorkspace.info.account] : [],
            autoJoin
          })
          createdChannels.push(id)
          if (isPrivate) {
            privateChannels.push(id)
          } else {
            publicChannels.push(id)
          }
        })
      )
    }
  }, 120000)

  afterAll(async () => {
    if (fixtureClient === undefined) {
      return
    }
    for (let start = 0; start < createdChannels.length; start += 20) {
      const ids = createdChannels.slice(start, start + 20)
      const docs = await fixtureClient.findAll(chunter.class.Channel, { _id: { $in: ids } })
      await Promise.all(docs.map(async (doc) => await fixtureClient.remove(doc)))
    }
  }, 120000)

  it('reads a large result without gaps or duplicates', async () => {
    const { docs, pageCount, totals } = await collectPages(ownerClient, prefix, 17, true)
    const ids = docs.map(({ _id }) => _id)

    expect(pageCount).toBe(8)
    expect(totals).toEqual(Array.from({ length: pageCount }, () => largeCount))
    expect(ids).toHaveLength(largeCount)
    expect(new Set(ids).size).toBe(largeCount)
    expect(new Set(ids)).toEqual(new Set(createdChannels))
    expect(docs.map(({ name }) => name)).toEqual([...docs.map(({ name }) => name)].sort())
  })

  it('uses _id as a stable tie breaker for duplicate sort values', async () => {
    const docs: Array<WithLookup<Channel>> = []
    let cursor: string | undefined
    do {
      const page = await ownerClient.findAllPage(
        chunter.class.Channel,
        { name: { $like: `${prefix}%` } },
        {
          limit: 11,
          cursor,
          sort: { topic: SortingOrder.Ascending }
        }
      )
      docs.push(...page.docs)
      cursor = page.nextCursor
    } while (cursor !== undefined)

    expect(docs).toHaveLength(largeCount)
    expect(new Set(docs.map(({ _id }) => _id))).toEqual(new Set(createdChannels))
  })

  it.each([
    { count: 0, limit: 10, pages: 1 },
    { count: 1, limit: 10, pages: 1 },
    { count: 3, limit: 10, pages: 1 },
    { count: 10, limit: 10, pages: 1 },
    { count: 11, limit: 10, pages: 2 }
  ])('handles a small result with $count documents', async ({ count, limit, pages }) => {
    const ids = createdChannels.slice(0, count)
    const result = await collectPagesByIds(ownerClient, ids, limit)

    expect(result.pageCount).toBe(pages)
    expect(result.docs.map(({ _id }) => _id)).toHaveLength(count)
    expect(new Set(result.docs.map(({ _id }) => _id))).toEqual(new Set(ids))
  })

  it('does not expose private spaces while traversing pages', async () => {
    const ownerResult = await collectPages(ownerClient, prefix, 9, true)
    const readerResult = await collectPages(readerClient, prefix, 9, true)
    const readerIds = new Set(readerResult.docs.map(({ _id }) => _id))

    expect(new Set(ownerResult.docs.map(({ _id }) => _id))).toEqual(new Set(createdChannels))
    expect(readerIds).toEqual(new Set(publicChannels))
    for (const privateId of privateChannels) {
      expect(readerIds.has(privateId)).toBe(false)
    }
    expect(readerResult.totals).toEqual(Array.from({ length: readerResult.pageCount }, () => publicChannels.length))
  })

  it('rejects a cursor issued for another account', async () => {
    const firstPage = await ownerClient.findAllPage(
      chunter.class.Channel,
      { name: { $like: `${prefix}%` } },
      { limit: 7, sort: { name: SortingOrder.Ascending } }
    )

    expect(firstPage.nextCursor).toBeDefined()
    await expect(
      readerClient.findAllPage(
        chunter.class.Channel,
        { name: { $like: `${prefix}%` } },
        {
          limit: 7,
          sort: { name: SortingOrder.Ascending },
          cursor: firstPage.nextCursor
        }
      )
    ).rejects.toThrow()
  })

  it('rejects a cursor reused with another query', async () => {
    const firstPage = await ownerClient.findAllPage(
      chunter.class.Channel,
      { name: { $like: `${prefix}%` } },
      { limit: 7, sort: { name: SortingOrder.Ascending } }
    )

    expect(firstPage.nextCursor).toBeDefined()
    await expect(
      ownerClient.findAllPage(
        chunter.class.Channel,
        { _id: { $in: createdChannels.slice(0, 20) } },
        {
          limit: 7,
          sort: { name: SortingOrder.Ascending },
          cursor: firstPage.nextCursor
        }
      )
    ).rejects.toThrow()
  })

  it.each([SortingOrder.Ascending, SortingOrder.Descending])(
    'paginates over a boolean field kept in JSONB, order %i',
    async (order) => {
      const docs: Array<WithLookup<Channel>> = []
      let cursor: string | undefined
      do {
        const page = await ownerClient.findAllPage(
          chunter.class.Channel,
          { name: { $like: `${prefix}%` } },
          {
            limit: 10,
            cursor,
            sort: { autoJoin: order }
          }
        )
        docs.push(...page.docs)
        cursor = page.nextCursor
      } while (cursor !== undefined)

      expect(docs).toHaveLength(largeCount)
      expect(new Set(docs.map(({ _id }) => _id))).toEqual(new Set(createdChannels))

      const flags = docs.map(({ autoJoin }) => autoJoin === true)
      const expectedFlags = [...flags].sort((left, right) =>
        left === right ? 0 : (left ? 1 : -1) * (order === SortingOrder.Ascending ? 1 : -1)
      )
      expect(flags).toEqual(expectedFlags)
    }
  )

  it('paginates over a model domain class', async () => {
    // The model is served from memory and bypasses database adapters, so the cursor position has to be
    // applied by the pipeline itself, otherwise every page repeats the very first one.
    const ids: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await ownerClient.findAllPage(
        core.class.SpaceType,
        {},
        { limit: 1, cursor, sort: { name: SortingOrder.Ascending } }
      )
      ids.push(...page.docs.map(({ _id }) => _id))
      cursor = page.nextCursor
      pages++
      expect(pages).toBeLessThan(100)
    } while (cursor !== undefined)

    const all = await ownerClient.findAll(core.class.SpaceType, {})
    expect(new Set(ids)).toEqual(new Set(all.map(({ _id }) => _id)))
    expect(ids).toHaveLength(all.length)
  })

  it('rejects lookup based filters', async () => {
    await expect(
      ownerClient.findAllPage(chunter.class.Channel, { '$lookup.space._id': core.space.Space } as any, {
        limit: 7,
        sort: { name: SortingOrder.Ascending },
        lookup: { space: core.class.Space }
      })
    ).rejects.toThrow()
  })

  it('iterates over all pages', async () => {
    const docs: Array<WithLookup<Channel>> = []
    for await (const doc of txOperations.iterateAll(
      chunter.class.Channel,
      { name: { $like: `${prefix}%` } },
      { limit: 13, sort: { name: SortingOrder.Ascending } }
    )) {
      docs.push(doc)
    }

    expect(new Set(docs.map(({ _id }) => _id))).toEqual(new Set(createdChannels))
  })
})

async function collectPages (
  client: RestClient,
  prefix: string,
  limit: number,
  total: boolean
): Promise<CollectedPages> {
  const docs: Array<WithLookup<Channel>> = []
  const totals: number[] = []
  let cursor: string | undefined
  let pageCount = 0
  do {
    const page = await client.findAllPage(
      chunter.class.Channel,
      { name: { $like: `${prefix}%` } },
      {
        limit,
        cursor,
        total,
        sort: { name: SortingOrder.Ascending }
      }
    )
    expect(page.docs.length).toBeLessThanOrEqual(limit)
    if (page.nextCursor !== undefined) {
      expect(page.docs).toHaveLength(limit)
    }
    if (total) {
      expect(page.total).toBeGreaterThanOrEqual(page.docs.length)
      totals.push(page.total ?? -1)
    }
    docs.push(...page.docs)
    cursor = page.nextCursor
    pageCount++
  } while (cursor !== undefined)
  return { docs, pageCount, totals }
}

async function collectPagesByIds (client: RestClient, ids: Array<Ref<Channel>>, limit: number): Promise<CollectedPages> {
  const docs: Array<WithLookup<Channel>> = []
  let cursor: string | undefined
  let pageCount = 0
  do {
    const page = await client.findAllPage(
      chunter.class.Channel,
      { _id: { $in: ids } },
      {
        limit,
        cursor,
        sort: { name: SortingOrder.Ascending }
      }
    )
    docs.push(...page.docs)
    cursor = page.nextCursor
    pageCount++
  } while (cursor !== undefined)
  return { docs, pageCount, totals: [] }
}
