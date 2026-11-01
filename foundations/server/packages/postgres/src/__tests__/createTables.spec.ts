import { type MeasureContext } from '@hcengineering/core'
import type postgres from 'postgres'
import { addSchema, domainSchemas, getSchema, translateDomain, type Schema } from '../schemas'
import { createTables } from '../utils'
import type * as schemas from '../schemas'
import type * as utils from '../utils'

function createCtx (errors: any[] = []): MeasureContext {
  return {
    with: async (_name: string, _params: any, op: any) => await op(),
    error: (message: string, params: any) => errors.push({ message, ...params })
  } as unknown as MeasureContext
}

interface MockDb {
  tables?: string[]
  // table -> existing columns
  columns?: Record<string, string[]>
  // existing indexes
  indexes?: Array<{ table_name: string, index_name: string, valid: boolean }>
  failOn?: string
}

// Like postgres.js, DDL resolves with count === null.
function createMockClient (db: MockDb | string[] = {}): {
  client: postgres.Sql
  queries: string[]
  txQueries: string[]
} {
  const { tables = [], columns = {}, indexes = [], failOn } = Array.isArray(db) ? { tables: db } : db
  const queries: string[] = []
  const txQueries: string[] = []
  const make = (inTx: boolean): any => ({
    unsafe: jest.fn(async (query: string) => {
      queries.push(query)
      if (inTx) txQueries.push(query)
      if (failOn !== undefined && query.includes(failOn)) {
        throw new Error('boom')
      }
      if (query.includes('information_schema.tables')) {
        return Object.assign(
          tables.map((name) => ({ table_name: name })),
          { count: tables.length }
        )
      }
      if (query.includes('information_schema.columns')) {
        const rows = Object.entries(columns).flatMap(([table, cols]) =>
          cols.map((c) => ({ column_name: c, data_type: 'text', is_nullable: 'YES', table_name: table }))
        )
        return Object.assign(rows, { count: rows.length })
      }
      if (query.includes('pg_index')) {
        return Object.assign([...indexes], { count: indexes.length })
      }
      return Object.assign([], { count: null })
    })
  })
  const client = make(false)
  client.begin = async (op: (tx: any) => Promise<any>) => await op(make(true))
  return { client: client as postgres.Sql, queries, txQueries }
}

const indexQueries = (queries: string[]): string[] =>
  queries.filter((q) => q.includes('CREATE INDEX')).map((q) => q.replace(/\s+/g, ' ').trim())

describe('createTables - index creation', () => {
  // Module-level caches are keyed by url + domain, so each test needs its own.
  let seq = 0
  const uniq = (): { url: string, domain: string } => {
    seq++
    return { url: `postgresql://test/${seq}`, domain: `idx_test_${seq}` }
  }

  it('creates indexes for columns with index: true even though DDL count is null', async () => {
    const { url, domain } = uniq()
    const schema: Schema = {
      _id: { type: 'text', notNull: true, index: false },
      space: { type: 'text', notNull: true, index: true },
      _class: { type: 'text', notNull: true, index: true },
      note: { type: 'text', notNull: false, index: false }
    }
    addSchema(domain, schema)
    const { client, queries } = createMockClient()

    await createTables(createCtx(), client, url, [domain])

    expect(queries.some((q) => q.includes(`CREATE TABLE IF NOT EXISTS ${domain}`))).toBe(true)
    expect(indexQueries(queries)).toEqual([
      `CREATE INDEX IF NOT EXISTS ${domain}_space_idx ON ${domain} ("space")`,
      `CREATE INDEX IF NOT EXISTS ${domain}__class_idx ON ${domain} ("_class")`
    ])
  })

  it('creates indexes after the table and honours indexType', async () => {
    const { url, domain } = uniq()
    addSchema(domain, {
      _id: { type: 'text', notNull: true, index: false },
      refs: { type: 'text[]', notNull: false, index: true, indexType: 'gin' }
    })
    const { client, queries } = createMockClient()

    await createTables(createCtx(), client, url, [domain])

    const tableIdx = queries.findIndex((q) => q.includes('CREATE TABLE'))
    const indexIdx = queries.findIndex((q) => q.includes('CREATE INDEX'))
    expect(tableIdx).toBeGreaterThanOrEqual(0)
    expect(indexIdx).toBeGreaterThan(tableIdx)
    expect(indexQueries(queries)).toEqual([
      `CREATE INDEX IF NOT EXISTS ${domain}_refs_idx ON ${domain} USING gin ("refs")`
    ])
  })

  it('does not create indexes when no column is indexed', async () => {
    const { url, domain } = uniq()
    addSchema(domain, { _id: { type: 'text', notNull: true, index: false } })
    const { client, queries } = createMockClient()

    await createTables(createCtx(), client, url, [domain])

    expect(queries.some((q) => q.includes('CREATE TABLE'))).toBe(true)
    expect(indexQueries(queries)).toEqual([])
  })

  it('generates index names that are unique, within the identifier limit and never clash with table names', async () => {
    const domains = Object.keys(domainSchemas)
    const tables = new Set(domains.map((d) => translateDomain(d)))
    const names: string[] = []
    for (const domain of domains) {
      const { client, queries } = createMockClient()
      await createTables(createCtx(), client, `postgresql://test/real/${domain}`, [domain])
      for (const q of indexQueries(queries)) {
        const match = /CREATE INDEX IF NOT EXISTS (\S+) ON/.exec(q)
        expect(match).not.toBeNull()
        names.push(match?.[1].toLowerCase() as string)
      }
    }
    expect(names.length).toBeGreaterThan(0)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(63)
      expect(tables.has(name)).toBe(false)
    }
  })

  it('declares a GIN index for event.participants (array columns need an inverted index on CockroachDB)', () => {
    expect(getSchema('event').participants).toMatchObject({ type: 'text[]', index: true, indexType: 'gin' })
  })
})

