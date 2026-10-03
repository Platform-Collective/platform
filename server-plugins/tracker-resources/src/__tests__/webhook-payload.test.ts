//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { createHmac } from 'crypto'
import { ProjectFieldType } from '@hcengineering/tracker'

import {
  boundValue,
  buildPayload,
  describeChange,
  diffIssue,
  MAX_PAYLOAD_BYTES,
  serializePayload,
  type ChangeLookups
} from '../webhook/payload'
import { SIGNATURE_HEADER, signPayload, verifySignature } from '../webhook/sign'

const lookups: ChangeLookups = {
  statuses: new Map([
    ['st-todo', 'Todo'],
    ['st-done', 'Done']
  ]),
  people: new Map([['p1', 'Alice']]),
  components: new Map([['c1', 'Backend']]),
  milestones: new Map([['m1', 'v1']]),
  iterations: new Map([['it1', 'Sprint 1']]),
  fields: new Map<string, any>([
    [
      'size',
      { key: 'size', label: 'Size', type: ProjectFieldType.SingleSelect, options: [{ value: 'o-s', label: 'S' }, { value: 'o-l', label: 'L' }] }
    ],
    [
      'areas',
      { key: 'areas', label: 'Areas', type: ProjectFieldType.MultiSelect, options: [{ value: 'a1', label: 'Frontend' }, { value: 'a2', label: 'Backend' }] }
    ],
    ['points', { key: 'points', label: 'Story points', type: ProjectFieldType.Number }],
    ['target', { key: 'target', label: 'Target', type: ProjectFieldType.Date }],
    ['sprint', { key: 'sprint', label: 'Sprint', type: ProjectFieldType.Iteration }],
    ['notes', { key: 'notes', label: 'Notes', type: ProjectFieldType.Text }]
  ])
}

describe('signature', () => {
  it('is sha256= and the hex HMAC SHA-256 of the body', () => {
    const body = '{"action":"edited"}'
    const expected = createHmac('sha256', 'topsecret').update(body).digest('hex')
    expect(signPayload('topsecret', body)).toBe(`sha256=${expected}`)
    expect(SIGNATURE_HEADER).toBe('X-Huly-Signature-256')
  })

  it('matches the reference vector of the GitHub scheme', () => {
    // From GitHub's documentation of X-Hub-Signature-256
    expect(signPayload("It's a Secret to Everybody", 'Hello, World!')).toBe(
      'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17'
    )
  })

  it('signs the exact bytes, so a changed body or secret changes it', () => {
    const base = signPayload('s', '{"a":1}')
    expect(signPayload('s', '{"a": 1}')).not.toBe(base)
    expect(signPayload('t', '{"a":1}')).not.toBe(base)
    expect(signPayload('s', '{"a":1}')).toBe(base)
  })

  it('handles non ASCII bodies as UTF-8', () => {
    const body = '{"title":"Привет ✓"}'
    expect(signPayload('s', body)).toBe(`sha256=${createHmac('sha256', 's').update(Buffer.from(body, 'utf8')).digest('hex')}`)
  })

  it('verifies in constant time and rejects malformed headers', () => {
    const header = signPayload('s', 'body')
    expect(verifySignature('s', 'body', header)).toBe(true)
    expect(verifySignature('s', 'body2', header)).toBe(false)
    expect(verifySignature('x', 'body', header)).toBe(false)
    expect(verifySignature('s', 'body', undefined)).toBe(false)
    expect(verifySignature('s', 'body', header.replace('sha256=', 'sha1='))).toBe(false)
    expect(verifySignature('s', 'body', header.slice(0, -2))).toBe(false)
  })
})

describe('diffIssue', () => {
  it('lists the watched attributes that changed, one change each', () => {
    const changes = diffIssue(
      { status: 'st-todo' as any, priority: 1, title: 'A', estimation: 2, description: 'x' as any },
      { status: 'st-done' as any, priority: 1, title: 'B', estimation: 2, description: 'y' as any }
    )
    expect(changes).toEqual([
      { fieldId: 'title', from: 'A', to: 'B' },
      { fieldId: 'status', from: 'st-todo', to: 'st-done' }
    ])
  })

  it('reports each custom field on its own and tells set and cleared values', () => {
    const changes = diffIssue(
      { customFields: { size: 'o-s', points: 3, keep: 1 } },
      { customFields: { size: 'o-l', keep: 1, notes: 'hi' } }
    )
    expect(changes).toEqual([
      { fieldId: 'customFields.notes', from: null, to: 'hi' },
      { fieldId: 'customFields.points', from: 3, to: null },
      { fieldId: 'customFields.size', from: 'o-s', to: 'o-l' }
    ])
  })

  it('treats null, undefined and equal arrays as unchanged', () => {
    expect(diffIssue({ component: null }, { component: undefined })).toEqual([])
    expect(diffIssue({ customFields: { areas: ['a1'] } }, { customFields: { areas: ['a1'] } })).toEqual([])
    expect(diffIssue({ customFields: { areas: ['a1'] } }, { customFields: { areas: ['a1', 'a2'] } })).toHaveLength(1)
  })

  it('has nothing to report for a state that is not known or a creation', () => {
    expect(diffIssue(undefined, undefined)).toEqual([])
    expect(diffIssue(undefined, { status: 'st-todo' as any })).toEqual([{ fieldId: 'status', from: null, to: 'st-todo' }])
  })
})

