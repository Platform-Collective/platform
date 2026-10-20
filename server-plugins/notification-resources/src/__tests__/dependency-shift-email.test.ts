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

import core, { type AccountUuid, type TxUpdateDoc } from '@hcengineering/core'
import gmail from '@hcengineering/gmail'
import notification, {
  type NotificationProvider,
  type NotificationType,
  type NotificationTypeSetting
} from '@hcengineering/notification'
import tracker, { dependencyShiftEmailRecipientsMeta, type Issue } from '@hcengineering/tracker'
import { isShouldNotifyTx, NotificationProviderControl } from '../utils'

const RECIPIENT = 'recipient' as AccountUuid
const SOCIAL_ID = 'recipient-social'

const emailProvider = {
  _id: gmail.providers.EmailNotificationProvider,
  defaultEnabled: true
} as unknown as NotificationProvider

const dueDateType = {
  _id: 'tracker:notification:Issue_dueDate',
  defaultEnabled: true,
  field: 'dueDate',
  txClasses: [core.class.TxUpdateDoc],
  objectClass: tracker.class.Issue
} as unknown as NotificationType

const dependencyShiftType = {
  _id: 'tracker:ids:DependencyShiftedNotification',
  defaultEnabled: true,
  txClasses: [core.class.TxCreateDoc],
  objectClass: tracker.class.DependencyShiftedNotification
} as unknown as NotificationType

function makeControl (): any {
  return {
    modelDb: {
      findAllSync: (clazz: unknown, query: { objectClass?: string }) => {
        if (clazz === notification.class.NotificationProvider) return [emailProvider]
        if (clazz === notification.class.NotificationProviderDefaults) return []
        if (clazz === notification.class.NotificationType) {
          return query.objectClass === tracker.class.DependencyShiftedNotification
            ? [dependencyShiftType]
            : [dueDateType, dependencyShiftType]
        }
        return []
      }
    },
    hierarchy: {
      getBaseClass: (clazz: unknown) => clazz,
      isDerived: (clazz: unknown, parent: unknown) => clazz === parent,
      hasMixin: () => false
    }
  }
}

function makeDueDateUpdate (): TxUpdateDoc<Issue> {
  return {
    _id: 'tx1' as any,
    _class: core.class.TxUpdateDoc,
    space: core.space.Tx,
    objectSpace: 'project1' as any,
    objectId: 'issue1' as any,
    objectClass: tracker.class.Issue,
    modifiedBy: 'author' as any,
    modifiedOn: 1,
    operations: { dueDate: 2 },
    meta: { [dependencyShiftEmailRecipientsMeta]: JSON.stringify([RECIPIENT]) }
  }
}

describe('dependency-shift due-date email suppression', () => {
  it('suppresses the due-date email when the recipient can receive the summary email', async () => {
    const result = await isShouldNotifyTx(
      makeControl(),
      makeDueDateUpdate(),
      {} as unknown as Issue,
      { account: RECIPIENT, socialIds: [SOCIAL_ID], employee: 'employee' } as any,
      false,
      false,
      new NotificationProviderControl([], [])
    )

    expect(result.has(gmail.providers.EmailNotificationProvider)).toBe(false)
  })

  it('keeps the due-date email when the recipient disabled the summary type', async () => {
    const summaryDisabled: NotificationTypeSetting = {
      _id: 'setting' as any,
      _class: notification.class.NotificationTypeSetting,
      space: core.space.Workspace,
      attachedTo: gmail.providers.EmailNotificationProvider,
      type: dependencyShiftType._id,
      enabled: false,
      createdBy: SOCIAL_ID as any,
      createdOn: 1,
      modifiedBy: SOCIAL_ID as any,
      modifiedOn: 1
    }
    const result = await isShouldNotifyTx(
      makeControl(),
      makeDueDateUpdate(),
      {} as unknown as Issue,
      { account: RECIPIENT, socialIds: [SOCIAL_ID], employee: 'employee' } as any,
      false,
      false,
      new NotificationProviderControl([], [summaryDisabled])
    )

    expect(result.get(gmail.providers.EmailNotificationProvider)).toEqual([dueDateType])
  })
})
