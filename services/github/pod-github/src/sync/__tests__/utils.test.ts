//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { type Status } from '@hcengineering/core'
import task from '@hcengineering/task'
import { applyIssueEventEdits, isGithubIssueDataStale, shouldUpdateGithubIssueStatus } from '../utils'

function status (category: string): Status {
  return { category } as unknown as Status
}

describe('shouldUpdateGithubIssueStatus', () => {
  it('keeps an open platform status when GitHub reports a reopen', () => {
    for (const category of [task.statusCategory.UnStarted, task.statusCategory.ToDo, task.statusCategory.Active]) {
      expect(shouldUpdateGithubIssueStatus(status(category), status(task.statusCategory.Active))).toBe(false)
    }
  })

  it('updates a closed platform status when GitHub reopens an issue', () => {
    expect(shouldUpdateGithubIssueStatus(status(task.statusCategory.Won), status(task.statusCategory.Active))).toBe(
      true
    )
  })
})

describe('applyIssueEventEdits', () => {
  it('uses the title from the webhook when GraphQL still returns the prior title', () => {
    const external = {
      title: 'Previous title',
      body: 'Current body',
      id: 'issue-id',
      updatedAt: '2026-10-19T11:00:00.000Z'
    }

    expect(
      applyIssueEventEdits(
        external,
        { title: 'Updated title', body: 'Current body', updated_at: '2026-10-19T12:00:00.000Z' },
        { title: { from: 'Previous title' } }
      )
    ).toEqual({ ...external, title: 'Updated title', updatedAt: '2026-10-19T12:00:00.000Z' })
  })
})

describe('isGithubIssueDataStale', () => {
  it('rejects a polled issue that predates the stored webhook data', () => {
    expect(
      isGithubIssueDataStale({ updatedAt: '2026-10-19T12:00:00.000Z' }, { updatedAt: '2026-10-19T11:59:59.000Z' })
    ).toBe(true)
  })
})
