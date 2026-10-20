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

import core, {
  type AccountUuid,
  type Data,
  type Doc,
  type Ref,
  type Space,
  type TxCreateDoc,
  TxFactory
} from '@hcengineering/core'
import gmail from '@hcengineering/gmail'
import notification, { type InboxNotification } from '@hcengineering/notification'
import type { TriggerControl } from '@hcengineering/server-core'

const mockGetAllowedProviders = jest.fn()
const mockGetContentByTemplate = jest.fn()
const mockGetNotificationProviderControl = jest.fn()
const mockGetReceiversInfo = jest.fn()
const mockGetEmployeeByAcc = jest.fn()
const mockGetPerson = jest.fn()

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getMetadata: () => 'http://mail.test'
}))

jest.mock('@hcengineering/server-contact', () => ({
  getEmployeeByAcc: (...args: unknown[]) => mockGetEmployeeByAcc(...args),
  getPerson: (...args: unknown[]) => mockGetPerson(...args)
}))

jest.mock('@hcengineering/server-notification-resources', () => ({
  ...jest.requireActual('@hcengineering/server-notification-resources'),
  getAllowedProviders: (...args: unknown[]) => mockGetAllowedProviders(...args),
  getContentByTemplate: (...args: unknown[]) => mockGetContentByTemplate(...args),
  getNotificationProviderControl: (...args: unknown[]) => mockGetNotificationProviderControl(...args),
  getReceiversInfo: (...args: unknown[]) => mockGetReceiversInfo(...args)
}))

import gmailResources from '../index'

const RECIPIENT = 'recipient' as AccountUuid
const EMAIL = 'recipient@example.test'
const ISSUE = 'issue' as Ref<Doc>
const DUE_DATE_TYPE = 'tracker:notification:Issue_dueDate'
const SUMMARY_TYPE = 'tracker:ids:DependencyShiftedNotification'
const CACHE_KEY = 'AvailableNotificationProviders'

function makeNotification (id: string, type: string): TxCreateDoc<InboxNotification> {
  return new TxFactory(core.account.System).createTxCreateDoc(
    notification.class.CommonInboxNotification,
    'space' as Ref<Space>,
    {
      user: RECIPIENT,
      isViewed: false,
      archived: false,
      docNotifyContext: 'context',
      objectId: ISSUE,
      objectClass: core.class.Doc,
      types: [type]
    } as unknown as Data<InboxNotification>,
    id as Ref<InboxNotification>
  )
}

describe('NotificationsHandler', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    mockGetAllowedProviders.mockReset().mockReturnValue([gmail.providers.EmailNotificationProvider])
    mockGetContentByTemplate.mockReset().mockImplementation(async (_doc: unknown, _sender: unknown, type: string) => ({
      text: `email for ${type}`,
      html: `<p>email for ${type}</p>`,
      subject: type
    }))
    mockGetNotificationProviderControl.mockReset().mockResolvedValue({})
    mockGetReceiversInfo.mockReset().mockResolvedValue([{ account: RECIPIENT, socialIds: ['recipient-social'] }])
    mockGetEmployeeByAcc.mockReset().mockResolvedValue({ _id: 'employee' })
    mockGetPerson.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('mails only the cascade summary when the due-date provider decision is cached without email', async () => {
    const dueDate = makeNotification('due-date-notification', DUE_DATE_TYPE)
    const summary = makeNotification('summary-notification', SUMMARY_TYPE)
    const contextCache = new Map([
      [CACHE_KEY, new Map([[dueDate.objectId, [notification.providers.InboxNotificationProvider]]])]
    ])
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, statusText: 'OK' })
    globalThis.fetch = fetchMock
    const control = {
      ctx: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
      contextCache,
      lowLevel: { rawFindAll: jest.fn().mockResolvedValue([{ value: EMAIL }]) },
      findAll: jest.fn().mockResolvedValue([{ _id: ISSUE, _class: core.class.Doc }]),
      hierarchy: { isDerived: (clazz: unknown, parent: unknown) => clazz === parent },
      modelDb: { getObject: jest.fn() }
    } as unknown as TriggerControl

    const resources = await gmailResources()
    await resources.trigger.NotificationsHandler([dueDate, summary], control)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      subject: SUMMARY_TYPE,
      to: [EMAIL]
    })
    expect(mockGetAllowedProviders).toHaveBeenCalledTimes(1)
  })
})
