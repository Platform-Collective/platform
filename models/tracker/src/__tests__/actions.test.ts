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

import { type Builder } from '@hcengineering/model'
import { createActions } from '../actions'
import tracker from '../plugin'

describe('Copy to project action', () => {
  it('registers the action for any issue template selection', () => {
    const createDoc = jest.fn()
    const builder = { createDoc, mixin: jest.fn() } as unknown as Builder
    createActions(builder, 'issues', 'components', 'my-issues')
    const registration = createDoc.mock.calls.find((call) => call[3] === tracker.action.CopyIssueTemplateToProject)
    expect(registration).toBeDefined()
    expect(registration?.[2]).toMatchObject({ target: tracker.class.IssueTemplate, input: 'any' })
  })
})
