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
// SPDX-License-Identifier: EPL-2.0
//

import activity, { type DocUpdateMessage } from '@hcengineering/activity'
import core, {
  type AccountUuid,
  type Doc,
  type PersonId,
  type Ref,
  type Space,
  type Tx,
  type TxUpdateDoc,
  TxFactory
} from '@hcengineering/core'
import notification, {
  type DocNotifyContext,
  type InboxNotification,
  type NotificationProvider,
  type NotificationType,
  type NotificationTypeSetting
} from '@hcengineering/notification'
import type { TriggerControl } from '@hcengineering/server-core'
import type { ReceiverInfo, SenderInfo } from '@hcengineering/server-notification'
import { getCommonNotificationTxes, getNotificationTxes } from '../index'
import * as utils from '../utils'
import { cacheNotificationProviderDecision, isShouldNotifyTx, NotificationProviderControl } from '../utils'
import type { NotifyResult } from '../types'

// Use a non-tracker document, field, type and provider: coverage is generic.
const RECIPIENT = 'recipient' as AccountUuid
const SOCIAL_ID = 'recipient-social' as PersonId
const COVERAGE_KEY = 'notification:provider-coverage'
interface TestDocument extends Doc {
  title: string
}

const document: TestDocument = {
  _id: 'document1' as Ref<TestDocument>,
  _class: core.class.Doc,
  space: 'project1' as Ref<Space>,
  modifiedBy: 'author' as PersonId,
  modifiedOn: 1,
  title: 'original'
}
const provider: NotificationProvider = {
  ...document,
  _id: 'test:provider:Delivery' as Ref<NotificationProvider>,
  _class: notification.class.NotificationProvider,
  label: notification.string.Notifications,
  description: notification.string.Notifications,
  icon: notification.icon.Notifications,
  defaultEnabled: true,
  canDisable: true,
  order: 0
}
const inbox: NotificationProvider = { ...provider, _id: notification.providers.InboxNotificationProvider }
const changeType: NotificationType = {
  ...document,
  _id: 'test:type:Change' as Ref<NotificationType>,
  _class: notification.class.NotificationType,
  label: notification.string.Notifications,
  generated: false,
  hidden: false,
  group: notification.ids.NotificationGroup,
  defaultEnabled: true,
  field: 'title',
  txClasses: [core.class.TxUpdateDoc],
  objectClass: core.class.Doc
}
const summaryType: NotificationType = {
  ...changeType,
  _id: 'test:type:Summary' as Ref<NotificationType>,
  field: undefined
}
const summary: Tx = {
  ...document,
  _id: 'summary-tx' as Ref<Tx>,
  _class: core.class.Tx,
  objectSpace: document.space
}
const receiver: ReceiverInfo = {
  account: RECIPIENT,
  socialIds: [SOCIAL_ID],
  employee: 'employee' as ReceiverInfo['employee'],
  space: 'person-space' as ReceiverInfo['space'],
  role: undefined
}

interface TestControl {
  control: TriggerControl
  findObject: jest.Mock
  findAllSync: jest.Mock
}

function makeControl (marked = true, types: NotificationType[] = [changeType]): TestControl {
  const findObject = jest.fn().mockReturnValue(summaryType)
  const findAllSync = jest.fn((clazz: unknown) => {
    if (clazz === notification.class.NotificationProvider) return [provider, inbox]
    if (clazz === notification.class.NotificationType) return types
    return []
  })
  const control = {
    txes: [summary],
    contextCache: new Map(
      marked
        ? [
            [
              COVERAGE_KEY,
              new Map([
                [
                  'tx1',
                  [
                    {
                      summary: summary._id,
                      recipient: RECIPIENT,
                      provider: provider._id,
                      type: summaryType._id,
                      field: 'title'
                    }
                  ]
                ]
              ])
            ]
          ]
        : []
    ),
    modelDb: {
      findObject,
      findAllSync
    },
    hierarchy: {
      getBaseClass: (clazz: unknown) => clazz,
      isDerived: (clazz: unknown, parent: unknown) => clazz === parent,
      hasMixin: () => false
    }
  } as unknown as TriggerControl
  return { control, findObject, findAllSync }
}

function makeUpdate (): TxUpdateDoc<TestDocument> {
  return {
    _id: 'tx1' as Ref<TxUpdateDoc<TestDocument>>,
    _class: core.class.TxUpdateDoc,
    space: core.space.Tx,
    objectSpace: document.space,
    objectId: document._id,
    objectClass: document._class,
    modifiedBy: document.modifiedBy,
    modifiedOn: document.modifiedOn,
    operations: { title: 'changed' }
  }
}

async function notify (
  control: TriggerControl,
  settings: NotificationTypeSetting[] = [],
  tx = makeUpdate()
): Promise<NotifyResult> {
  return await isShouldNotifyTx(
    control,
    tx,
    document,
    receiver,
    false,
    false,
    new NotificationProviderControl([], settings)
  )
}

