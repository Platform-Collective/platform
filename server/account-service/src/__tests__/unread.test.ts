//
// Copyright © 2026 Platform Collective.
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

import { type AccountDB } from '@hcengineering/account'
import { type AccountUuid, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'
import {
  type ConsumerControl,
  type ConsumerMessage,
  type WorkspaceMemberUnreadMessage
} from '@hcengineering/server-core'

import { createWorkspaceMemberUnreadHandler } from '../unread'

describe('workspace-member unread consumer', () => {
  const ctx = { info: jest.fn() } as unknown as MeasureContext
  const control = {} as unknown as ConsumerControl
  const workspace = 'ws-1' as WorkspaceUuid

  let setWorkspaceMembersUnread: jest.Mock
  let db: AccountDB

  const msg = (accounts: AccountUuid[]): ConsumerMessage<WorkspaceMemberUnreadMessage> => {
    const message: ConsumerMessage<WorkspaceMemberUnreadMessage> = { workspace, value: { accounts } }
    return message
  }

  beforeEach(() => {
    setWorkspaceMembersUnread = jest.fn().mockResolvedValue(undefined)
    db = { setWorkspaceMembersUnread } as unknown as AccountDB
  })

  it('raises the flag for all accounts in the message in one bulk call', async () => {
    const handler = createWorkspaceMemberUnreadHandler(db)
    const a = 'acc-a' as AccountUuid
    const b = 'acc-b' as AccountUuid

    await handler(ctx, msg([a, b]), control)

    expect(setWorkspaceMembersUnread).toHaveBeenCalledTimes(1)
    expect(setWorkspaceMembersUnread).toHaveBeenCalledWith([a, b], workspace, true)
  })

  it('ignores messages with no accounts', async () => {
    const handler = createWorkspaceMemberUnreadHandler(db)
    const emptyValue: ConsumerMessage<WorkspaceMemberUnreadMessage> = {
      workspace,
      value: { accounts: undefined as unknown as AccountUuid[] }
    }

    await handler(ctx, msg([]), control)
    await handler(ctx, emptyValue, control)

    expect(setWorkspaceMembersUnread).not.toHaveBeenCalled()
  })
})
