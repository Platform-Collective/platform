// SPDX-License-Identifier: EPL-2.0

import { translateActivityInfoMessage } from '@hcengineering/activity'
import type { Class, Doc, Ref, Status, StatusCategory } from '@hcengineering/core'
import { addStringsLoader } from '@hcengineering/platform'
import { trackerId } from '@hcengineering/tracker'
import { createDuplicateReference, selectCanceledStatus } from '../duplicate-issue-utils'
import tracker from '../plugin'

const ru = jest.requireActual<{ string: { DuplicateOf: string } }>('../../../tracker-assets/lang/ru.json')

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

it('encodes issue references safely for translated activity messages', () => {
  expect(
    createDuplicateReference({
      _id: 'id"<script>' as Ref<Doc>,
      _class: 'tracker:class:Issue' as Ref<Class<Doc>>,
      identifier: 'T<&-42'
    })
  ).toBe(
    '<span data-type="reference" data-id="id&quot;&lt;script&gt;" data-objectclass="tracker:class:Issue" data-label="T&lt;&amp;-42">@T&lt;&amp;-42</span>'
  )
})

it('renders an issue reference with the tracker message ID and Russian translation', async () => {
  addStringsLoader(trackerId, async () => ru)
  const issue = { _id: 'issue-id' as Ref<Doc>, _class: tracker.class.Issue, identifier: 'TEST-42' }
  const result = new Promise<string>((resolve) => {
    translateActivityInfoMessage(tracker.string.DuplicateOf, { issue: createDuplicateReference(issue) }, 'ru', resolve)
  })
  await expect(result).resolves.toContain('Дубликат <span data-type="reference"')
})