describe('notification provider coverage', () => {
  it('suppresses only the covered provider and keeps inbox delivery', async () => {
    const { control, findObject } = makeControl()
    const result = await notify(control)
    expect(findObject).toHaveBeenCalledTimes(1)
    expect(result.has(provider._id)).toBe(false)
    expect(result.get(inbox._id)).toEqual([changeType])
  })

  it.each([false, true])('keeps a provider needed by an uncovered type (reversed=%s)', async (reversed) => {
    const uncoveredType: NotificationType = {
      ...changeType,
      _id: 'test:type:Update' as Ref<NotificationType>,
      field: undefined
    }
    const types = [changeType, uncoveredType]
    if (reversed) types.reverse()
    const { control } = makeControl(true, types)
    const result = await notify(control)

    expect(result.get(provider._id)).toEqual([uncoveredType])
    expect(result.get(inbox._id)).toEqual(types)

    const id = 'mixed-notification' as Ref<InboxNotification>
    cacheNotificationProviderDecision(control, id, result)
    expect(control.contextCache.get('AvailableNotificationProviders').get(id)).toContain(provider._id)
    expect(control.contextCache.get('notification:provider-suppressions')?.get(id)).toBeUndefined()
  })

  it.each(['activity', 'common'])('passes explicit coverage through the %s notification producer', async (kind) => {
    const { control } = makeControl()
    const tx = makeUpdate()
    const object: Doc = { ...document, _id: tx.objectId, _class: tx.objectClass, space: tx.objectSpace }
    const sender: SenderInfo = { socialId: tx.modifiedBy }
    const context: DocNotifyContext = {
      ...document,
      _id: 'context' as Ref<DocNotifyContext>,
      _class: notification.class.DocNotifyContext,
      space: receiver.space,
      objectId: object._id,
      objectClass: object._class,
      objectSpace: object.space,
      user: RECIPIENT,
      isPinned: false,
      hidden: false
    }
    const message: DocUpdateMessage = {
      ...document,
      _id: 'message' as Ref<DocUpdateMessage>,
      _class: activity.class.DocUpdateMessage,
      attachedTo: object._id,
      attachedToClass: object._class,
      collection: 'messages',
      objectId: object._id,
      objectClass: object._class,
      action: 'update'
    }
    control.txFactory = new TxFactory(core.account.System)
    control.findAll = jest.fn().mockResolvedValue([context])
    const content = jest.spyOn(utils, 'getNotificationContent').mockResolvedValue({
      title: notification.string.CommonNotificationTitle,
      body: notification.string.CommonNotificationBody,
      intlParams: {}
    })
    try {
      const result =
        kind === 'activity'
          ? await getNotificationTxes(
              control.ctx,
              control,
              object,
              tx,
              receiver,
              sender,
              { isOwn: false, isSpace: false, shouldUpdateTimestamp: false },
              [context],
              [message],
              new NotificationProviderControl([], [])
            )
          : await getCommonNotificationTxes(
              control.ctx,
              control,
              object,
              {},
              receiver,
              sender,
              object._id,
              object._class,
              object.space,
              1,
              await notify(control),
              notification.class.CommonInboxNotification,
              tx
            )
      const notificationTx = result[0] as unknown as { objectId: Ref<InboxNotification> }
      expect(control.contextCache.get('notification:provider-suppressions').get(notificationTx.objectId)).toEqual([
        provider._id
      ])
      expect(control.contextCache.get('AvailableNotificationProviders').get(notificationTx.objectId)).toEqual([
        inbox._id
      ])
      expect(JSON.stringify(result)).not.toContain('notification:provider-suppressions')
    } finally {
      content.mockRestore()
    }
  })

  it.each([false, true])('uses explicit summary input regardless of its position (reversed=%s)', async (reversed) => {
    const { control } = makeControl()
    control.txes = [summary, makeUpdate()]
    if (reversed) control.txes.reverse()
    expect((await notify(control)).has(provider._id)).toBe(false)
  })

  it('keeps delivery when the recipient disabled the covering summary type', async () => {
    const setting: NotificationTypeSetting = {
      ...document,
      _id: 'summary-setting' as Ref<NotificationTypeSetting>,
      _class: notification.class.NotificationTypeSetting,
      attachedTo: provider._id,
      type: summaryType._id,
      enabled: false,
      createdBy: SOCIAL_ID
    }
    const result = await notify(makeControl().control, [setting])
    expect(result.get(provider._id)).toEqual([changeType])
  })

  it.each([false, true])('skips summary checks for an unmarked tx (coverage cache=%s)', async (marked) => {
    const { control, findObject, findAllSync } = makeControl(marked)
    const tx = makeUpdate()
    tx._id = 'unmarked' as Ref<TxUpdateDoc<TestDocument>>
    for (let i = 0; i < 100; i++) {
      expect((await notify(control, [], tx)).get(provider._id)).toEqual([changeType])
    }
    expect(findObject).not.toHaveBeenCalled()
    const queries = findAllSync.mock.calls
    expect(queries.filter(([clazz]) => clazz === notification.class.NotificationType)).toHaveLength(100)
    // One ordinary isAllowed per provider and invocation; no extra summary isAllowed.
    expect(queries.filter(([clazz]) => clazz === notification.class.NotificationProviderDefaults)).toHaveLength(200)
  })

  it.each(['recipient', 'field', 'summary'])('ignores a marker for another %s', async (key) => {
    const { control, findObject } = makeControl()
    const markers = control.contextCache.get(COVERAGE_KEY)
    markers.get('tx1')[0][key] = 'unrelated'
    const result = await notify(control)
    expect(result.get(provider._id)).toEqual([changeType])
    expect(findObject).not.toHaveBeenCalled()
  })

  it('keeps delivery when the covering summary type is missing', async () => {
    const { control, findObject } = makeControl()
    findObject.mockReturnValue(undefined)
    expect((await notify(control)).get(provider._id)).toEqual([changeType])
  })

  it('ignores forged transaction meta', async () => {
    const tx = makeUpdate()
    tx.meta = { [COVERAGE_KEY]: JSON.stringify([{ recipient: RECIPIENT }]) }
    expect((await notify(makeControl(false).control, [], tx)).get(provider._id)).toEqual([changeType])
  })
})
