// SPDX-License-Identifier: EPL-2.0

import activity from '@hcengineering/activity'
import chunter from '@hcengineering/chunter'
import { type Employee, type PersonSpace } from '@hcengineering/contact'
import core, {
  type AccountUuid,
  type Class,
  type Doc,
  type PersonId,
  type Ref,
  type Space,
  type Tx,
  TxFactory
} from '@hcengineering/core'
import notification, { type DocNotifyLevel, type NotificationType } from '@hcengineering/notification'
import { type TriggerControl } from '@hcengineering/server-core'
import { type ReceiverInfo } from '@hcengineering/server-notification'

import { getCommonNotificationTxes } from '../index'

// server-contact pulls a heavy dependency graph and is not used on this path.
jest.mock('@hcengineering/server-contact', () => ({
  getAccountBySocialId: jest.fn(async () => undefined),
  getEmployeesBySocialIds: jest.fn(async () => ({}))
}))

const channel = 'channel-1' as Ref<Doc>
const rootMessage = 'root-msg' as Ref<Doc>
const personSpace = 'space-a' as Ref<PersonSpace>
const receiver: ReceiverInfo = {
  account: 'acc-a' as AccountUuid,
  employee: 'person-a' as Ref<Employee>,
  role: 'USER',
  socialIds: ['social-a' as PersonId],
  space: personSpace
}

const subClasses: Record<string, string[]> = {
  [chunter.class.ChatMessage]: [activity.class.ActivityMessage],
  [chunter.class.ThreadMessage]: [chunter.class.ChatMessage, activity.class.ActivityMessage]
}

function makeControl (channelLevel: DocNotifyLevel): { control: TriggerControl, findAll: jest.Mock } {
  const ctx: any = {
    with: async (_name: string, _params: any, fn: any) => await fn(ctx),
    error: () => {},
    contextData: { broadcast: { txes: [] } }
  }
  const findAll = jest.fn(async (_ctx: any, _class: Ref<Class<Doc>>, query: any) => {
    if (_class === activity.class.ActivityMessage && query._id === rootMessage) {
      // Persisted parent: a real chat message in the channel.
      return [{ _id: rootMessage, _class: chunter.class.ChatMessage, attachedTo: channel }]
    }
    if (
      _class === notification.class.DocNotifyContext &&
      query.objectId === channel &&
      query.notifyLevel !== undefined
    ) {
      return [{ objectId: channel, user: receiver.account, space: personSpace, notifyLevel: channelLevel }]
    }
    return []
  })
  const control: any = {
    ctx,
    txes: [],
    findAll,
    apply: jest.fn(async () => ({})),
    cache: new Map(),
    contextCache: new Map(),
    removedMap: new Map(),
    txFactory: new TxFactory(core.account.System),
    hierarchy: {
      isDerived: (_class: string, base: string) => _class === base || (subClasses[_class] ?? []).includes(base)
    }
  }
  return { control: control as TriggerControl, findAll }
}

async function notifyMention (control: TriggerControl): Promise<Tx[]> {
  const type = { _id: 'mention-type' as Ref<NotificationType> } as unknown as NotificationType
  return await getCommonNotificationTxes(
    control.ctx,
    control,
    { _id: rootMessage, _class: chunter.class.ChatMessage, space: 'space-1' as Ref<Space> } as any,
    { header: activity.string.MentionedYouIn },
    receiver,
    { socialId: 'social-b' as PersonId },
    rootMessage,
    // Base class instead of the real ChatMessage class
    activity.class.ActivityMessage,
    'space-1' as Ref<Space>,
    Date.now(),
    new Map([[notification.providers.InboxNotificationProvider, [type]]]),
    notification.class.MentionInboxNotification
  )
}

describe('channel notification level for thread notifications', () => {
  it('blocks a thread mention when the channel level is none, even with a base attachedToClass', async () => {
    const { control, findAll } = makeControl('none')
    const res = await notifyMention(control)
    expect(res).toEqual([])
    expect(findAll).toHaveBeenCalledWith(
      expect.anything(),
      activity.class.ActivityMessage,
      { _id: rootMessage },
      expect.anything()
    )
  })

  it('creates the thread mention when the channel level is mentions', async () => {
    const { control } = makeControl('mentions')
    const res = await notifyMention(control)
    expect(res).toHaveLength(1)
    expect((res[0] as any).objectClass).toBe(notification.class.MentionInboxNotification)
  })
})