describe('describeChange', () => {
  it('names the value of select-like attributes', () => {
    expect(describeChange({ fieldId: 'status', from: 'st-todo', to: 'st-done' }, lookups)).toEqual({
      field_node_id: 'status',
      field_name: 'Status',
      field_type: 'status',
      from: { id: 'st-todo', name: 'Todo' },
      to: { id: 'st-done', name: 'Done' }
    })
    expect(describeChange({ fieldId: 'priority', from: 0, to: 1 }, lookups)).toMatchObject({
      from: { id: '0', name: 'No priority' },
      to: { id: '1', name: 'Urgent' }
    })
    expect(describeChange({ fieldId: 'assignee', from: null, to: 'p1' }, lookups)).toMatchObject({
      from: null,
      to: { id: 'p1', name: 'Alice' }
    })
    expect(describeChange({ fieldId: 'component', from: 'c1', to: null }, lookups)).toMatchObject({ from: { name: 'Backend' }, to: null })
    expect(describeChange({ fieldId: 'milestone', from: 'm1', to: 'unknown' }, lookups)).toMatchObject({ to: { id: 'unknown', name: null } })
  })

  it('writes dates as ISO strings and keeps numbers and text', () => {
    const day = Date.UTC(2026, 5, 17)
    expect(describeChange({ fieldId: 'dueDate', from: null, to: day }, lookups)).toMatchObject({
      field_name: 'Due date',
      field_type: 'date',
      from: null,
      to: '2026-06-17T00:00:00.000Z'
    })
    expect(describeChange({ fieldId: 'estimation', from: 1, to: 2 }, lookups)).toMatchObject({ field_type: 'number', from: 1, to: 2 })
    expect(describeChange({ fieldId: 'title', from: 'a', to: 'b' }, lookups)).toMatchObject({ field_type: 'text', to: 'b' })
  })

  it('describes custom fields by their type', () => {
    expect(describeChange({ fieldId: 'customFields.size', from: 'o-s', to: 'o-l' }, lookups)).toEqual({
      field_node_id: 'customFields.size',
      field_name: 'Size',
      field_type: 'single_select',
      from: { id: 'o-s', name: 'S' },
      to: { id: 'o-l', name: 'L' }
    })
    expect(describeChange({ fieldId: 'customFields.areas', from: ['a1'], to: ['a1', 'a2'] }, lookups)).toMatchObject({
      field_type: 'multi_select',
      to: [{ id: 'a1', name: 'Frontend' }, { id: 'a2', name: 'Backend' }]
    })
    expect(describeChange({ fieldId: 'customFields.sprint', from: null, to: 'it1' }, lookups)).toMatchObject({
      field_type: 'iteration',
      to: { id: 'it1', name: 'Sprint 1' }
    })
    expect(describeChange({ fieldId: 'customFields.target', from: null, to: Date.UTC(2026, 0, 1) }, lookups)).toMatchObject({
      field_type: 'date',
      to: '2026-01-01T00:00:00.000Z'
    })
    expect(describeChange({ fieldId: 'customFields.points', from: 1, to: 5 }, lookups)).toMatchObject({ field_type: 'number', to: 5 })
  })

  it('reports a removed custom field under its key', () => {
    expect(describeChange({ fieldId: 'customFields.gone', from: 'x', to: null }, lookups)).toEqual({
      field_node_id: 'customFields.gone',
      field_name: 'gone',
      field_type: 'unknown',
      from: 'x',
      to: null
    })
  })
})

describe('boundValue', () => {
  it('shortens long text, caps lists and drops what is not JSON', () => {
    expect(boundValue('a'.repeat(5000))).toHaveLength(1001)
    expect(boundValue(Array.from({ length: 500 }, (_, i) => i))).toHaveLength(100)
    expect(boundValue(NaN)).toBeNull()
    expect(boundValue(undefined)).toBeNull()
    expect(boundValue(() => 1)).toBeNull()
    expect(boundValue({ a: { b: { c: { d: 1 } } } })).toEqual({ a: { b: { c: null } } })
    expect(boundValue('ok')).toBe('ok')
    expect(boundValue(true)).toBe(true)
  })
})

