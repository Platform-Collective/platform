//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { MAX_ARCHIVE_BATCH, selectArchiveTargets, setArchived } from '../apply'

const doc = (id: string, archivedAt?: number | null): any => ({ _id: id, archivedAt })

describe('selectArchiveTargets', () => {
  it('takes the issues that are not archived when archiving, the archived ones when restoring', () => {
    const issues = [doc('a'), doc('b', 5), doc('c', null), doc('d', 7)]
    expect(selectArchiveTargets(issues, true).map((i) => i._id)).toEqual(['a', 'c'])
    expect(selectArchiveTargets(issues, false).map((i) => i._id)).toEqual(['b', 'd'])
  })

  it('takes an issue once and is capped', () => {
    expect(selectArchiveTargets([doc('a'), doc('a')], true)).toHaveLength(1)
    const many = Array.from({ length: MAX_ARCHIVE_BATCH + 50 }, (_, i) => doc(`i${i}`))
    expect(selectArchiveTargets(many, true)).toHaveLength(MAX_ARCHIVE_BATCH)
  })
})

describe('setArchived', () => {
  function client (): { client: any, updates: any[], committed: () => boolean } {
    const updates: any[] = []
    let committed = false
    const ops = {
      update: async (d: any, u: any) => {
        updates.push([d._id, u])
      },
      commit: async () => {
        committed = true
      }
    }
    return { client: { apply: () => ops }, updates, committed: () => committed }
  }

  it('archives with one timestamp in one batch, and skips what is archived already', async () => {
    const c = client()
    await setArchived(c.client, [doc('a'), doc('b'), doc('c', 5)], true)
    expect(c.updates.map((u) => u[0])).toEqual(['a', 'b'])
    expect(c.updates[0][1].archivedAt).toBeGreaterThan(0)
    expect(c.updates[0][1].archivedAt).toBe(c.updates[1][1].archivedAt)
    expect(c.committed()).toBe(true)
  })

  it('restores with null and writes nothing when there is nothing to restore', async () => {
    const c = client()
    await setArchived(c.client, [doc('a', 5)], false)
    expect(c.updates).toEqual([['a', { archivedAt: null }]])
    const none = client()
    await setArchived(none.client, [doc('a')], false)
    expect(none.updates).toEqual([])
    expect(none.committed()).toBe(false)
  })
})
