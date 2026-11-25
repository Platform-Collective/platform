// SPDX-License-Identifier: EPL-2.0

import type { Ref, Status, StatusCategory } from '@hcengineering/core'
import type { Project } from '@hcengineering/tracker'
import { createDuplicatePickerQuery } from '../duplicate-issue-utils'

const lost = 'lost' as Ref<StatusCategory>
const active = 'active' as Ref<StatusCategory>
const status = (id: string, category: Ref<StatusCategory>): Status => {
  const result: Partial<Status> = { _id: id as Ref<Status>, category }
  return result as Status
}

it('excludes canceled issues and projects without edit permission from the picker query', () => {
  const editableProjects = ['editable-a', 'editable-b'] as Array<Ref<Project>>
  expect(
    createDuplicatePickerQuery(
      [status('open', active), status('canceled-a', lost), status('canceled-b', lost)],
      editableProjects,
      lost
    )
  ).toEqual({
    status: { $nin: ['canceled-a', 'canceled-b'] },
    space: { $in: editableProjects }
  })
})

it('returns an empty editable-project query until permissions have loaded', () => {
  expect(createDuplicatePickerQuery([], [], lost)).toEqual({
    status: { $nin: [] },
    space: { $in: [] }
  })
})