describe('buildPayload', () => {
  const input = {
    deliveryId: 'd1',
    timestamp: Date.UTC(2026, 5, 17, 12),
    workspace: 'acme',
    project: { id: 'p', name: 'Platform', identifier: 'PLT' },
    issue: { id: 'i1', identifier: 'PLT-1', title: 'Fix', url: 'https://x/PLT-1', createdOn: 1000, modifiedOn: 2000, archivedAt: null },
    sender: { type: 'User' as const, id: 'u1', name: 'Alice' }
  }

  it('is shaped after the projects_v2_item event', () => {
    const change = describeChange({ fieldId: 'status', from: 'st-todo', to: 'st-done' }, lookups)
    const payload: any = buildPayload({ ...input, action: 'edited', change })
    expect(payload.action).toBe('edited')
    expect(payload.project_item).toMatchObject({
      id: 'i1',
      project_id: 'p',
      content_type: 'Issue',
      identifier: 'PLT-1',
      title: 'Fix',
      archived_at: null,
      created_at: '1970-01-01T00:00:01.000Z'
    })
    expect(payload.changes.field_value).toMatchObject({ field_node_id: 'status', field_type: 'status', from: { name: 'Todo' }, to: { name: 'Done' } })
    expect(payload.project).toEqual({ id: 'p', name: 'Platform', identifier: 'PLT' })
    expect(payload.sender).toEqual({ type: 'User', id: 'u1', name: 'Alice' })
    expect(payload.delivery).toEqual({ id: 'd1', sent_at: '2026-06-17T12:00:00.000Z' })
    expect(payload.workspace).toEqual({ url: 'acme' })
  })

  it('says a draft item is a DraftIssue, like GitHub', () => {
    const draft: any = buildPayload({ ...input, action: 'created', issue: { ...input.issue, isDraft: true } })
    expect(draft.project_item.content_type).toBe('DraftIssue')
    const issue: any = buildPayload({ ...input, action: 'created', issue: { ...input.issue, isDraft: false } })
    expect(issue.project_item.content_type).toBe('Issue')
  })

  it('has no changes unless the item was edited', () => {
    for (const action of ['created', 'archived', 'restored', 'deleted'] as const) {
      expect((buildPayload({ ...input, action }) as any).changes).toBeUndefined()
    }
    expect((buildPayload({ ...input, action: 'edited' }) as any).changes).toBeUndefined()
  })

  it('reports the archive time', () => {
    const payload: any = buildPayload({ ...input, action: 'archived', issue: { ...input.issue, archivedAt: Date.UTC(2026, 0, 1) } })
    expect(payload.project_item.archived_at).toBe('2026-01-01T00:00:00.000Z')
  })

  it('bounds free text and values', () => {
    const change = { field_node_id: 'title', field_name: 'Title', field_type: 'text', from: 'a'.repeat(5000), to: 'b' }
    const payload: any = buildPayload({ ...input, action: 'edited', change, issue: { ...input.issue, title: 't'.repeat(5000) } })
    expect(payload.project_item.title).toHaveLength(1001)
    expect(payload.changes.field_value.from).toHaveLength(1001)
  })
})

describe('serializePayload', () => {
  it('is plain JSON of the payload when it is small', () => {
    const payload = { a: 1, b: 'x' }
    expect(serializePayload(payload)).toBe('{"a":1,"b":"x"}')
  })

  it('never exceeds the limit: big values are dropped, the field stays named', () => {
    const big = { field_node_id: 'customFields.x', field_name: 'X', field_type: 'multi_select', from: 'a', to: 'b' }
    const payload = {
      action: 'edited',
      project_item: { id: 'i', title: 't' },
      changes: { field_value: { ...big, from: 'x'.repeat(MAX_PAYLOAD_BYTES), to: 'y'.repeat(MAX_PAYLOAD_BYTES) } }
    }
    const body = serializePayload(payload)
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES)
    const parsed = JSON.parse(body)
    expect(parsed.truncated).toBe(true)
    expect(parsed.changes.field_value).toMatchObject({ field_node_id: 'customFields.x', from: null, to: null })
  })

  it('drops the free text as a last resort', () => {
    const payload = { action: 'created', project_item: { id: 'i', title: 'x'.repeat(MAX_PAYLOAD_BYTES + 10), url: 'u' } }
    const body = serializePayload(payload)
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES)
    expect(JSON.parse(body).project_item.title).toBeNull()
  })
})
