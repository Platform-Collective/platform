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

import core, {
  TxFactory,
  systemAccountUuid,
  readOnlyGuestAccountUuid,
  type AccountUuid,
  type Ref,
  type Space,
  type TxCreateDoc,
  type WorkspaceUuid
} from '@hcengineering/core'
import notification, { type InboxNotification } from '@hcengineering/notification'
import { getAccountClient } from '@hcengineering/server-client'
import { generateToken } from '@hcengineering/server-token'
import type { TriggerControl } from '@hcengineering/server-core'

import { OnInboxNotificationCreate } from '../push'

jest.mock('@hcengineering/server-client', () => ({
  getAccountClient: jest.fn()
}))

jest.mock('@hcengineering/server-token', () => ({
  generateToken: jest.fn(() => 'svc-token')
}))

describe('OnInboxNotificationCreate', () => {
  const workspace = 'ws-1' as WorkspaceUuid
  const factory = new TxFactory(core.account.System)

  let setWorkspaceMemberUnread: jest.Mock
  let control: TriggerControl

  const makeTx = (user: AccountUuid, isViewed = false): TxCreateDoc<InboxNotification> =>
    factory.createTxCreateDoc(
      notification.class.CommonInboxNotification,
      'space-1' as Ref<Space>,
      { user, isViewed, docNotifyContext: 'ctx', objectId: 'obj', objectClass: core.class.Doc } as any
    ) as TxCreateDoc<InboxNotification>

  beforeEach(() => {
    jest.clearAllMocks()
    setWorkspaceMemberUnread = jest.fn().mockResolvedValue(undefined)
    ;(getAccountClient as jest.Mock).mockReturnValue({ setWorkspaceMemberUnread })
    ;(generateToken as jest.Mock).mockReturnValue('svc-token')
    control = {
      workspace: { uuid: workspace },
      ctx: { error: jest.fn() }
    } as unknown as TriggerControl
  })

  it('raises the unread flag once per distinct receiver using a notification service token', async () => {
    const a = 'acc-a' as AccountUuid
    const b = 'acc-b' as AccountUuid

    const res = await OnInboxNotificationCreate([makeTx(a), makeTx(a), makeTx(b)], control)

    // The trigger only reports to account-service; it emits no model txes itself.
    expect(res).toEqual([])
    // Service token is scoped to this workspace and carries the notification service marker,
    // which is what account-service checks before allowing another account's flag to be raised.
    expect(generateToken).toHaveBeenCalledWith(systemAccountUuid, workspace, { service: 'notification' })
    expect(getAccountClient).toHaveBeenCalledWith('svc-token')
    // Deduplicated: two notifications for A collapse into a single call.
    expect(setWorkspaceMemberUnread).toHaveBeenCalledTimes(2)
    expect(setWorkspaceMemberUnread).toHaveBeenCalledWith(a, true)
    expect(setWorkspaceMemberUnread).toHaveBeenCalledWith(b, true)
  })

  it('skips already-viewed notifications and the read-only guest account', async () => {
    const viewed = 'acc-viewed' as AccountUuid

    const res = await OnInboxNotificationCreate([makeTx(viewed, true), makeTx(readOnlyGuestAccountUuid)], control)

    expect(res).toEqual([])
    expect(setWorkspaceMemberUnread).not.toHaveBeenCalled()
    // No receivers -> no token minted, no account-service round-trip.
    expect(generateToken).not.toHaveBeenCalled()
  })

  it('never lets an account-service failure escape (fire-and-forget)', async () => {
    setWorkspaceMemberUnread.mockRejectedValueOnce(new Error('account down'))
    const a = 'acc-a' as AccountUuid

    await expect(OnInboxNotificationCreate([makeTx(a)], control)).resolves.toEqual([])
    expect(control.ctx.error).toHaveBeenCalled()
  })
})
