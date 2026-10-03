//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { buildWorkflowFilterSchema, WorkflowKind } from '@hcengineering/tracker'

import { compileWorkflowPreview, countPreviewMatches } from '../preview'

const NOW = new Date(2026, 5, 17, 12).getTime()
const DAY = 24 * 60 * 60 * 1000

const schema = buildWorkflowFilterSchema({
  statuses: [
    { id: 'st-todo', name: 'Todo' },
    { id: 'st-done', name: 'Done' }
  ],
  assignees: [],
  components: [],
  milestones: [],
  customFields: [],
  noParentId: 'no-parent'
})
const ctx = { now: NOW, closedStatuses: new Set(['st-done']), noParentId: 'no-parent' }

describe('compileWorkflowPreview', () => {
  it('scans the active items for auto-archive and the archived ones for auto-add', () => {
    const archive = compileWorkflowPreview(WorkflowKind.AutoArchive, 'is:closed', schema, ctx)
    expect(archive.ok && archive.query).toMatchObject({ archivedAt: null })
    const add = compileWorkflowPreview(WorkflowKind.AutoAddFromQuery, 'is:closed', schema, ctx)
    expect(add.ok && add.query).toMatchObject({ archivedAt: { $ne: null } })
  })

  it('reports an empty or invalid filter', () => {
    expect(compileWorkflowPreview(WorkflowKind.AutoArchive, '   ', schema, ctx)).toEqual({ ok: false, reason: 'empty' })
    expect(compileWorkflowPreview(WorkflowKind.AutoArchive, 'nope:1', schema, ctx)).toEqual({ ok: false, reason: 'invalid' })
    expect(compileWorkflowPreview(WorkflowKind.AutoArchive, '(is:closed', schema, ctx)).toEqual({ ok: false, reason: 'invalid' })
    // Labels are not available to workflows
    expect(compileWorkflowPreview(WorkflowKind.AutoArchive, 'label:bug', schema, ctx)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('does not accept archived items in an auto-archive filter', () => {
    expect(compileWorkflowPreview(WorkflowKind.AutoArchive, 'is:archived', schema, ctx)).toEqual({ ok: false, reason: 'invalid' })
    expect(compileWorkflowPreview(WorkflowKind.AutoAddFromQuery, 'is:archived', schema, ctx).ok).toBe(true)
  })

  it('counts what the filter matches, and tells when the scan was cut', () => {
    const compiled = compileWorkflowPreview(WorkflowKind.AutoArchive, 'is:closed updated:<@today-2w', schema, ctx)
    if (compiled.ok === false) throw new Error('compile')
    const docs = [
      { _id: 'a', status: 'st-done', modifiedOn: NOW - 30 * DAY },
      { _id: 'b', status: 'st-done', modifiedOn: NOW - DAY },
      { _id: 'c', status: 'st-todo', modifiedOn: NOW - 30 * DAY }
    ]
    expect(countPreviewMatches(compiled, docs, 100)).toEqual({ count: 1, over: false })
    expect(countPreviewMatches(compiled, docs, 3)).toEqual({ count: 1, over: true })
    expect(compiled.projection).toEqual(expect.arrayContaining(['status', 'modifiedOn']))
  })
})
