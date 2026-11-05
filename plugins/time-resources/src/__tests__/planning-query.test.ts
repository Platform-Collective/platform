// SPDX-License-Identifier: EPL-2.0

import type { Issue } from '@hcengineering/tracker'
import { queryPlanningIssues } from '../planning-query'

it('keeps previous hints until a changed issue query answers', () => {
  const set = jest.fn()
  let answer: ((issues: Issue[]) => void) | undefined
  const query = {
    unsubscribe: jest.fn(),
    query: jest.fn((_class, _filter, callback) => { answer = callback; return true })
  }
  const issue = { _id: 'old' } as Issue
  queryPlanningIssues(query as unknown as Parameters<typeof queryPlanningIssues>[0], 'issue' as Issue['_class'], ['new' as Issue['_id']], set)
  expect(set).not.toHaveBeenCalled()
  answer?.([issue])
  expect(set).toHaveBeenLastCalledWith(new Map([[issue._id, issue]]))
  set.mockClear()
  queryPlanningIssues(query as unknown as Parameters<typeof queryPlanningIssues>[0], 'issue' as Issue['_class'], [], set)
  expect(query.unsubscribe).toHaveBeenCalledTimes(1)
  expect(set).toHaveBeenCalledWith(new Map())
})
