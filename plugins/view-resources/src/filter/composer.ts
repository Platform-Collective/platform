// Copyright © 2026 Hardcore Engineering Inc.
// Licensed under the Eclipse Public License, Version 2.0

import { Analytics } from '@hcengineering/analytics'
import { reduceCalls, type Doc, type DocumentQuery, type Hierarchy } from '@hcengineering/core'
import { type Filter } from '@hcengineering/view'
import { FilterQueryLifetime } from './lifecycle'
import { makeFilterQueryWithLifetime, type FilterModeResolver, type ResourceResolver } from './query-builder'

interface FilterQueryComposerOptions {
  resolveMode: FilterModeResolver
  resolveResource?: ResourceResolver
  hierarchy?: Hierarchy
  onChange: (query: DocumentQuery<Doc>) => void
  refresh: () => void
}

export function createFilterQueryComposer ({
  resolveMode,
  resolveResource,
  hierarchy,
  onChange,
  refresh
}: FilterQueryComposerOptions): (base: DocumentQuery<Doc>, filters: Filter[]) => Promise<void> {
  let queryRequest = 0
  const compose = reduceCalls(
    async (
      base: DocumentQuery<Doc>,
      filters: Filter[],
      lifetime: FilterQueryLifetime,
      request: number
    ): Promise<void> => {
      // reduceCalls consumes operation failures itself, so report them here
      // before its console-only error boundary. The queued next call can proceed.
      try {
        if (!lifetime.isActive() || request !== queryRequest) return
        // makeFilterQuery guards retained refresh callbacks by their own filter
        // generation. refresh must read current inputs, even after sibling removal.
        const next = await makeFilterQueryWithLifetime(
          base,
          filters,
          resolveMode,
          resolveResource,
          hierarchy,
          refresh,
          lifetime
        )
        if (next !== undefined && lifetime.isActive() && request === queryRequest) onChange(next)
      } catch (error) {
        Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
      }
    }
  )

  return async (base, filters): Promise<void> => {
    // Capture ownership before queueing. Index reuse cannot revive an old call,
    // and only the latest requested composition may dispatch.
    const lifetime = new FilterQueryLifetime(filters.map((filter) => filter.index))
    await compose(base, filters, lifetime, ++queryRequest)
  }
}
