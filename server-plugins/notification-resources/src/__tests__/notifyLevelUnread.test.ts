// SPDX-License-Identifier: EPL-2.0

import chunter from '@hcengineering/chunter'
import { type PersonSpace } from '@hcengineering/contact'
import core, {
  type AccountUuid,
  type Class,
  type Doc,
  type PersonId,
  type Ref,
  type Space,
  TxFactory
} from '@hcengineering/core'
import notification, { type DocNotifyContext } from '@hcengineering/notification'
import { type TriggerControl } from '@hcengineering/server-core'

import { createCollabDocInfo } from '../index'

jest.mock('@hcengineering/server-contact', () => ({
  getAccountBySocialId: jest.fn(async () => undefined),
  getEmployeesBySocialIds: jest.fn(async () => ({}))
}))

jest.mock('../utils', () => {
  const actual = jest.requireActual('../utils')
  return {
    ...actual,
    getNotificationContent: jest.fn(async () => ({})),
    getNotificationProviderControl: jest.fn(async () => ({})),
    getObjectSpace: jest.fn(async (_control: unknown, object: Doc) => object),
    getReceiversInfo: jest.fn(async () => [
      {
        account: 'acc-a',
        employee: 'person-a',
        role: 'USER',
        socialIds: ['social-a'],
        space: 'space-a'
      }
    ]),
    getSenderInfo: jest.fn(async () => ({ socialId: 'social-b' })),
    isShouldNotifyTx: jest.fn(async () => {
      const notification = jest.requireActual('@hcengineering/notification').default
      return new Map([[notification.providers.InboxNotificationProvider, [{ _id: 'message-type' }]]])
    })
  }
})

describe('mentions-only channel unread state', () => {
  it('updates the context timestamp for an ordinary message without creating an inbox notification', async () => {
    const channel = 'channel-1' as Ref<Space>
    const contextId = 'context-1' as Ref<DocNotifyContext>
    const context: DocNotifyContext = {
      _id: contextId,
      _class: notification.class.DocNotifyContext,
      objectId: channel,
      objectClass: chunter.class.Channel,
      objectSpace: channel,
      user: 'acc-a' as AccountUuid,
      space: 'space-a' as Ref<PersonSpace>,
      modifiedBy: 'social-a' as PersonId,
      modifiedOn: 0,
      isPinned: false,
      hidden: false,
      notifyLevel: 'mentions',
      lastViewedTimestamp: 1,
      lastUpdateTimestamp: 2
    }
    const ctx: any = {
      with: async (_name: string, _params: unknown, fn: () => Promise<unknown>) => await fn(),
      error: () => {}
    }
    const apply = jest.fn(async () => ({}))
    const control: any = {
      ctx,
      apply,
      cache: new Map(),
      contextCache: new Map(),
      removedMap: new Map(),
      userStatusMap: new Map(),
      txFactory: new TxFactory(core.account.System),
      findAll: jest.fn(async (_ctx: unknown, _class: Ref<Class<Doc>>, query: { objectId?: Ref<Doc> }) => {
        if (_class === notification.class.DocNotifyContext && query.objectId === channel) return [context]
        return []
      }),
      hierarchy: {
        isDerived: (_class: string, base: string) =>
          _class === base ||
          (_class === chunter.class.ChatMessage && base === 'activity:class:ActivityMessage') ||
          (_class === chunter.class.Channel && base === core.class.Space)
      }
    }
    const object = {
      _id: channel,
      _class: chunter.class.Channel,
      space: channel,
      private: false,
      members: ['acc-a']
    } as any
    const tx = {
      _class: core.class.TxCreateDoc,
      objectId: 'message-1',
      modifiedBy: 'social-b' as PersonId,
      modifiedOn: 100,
      space: channel
    } as any
    const message = {
      _id: 'message-1',
      _class: chunter.class.ChatMessage,
      attachedTo: channel,
      attachedToClass: chunter.class.Channel,
      createdOn: 100,
      modifiedOn: 100,
      message: 'ordinary message'
    } as any

    const result = await createCollabDocInfo(
      ctx,
      [],
      ['acc-a' as AccountUuid],
      control as TriggerControl,
      tx,
      object,
      [message],
      { isOwn: false, isSpace: false, shouldUpdateTimestamp: true }
    )

    expect(result).toEqual([])
    expect(apply).toHaveBeenCalledWith(
      ctx,
      expect.arrayContaining([
        expect.objectContaining({
          objectId: contextId,
          operations: expect.objectContaining({ hidden: false, lastUpdateTimestamp: 100 })
        })
      ])
    )
  })
})
