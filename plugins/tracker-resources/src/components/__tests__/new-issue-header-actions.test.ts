// SPDX-License-Identifier: EPL-2.0

import { getNewIssueHeaderActions } from '../new-issue-header-actions'

jest.mock('../../plugin', () => ({
  __esModule: true,
  default: {
    string: {
      CreateProject: 'CreateProject',
      NewIssue: 'NewIssue',
      ResumeDraft: 'ResumeDraft',
      Import: 'Import'
    }
  }
}))

describe('tracker header actions', () => {
  it.each([
    [false, true, 'NewIssue'],
    [true, true, 'ResumeDraft'],
    [false, false, 'ResumeDraft'],
    [true, false, 'ResumeDraft']
  ] as const)('omits Import with a project (draft=%s, closed=%s, main=%s)', (draft, closed, mainActionId) => {
    expect(getNewIssueHeaderActions(draft, true, closed)).toEqual({
      mainActionId,
      visibleActions: ['CreateProject', mainActionId]
    })
  })

  it.each([
    [false, true],
    [true, true],
    [false, false],
    [true, false]
  ])('shows only project creation without projects (draft=%s, closed=%s)', (draft, closed) => {
    expect(getNewIssueHeaderActions(draft, false, closed).visibleActions).toEqual(['CreateProject'])
  })
})
