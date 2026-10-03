//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { archivedQuery, archiveUpdate, isIssueArchived, restoreUpdate } from '../archive'

describe('archive', () => {
  it('treats only a timestamp as archived', () => {
    expect(isIssueArchived({})).toBe(false)
    expect(isIssueArchived({ archivedAt: null })).toBe(false)
    expect(isIssueArchived({ archivedAt: 1 })).toBe(true)
  })

  it('archives with a timestamp and restores with null', () => {
    expect(archiveUpdate(42)).toEqual({ archivedAt: 42 })
    expect(archiveUpdate().archivedAt).toBeGreaterThan(0)
    expect(restoreUpdate()).toEqual({ archivedAt: null })
    expect(isIssueArchived(restoreUpdate())).toBe(false)
  })

  it('builds the queries for archived and active issues', () => {
    expect(archivedQuery(true)).toEqual({ archivedAt: { $ne: null } })
    expect(archivedQuery(false)).toEqual({ archivedAt: null })
  })
})