describe('createTables - existing tables', () => {
  // `loadedTables` is cached per process after the first lookup, so each test gets fresh modules.
  let addSchema: typeof schemas.addSchema
  let getSchema: typeof schemas.getSchema
  let createTables: typeof utils.createTables
  beforeEach(() => {
    jest.isolateModules(() => {
      ;({ addSchema, getSchema } = require('../schemas'))
      ;({ createTables } = require('../utils'))
    })
  })

  let seq = 0
  const uniq = (): { url: string, domain: string } => {
    seq++
    return { url: `postgresql://existing/${seq}`, domain: `idx_existing_${seq}` }
  }
  const declare = (domain: string): void => {
    addSchema(domain, {
      _id: { type: 'text', notNull: true, index: false },
      space: { type: 'text', notNull: true, index: true },
      refs: { type: 'text[]', notNull: false, index: true, indexType: 'gin' },
      // declared but not present in the existing table
      missing: { type: 'text', notNull: false, index: true }
    })
  }

  it('creates missing declared indexes concurrently, outside the transaction', async () => {
    const { url, domain } = uniq()
    declare(domain)
    const { client, queries, txQueries } = createMockClient({
      tables: [domain],
      columns: { [domain]: ['_id', 'space', 'refs'] }
    })

    await createTables(createCtx(), client, url, [domain])

    expect(queries.some((q) => q.includes('CREATE TABLE'))).toBe(false)
    expect(indexQueries(txQueries)).toEqual([])
    expect(indexQueries(queries)).toEqual([
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${domain}_space_idx ON ${domain} ("space")`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${domain}_refs_idx ON ${domain} USING gin ("refs")`
    ])
    // the introspected schema keeps the declared index info
    expect(getSchema(domain).refs).toMatchObject({ index: true, indexType: 'gin' })
  })

  it('does nothing on a repeated startup when the indexes already exist', async () => {
    const { url, domain } = uniq()
    declare(domain)
    const db: MockDb = {
      tables: [domain],
      columns: { [domain]: ['_id', 'space', 'refs'] },
      indexes: [
        { table_name: domain, index_name: `${domain}_space_idx`, valid: true },
        { table_name: domain, index_name: `${domain}_refs_idx`, valid: true }
      ]
    }
    const first = createMockClient(db)
    await createTables(createCtx(), first.client, url, [domain])
    expect(indexQueries(first.queries)).toEqual([])

    // a second process (new url cache) after the schema was already replaced by the introspected one
    const second = createMockClient(db)
    await createTables(createCtx(), second.client, url + '/2', [domain])
    expect(indexQueries(second.queries)).toEqual([])
  })

  it('recreates an invalid index left by a failed concurrent build', async () => {
    const { url, domain } = uniq()
    declare(domain)
    const { client, queries } = createMockClient({
      tables: [domain],
      columns: { [domain]: ['_id', 'space'] },
      indexes: [{ table_name: domain, index_name: `${domain}_space_idx`, valid: false }]
    })

    await createTables(createCtx(), client, url, [domain])

    const ddl = queries.filter((q) => q.includes('INDEX')).filter((q) => !q.includes('pg_index'))
    expect(ddl).toEqual([
      `DROP INDEX CONCURRENTLY IF EXISTS ${domain}_space_idx`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${domain}_space_idx ON ${domain} ("space")`
    ])
  })

  it('logs and continues when an index build fails', async () => {
    const { url, domain } = uniq()
    declare(domain)
    const errors: any[] = []
    const { client, queries } = createMockClient({
      tables: [domain],
      columns: { [domain]: ['_id', 'space', 'refs'] },
      failOn: `${domain}_space_idx`
    })

    await expect(createTables(createCtx(errors), client, url, [domain])).resolves.toBeUndefined()

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ domain, key: 'space' })
    expect(indexQueries(queries).some((q) => q.includes(`${domain}_refs_idx`))).toBe(true)
  })
})
