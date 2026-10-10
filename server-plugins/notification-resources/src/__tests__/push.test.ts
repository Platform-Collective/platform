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
  readOnlyGuestAccountUuid,
  type AccountUuid,
  type Ref,
  type Space,
  type TxCreateDoc,
  type WorkspaceUuid
} from '@hcengineering/core'
import notification, {
  type InboxNotification,
  type PushSubscription,
  type PushSubscriptionSetting
} from '@hcengineering/notification'
import { QueueTopic, type TriggerControl } from '@hcengineering/server-core'

import { filterEnabledSubscriptions, OnInboxNotificationCreate } from '../push'

describe('OnInboxNotificationCreate', () => {
  const workspace = 'ws-1' as WorkspaceUuid
  const factory = new TxFactory(core.account.System)

  let send: jest.Mock
  let getProducer: jest.Mock
  let control: TriggerControl

  const makeTx = (user: AccountUuid, isViewed = false): TxCreateDoc<InboxNotification> =>
    factory.createTxCreateDoc(
      notification.class.CommonInboxNotification,
      'space-1' as Ref<Space>,
      { user, isViewed, docNotifyContext: 'ctx', objectId: 'obj', objectClass: core.class.Doc } as any
    )

  beforeEach(() => {
    send = jest.fn().mockResolvedValue(undefined)
    getProducer = jest.fn(() => ({ send, close: jest.fn() }))
    control = {
      workspace: { uuid: workspace },
      queue: { getProducer },
      ctx: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    } as unknown as TriggerControl
  })

  it('publishes one message with all distinct receivers to the unread topic', async () => {
    const a = 'acc-a' as AccountUuid
    const b = 'acc-b' as AccountUuid

    const res = await OnInboxNotificationCreate([makeTx(a), makeTx(a), makeTx(b)], control)

    // The trigger emits no model txes itself.
    expect(res).toEqual([])
    expect(getProducer).toHaveBeenCalledWith(expect.anything(), QueueTopic.WorkspaceMemberUnread)
    // A whole broadcast is a single produce keyed by workspace, with de-duplicated receivers.
    expect(send).toHaveBeenCalledTimes(1)
    const [, wsArg, values] = send.mock.calls[0]
    expect(wsArg).toBe(workspace)
    expect(values).toHaveLength(1)
    expect(new Set(values[0].accounts)).toEqual(new Set([a, b]))
  })

  it('skips already-viewed notifications and the read-only guest account', async () => {
    const viewed = 'acc-viewed' as AccountUuid

    const res = await OnInboxNotificationCreate([makeTx(viewed, true), makeTx(readOnlyGuestAccountUuid)], control)

    expect(res).toEqual([])
    // No receivers -> nothing published.
    expect(getProducer).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('does nothing when no queue is configured', async () => {
    const a = 'acc-a' as AccountUuid
    control = {
      workspace: { uuid: workspace },
      ctx: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    } as unknown as TriggerControl

    await expect(OnInboxNotificationCreate([makeTx(a)], control)).resolves.toEqual([])
  })

  it('never lets a produce failure escape (fire-and-forget)', async () => {
    send.mockRejectedValueOnce(new Error('kafka down'))
    const a = 'acc-a' as AccountUuid

    await expect(OnInboxNotificationCreate([makeTx(a)], control)).resolves.toEqual([])
    expect(control.ctx.error).toHaveBeenCalled()
  })
})

describe('filterEnabledSubscriptions', () => {
  const sub = (id: string): PushSubscription => ({ _id: id }) as unknown as PushSubscription
  const setting = (attachedTo: string, enabled: boolean): PushSubscriptionSetting =>
    ({ attachedTo, enabled }) as unknown as PushSubscriptionSetting

  it('keeps a subscription with no setting (enabled by default)', () => {
    const s = sub('device-1')
    expect(filterEnabledSubscriptions([s], [])).toEqual([s])
  })

  it('keeps a subscription whose setting is enabled', () => {
    const s = sub('device-1')
    expect(filterEnabledSubscriptions([s], [setting('device-1', true)])).toEqual([s])
  })

  it('drops a subscription whose setting is disabled', () => {
    const s = sub('device-1')
    expect(filterEnabledSubscriptions([s], [setting('device-1', false)])).toEqual([])
  })

  it('only drops the disabled device, leaving the others', () => {
    const a = sub('device-a')
    const b = sub('device-b')
    const c = sub('device-c')
    const res = filterEnabledSubscriptions([a, b, c], [setting('device-b', false)])
    expect(res).toEqual([a, c])
  })
})
