// SPDX-License-Identifier: EPL-2.0

import { MeasureMetricsContext } from '@hcengineering/core'
import type postgres from 'postgres'
import { createTables } from '../utils'

const ctx = new MeasureMetricsContext('table-cache-unit', {})

function connection (tables: string[]): { client: postgres.Sql, unsafe: jest.Mock } {
  const unsafe = jest.fn(async (query: string) =>
    Object.assign(
      query.includes('information_schema') && query.includes('tables')
        ? tables.map((table) => ({ table_name: table }))
        : [],
      { count: 0 }
    )
  )
  const client = {
    unsafe,
    begin: async (work: (client: unknown) => Promise<void>) => {
      await work(client)
    }
  }
  return { client: client as unknown as postgres.Sql, unsafe }
}

it('does not treat tables from another database as existing', async () => {
  const first = connection(['model_tx'])
  const second = connection([])
  await createTables(ctx, first.client, 'database-a', ['model-tx'])
  await createTables(ctx, second.client, 'database-b', ['model-tx'])
  expect(second.unsafe).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS'))
})

it('does not carry initialized domains into a new connection with the same URL', async () => {
  const first = connection(['model_tx'])
  const second = connection([])
  await createTables(ctx, first.client, 'recreated-database', ['model-tx'])
  await createTables(ctx, second.client, 'recreated-database', ['model-tx'])
  expect(second.unsafe).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS'))
})

it('reuses initialized domains on the same connection', async () => {
  const { client, unsafe } = connection([])
  await createTables(ctx, client, 'same-database', ['model-tx'])
  unsafe.mockClear()
  await createTables(ctx, client, 'same-database', ['model-tx'])
  expect(unsafe).not.toHaveBeenCalled()
})
