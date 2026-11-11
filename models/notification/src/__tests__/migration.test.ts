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

import { type AccountUuid } from '@hcengineering/core'
import { type MigrationClient } from '@hcengineering/model'
import { getSocialKeyByOldAccount, getUniqueAccountsFromOldAccounts } from '@hcengineering/model-core'
import { migrateAccounts, migrateCollaborators } from '../migration'

jest.mock('@hcengineering/chunter', () => ({}))
jest.mock('@hcengineering/contact', () => ({}))
jest.mock('@hcengineering/core', () => ({
  __esModule: true,
  default: {
    account: { System: 'system' },
    class: { Collaborator: 'core:class:Collaborator' }
  },
  DOMAIN_COLLABORATOR: 'collaborator',
  DOMAIN_TRANSIENT: 'transient',
  DOMAIN_TX: 'tx',
  generateId: jest.fn(() => 'collaborator-id')
}))
jest.mock('@hcengineering/model', () => ({}))
jest.mock('@hcengineering/notification', () => ({
  __esModule: true,
  default: {
    mixin: { Collaborators: 'notification:mixin:Collaborators' },
    class: {
      BrowserNotification: 'notification:class:BrowserNotification',
      InboxNotification: 'notification:class:InboxNotification',
      ActivityInboxNotification: 'notification:class:ActivityInboxNotification',
      CommonInboxNotification: 'notification:class:CommonInboxNotification',
      DocNotifyContext: 'notification:class:DocNotifyContext',
      PushSubscription: 'notification:class:PushSubscription'
    }
  }
}))
jest.mock('@hcengineering/preference', () => ({ DOMAIN_PREFERENCE: 'preference' }))
jest.mock('@hcengineering/model-core', () => ({
  getSocialKeyByOldAccount: jest.fn(),
  getUniqueAccountsFromOldAccounts: jest.fn(),
  getAccountUuidByOldAccount: jest.fn(),
  getSocialIdFromOldAccount: jest.fn()
}))
jest.mock('../index', () => ({
  DOMAIN_DOC_NOTIFY: 'doc-notify',
  DOMAIN_NOTIFICATION: 'notification',
  DOMAIN_USER_NOTIFY: 'user-notify'
}))

describe('migrateCollaborators', () => {
  it('skips collection sizes and only removes the old mixin after converting an array', async () => {
    const oldDoc = {
      _id: 'old-doc',
      _class: 'test:class:Doc',
      space: 'test:space',
      mixin: { collaborators: ['old-account'] }
    }
    const currentDoc = {
      _id: 'current-doc',
      _class: 'test:class:Doc',
      space: 'test:space',
      mixin: { collaborators: 1 }
    }
    const iterator = {
      next: jest.fn().mockResolvedValueOnce([oldDoc, currentDoc]).mockResolvedValueOnce([]),
      close: jest.fn()
    }
    const logger = { log: jest.fn(), error: jest.fn() }
    const client = {
      hierarchy: {
        domains: jest.fn(() => ['documents']),
        as: jest.fn((doc: typeof oldDoc | typeof currentDoc) => doc.mixin)
      },
      traverse: jest.fn().mockResolvedValue(iterator),
      bulk: jest.fn(),
      create: jest.fn(),
      logger
    } as unknown as MigrationClient

    await migrateCollaborators(client)

    expect(client.bulk).toHaveBeenCalledWith('documents', [
      {
        filter: { _id: 'old-doc' },
        update: { $unset: { 'notification:mixin:Collaborators': true } }
      }
    ])
    expect(client.create).toHaveBeenCalledWith('collaborator', [
      expect.objectContaining({
        _id: 'collaborator-id',
        collaborator: 'old-account',
        attachedTo: 'old-doc',
        collection: 'collaborators'
      })
    ])
    expect(logger.log).toHaveBeenCalledWith('finished processing domain ', {
      domain: 'documents',
      processed: 2,
      skippedInvalidCollaborators: 1
    })
    expect(iterator.close).toHaveBeenCalled()
  })
})

describe('migrateAccounts', () => {
  it('skips collection sizes and only converts legacy collaborator arrays', async () => {
    const oldDoc = {
      _id: 'old-doc',
      _class: 'test:class:Doc',
      space: 'test:space',
      mixin: { collaborators: ['old-account'] }
    }
    const currentDoc = {
      _id: 'current-doc',
      _class: 'test:class:Doc',
      space: 'test:space',
      mixin: { collaborators: 1 }
    }
    const documentIterator = {
      next: jest.fn().mockResolvedValueOnce([oldDoc, currentDoc]).mockResolvedValueOnce([]),
      close: jest.fn()
    }
    const emptyIterator = {
      next: jest.fn().mockResolvedValue([]),
      close: jest.fn()
    }
    const logger = { log: jest.fn(), error: jest.fn() }
    const client = {
      hierarchy: {
        domains: jest.fn(() => ['documents']),
        as: jest.fn((doc: typeof oldDoc | typeof currentDoc) => doc.mixin)
      },
      traverse: jest.fn().mockResolvedValueOnce(documentIterator).mockResolvedValue(emptyIterator),
      bulk: jest.fn(),
      create: jest.fn(),
      groupBy: jest.fn().mockResolvedValue(new Map()),
      logger
    } as unknown as MigrationClient
    const getSocialKeyByOldAccountMock = jest.mocked(getSocialKeyByOldAccount)
    const getUniqueAccountsFromOldAccountsMock = jest.mocked(getUniqueAccountsFromOldAccounts)
    getSocialKeyByOldAccountMock.mockResolvedValue({})
    getUniqueAccountsFromOldAccountsMock.mockResolvedValue(['new-account' as AccountUuid])

    await migrateAccounts(client)

    expect(getUniqueAccountsFromOldAccountsMock).toHaveBeenCalledTimes(1)
    expect(getUniqueAccountsFromOldAccountsMock).toHaveBeenCalledWith(client, ['old-account'], {}, expect.any(Map))
    expect(client.bulk).toHaveBeenCalledWith('documents', [
      {
        filter: { _id: 'old-doc' },
        update: { $unset: { 'notification:mixin:Collaborators': true } }
      }
    ])
    expect(client.create).toHaveBeenCalledWith('collaborator', [
      expect.objectContaining({
        collaborator: 'new-account',
        attachedTo: 'old-doc',
        collection: 'collaborators'
      })
    ])
    expect(logger.log).toHaveBeenCalledWith('finished processing domain ', {
      domain: 'documents',
      processed: 2,
      skippedInvalidCollaborators: 1
    })
    expect(documentIterator.close).toHaveBeenCalled()
  })
})
