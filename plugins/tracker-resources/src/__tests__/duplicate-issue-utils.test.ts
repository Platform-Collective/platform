// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref, Status, StatusCategory } from '@hcengineering/core'
import { createDuplicateComment, DUPLICATE_ISSUE_PLACEHOLDER, selectCanceledStatus } from '../duplicate-issue-utils'

const lost = 'lost' as Ref<StatusCategory>
const active = 'active' as Ref<StatusCategory>
const status = (id: string, category: Ref<StatusCategory>): Status => {
  const result: Partial<Status> = { _id: id as Ref<Status>, category }
  return result as Status
}
const first = status('first', lost)
const second = status('second', lost)
const open = status('open', active)
const taskType = { statuses: [open._id, first._id, second._id] }

describe('selectCanceledStatus', () => {
  it('selects the first canceled status in task-type order, regardless of query order', () => {
    expect(selectCanceledStatus(taskType, [second, open, first], open._id, lost)).toBe(first)
  })

  it('preserves the current status if it is already canceled and allowed', () => {
    expect(selectCanceledStatus(taskType, [first, second], second._id, lost)).toBe(second)
  })

  it('does not choose a canceled status belonging to another task type', () => {
    expect(selectCanceledStatus({ statuses: [open._id] }, [open, first], open._id, lost)).toBeUndefined()
  })

  it('does not retain a current canceled status outside the allowed statuses', () => {
    expect(selectCanceledStatus({ statuses: [first._id] }, [first, second], second._id, lost)).toBe(first)
  })

  it('handles a missing task type, missing status documents and an empty workflow', () => {
    expect(selectCanceledStatus(undefined, [first], open._id, lost)).toBeUndefined()
    expect(selectCanceledStatus(taskType, [], open._id, lost)).toBeUndefined()
    expect(selectCanceledStatus({ statuses: [] }, [first], open._id, lost)).toBeUndefined()
  })
})

describe('createDuplicateComment', () => {
  const issue = { _id: 'issue-id' as Ref<Doc>, _class: 'tracker:class:Issue' as Ref<Class<Doc>>, identifier: 'TEST-42' }
  const reference = {
    type: 'reference',
    attrs: { id: 'issue-id', label: 'TEST-42', objectclass: 'tracker:class:Issue' }
  }
  const content = (text: string): unknown => JSON.parse(createDuplicateComment(text, issue)).content[0].content

  it('replaces the placeholder with a clickable issue reference', () => {
    expect(content(`Duplicate of ${DUPLICATE_ISSUE_PLACEHOLDER}`)).toEqual([
      { type: 'text', text: 'Duplicate of ' },
      reference
    ])
    expect(content(`${DUPLICATE_ISSUE_PLACEHOLDER} was marked as duplicate of this issue`)).toEqual([
      reference,
      { type: 'text', text: ' was marked as duplicate of this issue' }
    ])
    expect(content(`Дубликат ${DUPLICATE_ISSUE_PLACEHOLDER} задачи`)).toEqual([
      { type: 'text', text: 'Дубликат ' },
      reference,
      { type: 'text', text: ' задачи' }
    ])
  })

  it('keeps quotes, newlines and HTML as plain text without injecting markup nodes', () => {
    const text = 'Duplicate of <b>TEST-42</b> "quoted"\n{issue}'
    expect(content(text)).toEqual([{ type: 'text', text }])
  })
})
