// SPDX-License-Identifier: EPL-2.0

import { randomUUID } from 'node:crypto'
import { MeasureMetricsContext } from '@hcengineering/core'
import postgres from 'postgres'
import { createTables } from '../utils'

// Run against either PostgreSQL or CockroachDB with an administrative DB_URL.
describe('table cache database isolation (real database)', () => {
  const ctx = new MeasureMetricsContext('table-cache', {})
  const baseUri = process.env.DB_URL ?? 'postgresql://root@localhost:26258/defaultdb?sslmode=disable'
  const admin = postgres(baseUri, { max: 1, onnotice: () => {} })
  const clients: postgres.Sql[] = []
  const databases: string[] = []

  async function connect (name: string): Promise<{ client: postgres.Sql, url: string }> {
    const uri = new URL(baseUri)
    uri.pathname = '/' + name
    const url = uri.toString()
    const client = postgres(url, { max: 1, onnotice: () => {} })
    clients.push(client)
    return { client, url }
  }

  async function database (): Promise<{ client: postgres.Sql, url: string }> {
    const name = 'rctest_cache_' + randomUUID().replaceAll('-', '')
    await admin`CREATE DATABASE ${admin(name)}`
    databases.push(name)
    return await connect(name)
  }

  afterAll(async () => {
    try {
      await Promise.all(clients.map(async (client) => { await client.end({ timeout: 1 }) }))
      // All test connections are closed, so plain DROP works on both engines.
      for (const name of databases) await admin`DROP DATABASE IF EXISTS ${admin(name)}`
    } finally {
      await admin.end({ timeout: 1 })
    }
  })

  it('creates model_tx in a second database after loading tables from the first', async () => {
    const first = await database()
    const second = await database()
    await createTables(ctx, first.client, first.url, ['model-tx'])
    // The old cache reloads after an empty snapshot and now sees model_tx in A.
    await createTables(ctx, first.client, first.url, ['space'])
    await createTables(ctx, second.client, second.url, ['model-tx'])

    await expect(second.client`SELECT * FROM model_tx LIMIT 0`).resolves.toHaveLength(0)
    // Repeated initialization on the same connection remains safe.
    await createTables(ctx, second.client, second.url, ['model-tx', 'space'])
    await expect(second.client`SELECT * FROM space LIMIT 0`).resolves.toHaveLength(0)
  })

  it('does not reuse initialized domains after reconnecting to a recreated database URL', async () => {
    const first = await database()
    await createTables(ctx, first.client, first.url, ['model-tx'])
    await first.client.end({ timeout: 1 })
    const name = new URL(first.url).pathname.slice(1)
    await admin`DROP DATABASE ${admin(name)}`
    await admin`CREATE DATABASE ${admin(name)}`
    const second = await connect(name)
    await createTables(ctx, second.client, second.url, ['model-tx'])

    await expect(second.client`SELECT * FROM model_tx LIMIT 0`).resolves.toHaveLength(0)
  })
})
