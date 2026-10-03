//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import core, { TxFactory } from '@hcengineering/core'

// A small TriggerControl for the trigger tests. `findAll` understands the query operators the triggers use (equality,
// null, $in, $nin, $ne, comparisons), sorting, limits and projections, so a test can see a wrong query or a missing
// property in a projection.

function valueMatches (value: any, selector: any): boolean {
  if (selector !== null && typeof selector === 'object' && !Array.isArray(selector)) {
    for (const [op, arg] of Object.entries<any>(selector)) {
      switch (op) {
        case '$in':
          if (!arg.includes(value ?? null) && !arg.includes(value)) return false
          break
        case '$nin':
          if (arg.includes(value ?? null) || arg.includes(value)) return false
          break
        case '$ne':
          if ((arg === null && (value === null || value === undefined)) || value === arg) return false
          break
        case '$gt':
          if (!(typeof value === 'number' && value > arg)) return false
          break
        case '$gte':
          if (!(typeof value === 'number' && value >= arg)) return false
          break
        case '$lt':
          if (!(typeof value === 'number' && value < arg)) return false
          break
        case '$lte':
          if (!(typeof value === 'number' && value <= arg)) return false
          break
        case '$like':
          return true
        default:
          throw new Error(`mock findAll: unsupported operator ${op}`)
      }
    }
    return true
  }
  if (selector === null) return value === null || value === undefined
  return value === selector
}

export function matchesQuery (doc: any, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, selector]) => {
    if (key.startsWith('$')) return true
    return valueMatches(doc[key], selector)
  })
}

export interface MockOptions {
  docs: Record<string, any[]>
  system?: boolean
  cache?: Map<string, any>
  txes?: any[]
  // Calls of findAll, for assertions
  calls?: Array<{ _class: string, query: any, options: any }>
}

export function makeControl (options: MockOptions): any {
  const { docs } = options
  return {
    ctx: {
      info: () => {},
      warn: () => {},
      error: () => {}
    },
    workspace: { url: 'ws-url', uuid: 'ws-uuid' },
    branding: { front: 'https://huly.example.com' },
    cache: options.cache ?? new Map<string, any>(),
    txes: options.txes ?? [],
    removedMap: new Map(),
    hierarchy: {
      isDerived: (a: string, b: string) => a === b,
      getClass: () => ({}),
      findClass: () => ({})
    },
    txFactory: new TxFactory(core.account.System, true),
    findAll: async (_ctx: unknown, _class: string, query: any = {}, findOptions: any = {}) => {
      options.calls?.push({ _class, query, options: findOptions })
      let found = (docs[_class] ?? []).filter((d) => matchesQuery(d, query))
      const sort = findOptions.sort as Record<string, 1 | -1> | undefined
      if (sort !== undefined) {
        const [[key, dir]] = Object.entries(sort)
        found = [...found].sort((a, b) => ((a[key] ?? 0) - (b[key] ?? 0)) * (dir as number))
      }
      const total = found.length
      if (typeof findOptions.limit === 'number') found = found.slice(0, findOptions.limit)
      const projection = findOptions.projection as Record<string, 1> | undefined
      if (projection !== undefined) {
        found = found.map((d) => {
          const out: any = {}
          for (const key of Object.keys(projection)) if (key in d) out[key] = d[key]
          return out
        })
      }
      // Like the real findAll, `total` is the number of matches before the limit
      if (findOptions.total === true) (found as any).total = total
      return found
    }
  }
}
