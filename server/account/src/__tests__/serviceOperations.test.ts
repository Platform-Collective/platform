//
// Copyright © 2025 Hardcore Engineering Inc.
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

import {
  type AccountUuid,
  type IntegrationKind,
  type MeasureContext,
  type PersonId,
  type PersonUuid,
  SocialIdType,
  type WorkspaceUuid
} from '@hcengineering/core'
import platform, { PlatformError, Status, Severity } from '@hcengineering/platform'
import { decodeTokenVerbose } from '@hcengineering/server-token'

import {
  type AccountDB,
  type Integration,
  type IntegrationKey,
  type IntegrationSecret,
  type IntegrationSecretKey,
  SubscriptionStatus,
  SubscriptionType,
  type WorkspaceStatus,
  type WorkspaceInfoWithStatus,
  type WorkspaceEvent
} from '../types'
import * as utils from '../utils'
import {
  addSocialIdToPerson,
  createIntegration,
  deleteIntegration,
  deleteIntegrationSecret,
  getIntegration,
  getIntegrationSecret,
  listIntegrations,
  listIntegrationsSecrets,
  updateIntegration,
  updateIntegrationSecret,
  addIntegrationSecret,
  upsertSubscription,
  updateWorkspaceInfo,
  performWorkspaceOperation
} from '../serviceOperations'

// Mock platform
jest.mock('@hcengineering/platform', () => {
  const actual = jest.requireActual('@hcengineering/platform')
  return {
    ...actual,
    ...actual.default,
    getMetadata: jest.fn(),
    translate: jest.fn((id, params) => `${id} << ${JSON.stringify(params)}`)
  }
})

// Mock server-token
jest.mock('@hcengineering/server-token', () => ({
  decodeTokenVerbose: jest.fn(),
  generateToken: jest.fn()
}))

describe('addSocialIdToPerson', () => {
  const mockCtx = {
    error: jest.fn()
  } as unknown as MeasureContext

  const mockDb = {} as unknown as AccountDB
  const mockBranding = null
  const mockToken = 'test-token'

  // Create spy only for this test suite
  const addSocialIdSpy = jest.spyOn(utils, 'addSocialIdBase')

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    // Restore the original implementation
    addSocialIdSpy.mockRestore()
  })

  test('should allow github service to add social id', async () => {
    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
      extra: { service: 'github' }
    })
    const newSocialId = 'new-social-id' as PersonId
    addSocialIdSpy.mockResolvedValue(newSocialId)

    const params = {
      person: 'test-person' as PersonUuid,
      type: SocialIdType.GITHUB,
      value: 'test-value',
      confirmed: true,
      displayValue: 'test-display-value'
    }

    const result = await addSocialIdToPerson(mockCtx, mockDb, mockBranding, mockToken, params)

    expect(result).toBe(newSocialId)
    expect(addSocialIdSpy).toHaveBeenCalledWith(
      mockDb,
      params.person,
      params.type,
      params.value,
      params.confirmed,
      params.displayValue
    )
  })

  test('should allow admin to add social id', async () => {
    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
      extra: { admin: 'true' }
    })
    const newSocialId = 'new-social-id' as PersonId
    addSocialIdSpy.mockResolvedValue(newSocialId)

    const params = {
      person: 'test-person' as PersonUuid,
      type: SocialIdType.GITHUB,
      value: 'test-value',
      confirmed: false,
      displayValue: 'test-display-value'
    }

    const result = await addSocialIdToPerson(mockCtx, mockDb, mockBranding, mockToken, params)

    expect(result).toBe(newSocialId)
    expect(addSocialIdSpy).toHaveBeenCalledWith(
      mockDb,
      params.person,
      params.type,
      params.value,
      params.confirmed,
      params.displayValue
    )
  })

  test('should throw error for unauthorized service', async () => {
    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
      extra: { service: 'other-service' }
    })

    const params = {
      person: 'test-person' as PersonUuid,
      type: SocialIdType.GITHUB,
      value: 'test-value',
      confirmed: false
    }

    await expect(addSocialIdToPerson(mockCtx, mockDb, mockBranding, mockToken, params)).rejects.toThrow(
      new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
    )

    expect(addSocialIdSpy).not.toHaveBeenCalled()
  })

  test('should throw error for regular user', async () => {
    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
      account: 'test-account',
      workspace: 'test-workspace',
      extra: {}
    })

    const params = {
      person: 'test-person' as PersonUuid,
      type: SocialIdType.GITHUB,
      value: 'test-value',
      confirmed: false
    }

    await expect(addSocialIdToPerson(mockCtx, mockDb, mockBranding, mockToken, params)).rejects.toThrow(
      new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
    )

    expect(addSocialIdSpy).not.toHaveBeenCalled()
  })
})

describe('integration methods', () => {
  const mockCtx = {
    error: jest.fn()
  } as unknown as MeasureContext

  const mockDb = {
    workspace: {
      findOne: jest.fn()
    },
    socialId: {
      findOne: jest.fn(),
      find: jest.fn()
    },
    integration: {
      findOne: jest.fn(),
      insertOne: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      find: jest.fn()
    },
    integrationSecret: {
      findOne: jest.fn(),
      insertOne: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      find: jest.fn()
    }
  } as unknown as AccountDB

  const mockBranding = null
  const mockToken = 'test-token'

  const integrationServices = ['github', 'telegram-bot', 'hulygram', 'mailbox']

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createIntegration', () => {
    test('should allow allowed services to create integration', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })

      const mockSocialId = 'test-social-id' as PersonId
      const mockIntegration: Integration = {
        socialId: mockSocialId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        data: {}
      }

      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await createIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)

      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({ _id: mockSocialId, verifiedOn: { $gt: 0 } })
      expect(mockDb.integration.insertOne).toHaveBeenCalledWith(mockIntegration)
    })

    test('should allow verified user to create their integration', async () => {
      const mockAccount = 'test-account'
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })

      const mockSocialId = 'test-social-id' as PersonId
      const mockIntegration: Integration = {
        socialId: mockSocialId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        data: {}
      }

      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await createIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)

      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
      expect(mockDb.integration.insertOne).toHaveBeenCalledWith(mockIntegration)
    })

    test('should throw error when user creates integration for different social id', async () => {
      const mockAccount = 'test-account'
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })

      const mockSocialId = 'test-social-id' as PersonId
      const mockIntegration: Integration = {
        socialId: mockSocialId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        data: {}
      }

      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await expect(createIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
      expect(mockDb.integration.insertOne).not.toHaveBeenCalled()
    })

    test('should throw error when social id not found', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })

      const mockIntegration: Integration = {
        socialId: 'nonexistent-social-id' as PersonId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        data: {}
      }

      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue(null)

      await expect(createIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)).rejects.toThrow(
        new PlatformError(
          new Status(Severity.ERROR, platform.status.SocialIdNotFound, { _id: 'nonexistent-social-id' })
        )
      )

      expect(mockDb.integration.insertOne).not.toHaveBeenCalled()
    })

    test('should throw error when workspace not found', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })

      const mockSocialId = 'test-social-id' as PersonId
      const mockIntegration: Integration = {
        socialId: mockSocialId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'nonexistent-workspace' as WorkspaceUuid,
        data: {}
      }

      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue(null)

      await expect(createIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)).rejects.toThrow(
        new PlatformError(
          new Status(Severity.ERROR, platform.status.WorkspaceNotFound, { workspaceUuid: 'nonexistent-workspace' })
        )
      )

      expect(mockDb.integration.insertOne).not.toHaveBeenCalled()
    })

    test('should throw error when integration already exists', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })

      const mockSocialId = 'test-social-id' as PersonId
      const mockIntegration: Integration = {
        socialId: mockSocialId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        data: {}
      }

      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(mockIntegration)

      await expect(createIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.IntegrationAlreadyExists, {}))
      )

      expect(mockDb.integration.insertOne).not.toHaveBeenCalled()
    })

    test('should throw error for unauthorized service', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'unauthorized-service' }
      })

      const mockIntegration: Integration = {
        socialId: 'test-social-id' as PersonId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        data: {}
      }

      await expect(createIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integration.insertOne).not.toHaveBeenCalled()
    })
  })

  describe('updateIntegration', () => {
    const mockAccount = 'test-account'
    const mockSocialId = 'test-social-id' as PersonId
    const mockIntegration: Integration = {
      socialId: mockSocialId,
      kind: 'test-kind' as IntegrationKind,
      workspaceUuid: 'test-workspace' as WorkspaceUuid,
      data: { someData: 'value' }
    }

    test('should allow allowed service to update integration', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({
        ...mockIntegration,
        data: { oldData: 'old' }
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await updateIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)

      expect(mockDb.integration.update).toHaveBeenCalledWith(
        {
          socialId: mockIntegration.socialId,
          kind: mockIntegration.kind,
          workspaceUuid: mockIntegration.workspaceUuid
        },
        { data: mockIntegration.data }
      )

      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({ _id: mockSocialId, verifiedOn: { $gt: 0 } })
    })

    test('should allow verified user to update their integration', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({
        ...mockIntegration,
        data: { oldData: 'old' }
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await updateIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)

      expect(mockDb.integration.update).toHaveBeenCalledWith(
        {
          socialId: mockIntegration.socialId,
          kind: mockIntegration.kind,
          workspaceUuid: mockIntegration.workspaceUuid
        },
        { data: mockIntegration.data }
      )

      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when use updates integration for different social id', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({
        ...mockIntegration,
        data: { oldData: 'old' }
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue(null)

      await expect(updateIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integration.update).not.toHaveBeenCalled()

      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when integration not found', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })

      await expect(updateIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.IntegrationNotFound, {}))
      )

      expect(mockDb.integration.update).not.toHaveBeenCalled()
    })

    test('should throw error for unauthorized service', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'unauthorized-service' }
      })

      await expect(updateIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegration)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integration.update).not.toHaveBeenCalled()
    })
  })

  describe('deleteIntegration', () => {
    const mockAccount = 'test-account'
    const mockSocialId = 'test-social-id' as PersonId
    const mockIntegrationKey: IntegrationKey = {
      socialId: mockSocialId,
      kind: 'test-kind' as IntegrationKind,
      workspaceUuid: 'test-workspace' as WorkspaceUuid
    }

    test('should allow allowed service to delete integration', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({
        ...mockIntegrationKey,
        data: {}
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await deleteIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegrationKey)

      expect(mockDb.integration.deleteMany).toHaveBeenCalledWith(mockIntegrationKey)
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({ _id: mockSocialId, verifiedOn: { $gt: 0 } })
    })

    test('should allow verified user to delete their integration', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({
        ...mockIntegrationKey,
        data: {}
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await deleteIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegrationKey)

      expect(mockDb.integration.deleteMany).toHaveBeenCalledWith(mockIntegrationKey)
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when user deletes integration for different social id', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({
        ...mockIntegrationKey,
        data: {}
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await expect(deleteIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegrationKey)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integration.deleteMany).not.toHaveBeenCalled()
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when integration not found', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })

      await expect(deleteIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegrationKey)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.IntegrationNotFound, {}))
      )

      expect(mockDb.integration.deleteMany).not.toHaveBeenCalled()
    })

    test('should throw error for unauthorized service', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'unauthorized-service' }
      })

      await expect(deleteIntegration(mockCtx, mockDb, mockBranding, mockToken, mockIntegrationKey)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integration.deleteMany).not.toHaveBeenCalled()
    })
  })

  describe('getIntegration', () => {
    const mockAccount = 'test-account'
    const mockSocialId = 'test-social-id' as PersonId
    const mockKey: IntegrationKey = {
      socialId: mockSocialId,
      kind: 'test-kind' as IntegrationKind,
      workspaceUuid: 'test-workspace' as WorkspaceUuid
    }

    test('should allow verified user to get their integration', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount,
        extra: {}
      })

      const mockIntegration: Integration = {
        ...mockKey,
        data: {}
      }

      ;(mockDb.socialId.find as jest.Mock).mockResolvedValue([
        { _id: mockKey.socialId, personUuid: mockAccount, verifiedOn: 1 }
      ])
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(mockIntegration)
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })

      const result = await getIntegration(mockCtx, mockDb, mockBranding, mockToken, mockKey)
      expect(result).toEqual(mockIntegration)
      expect(mockDb.integration.findOne).toHaveBeenCalledWith(mockKey)
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when there is no matching verified social id', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: 'test-account',
        extra: {}
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue(null)

      await expect(getIntegration(mockCtx, mockDb, mockBranding, mockToken, mockKey)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )
      expect(mockDb.integration.findOne).not.toHaveBeenCalled()
    })

    test('should allow all integration services to get integration', async () => {
      for (const service of integrationServices) {
        ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
          extra: { service }
        })

        const mockIntegration: Integration = {
          ...mockKey,
          data: {}
        }

        ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(mockIntegration)

        const result = await getIntegration(mockCtx, mockDb, mockBranding, mockToken, mockKey)
        expect(result).toEqual(mockIntegration)
      }
    })

    test('should throw error for unauthorized service', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'unauthorized-service' }
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue(null)

      await expect(getIntegration(mockCtx, mockDb, mockBranding, mockToken, mockKey)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )
      expect(mockDb.integration.findOne).not.toHaveBeenCalled()
    })

    test('should return null when integration not found', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(null)

      const result = await getIntegration(mockCtx, mockDb, mockBranding, mockToken, mockKey)
      expect(result).toBeNull()
    })
  })

  describe('listIntegrations', () => {
    const mockSocialId = 'test-social-id' as PersonId
    const mockIntegration: Integration = {
      socialId: mockSocialId,
      kind: 'test-kind' as IntegrationKind,
      workspaceUuid: 'test-workspace' as WorkspaceUuid,
      data: {}
    }

    test('should allow service to list all integrations without filters', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integration.find as jest.Mock).mockResolvedValue([mockIntegration])

      const result = await listIntegrations(mockCtx, mockDb, mockBranding, mockToken, {})

      expect(result).toEqual([mockIntegration])
      expect(mockDb.integration.find).toHaveBeenCalledWith({ kind: undefined, workspaceUuid: undefined })
    })

    test('should allow service to list integrations with specific socialId', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integration.find as jest.Mock).mockResolvedValue([mockIntegration])

      const result = await listIntegrations(mockCtx, mockDb, mockBranding, mockToken, {
        socialId: mockSocialId
      })

      expect(result).toEqual([mockIntegration])
      expect(mockDb.integration.find).toHaveBeenCalledWith({
        socialId: { $in: [mockSocialId] },
        kind: undefined,
        workspaceUuid: undefined
      })
    })

    test('should allow service to filter by kind and workspace', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integration.find as jest.Mock).mockResolvedValue([mockIntegration])

      const result = await listIntegrations(mockCtx, mockDb, mockBranding, mockToken, {
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid
      })

      expect(result).toEqual([mockIntegration])
      expect(mockDb.integration.find).toHaveBeenCalledWith({
        kind: 'test-kind',
        workspaceUuid: 'test-workspace'
      })
    })

    test('should allow service to filter by null workspace', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integration.find as jest.Mock).mockResolvedValue([mockIntegration])

      const result = await listIntegrations(mockCtx, mockDb, mockBranding, mockToken, {
        workspaceUuid: null
      })

      expect(result).toEqual([mockIntegration])
      expect(mockDb.integration.find).toHaveBeenCalledWith({
        kind: undefined,
        workspaceUuid: null
      })
    })

    test('should allow regular user to list their verified integrations', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: 'test-account',
        extra: {}
      })

      const verifiedSocialIds = [
        { _id: mockSocialId, personUuid: 'test-account', verifiedOn: 1 },
        { _id: 'another-social-id' as PersonId, personUuid: 'test-account', verifiedOn: 1 }
      ]
      ;(mockDb.socialId.find as jest.Mock).mockResolvedValue(verifiedSocialIds)
      ;(mockDb.integration.find as jest.Mock).mockResolvedValue([mockIntegration])

      const result = await listIntegrations(mockCtx, mockDb, mockBranding, mockToken, {})

      expect(result).toEqual([mockIntegration])
      expect(mockDb.integration.find).toHaveBeenCalledWith({
        socialId: { $in: verifiedSocialIds.map((s) => s._id) },
        kind: undefined,
        workspaceUuid: undefined
      })
    })

    test('should allow user to filter their integrations by specific socialId', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: 'test-account',
        extra: {}
      })

      const verifiedSocialIds = [{ _id: mockSocialId, personUuid: 'test-account', verifiedOn: 1 }]
      ;(mockDb.socialId.find as jest.Mock).mockResolvedValue(verifiedSocialIds)
      ;(mockDb.integration.find as jest.Mock).mockResolvedValue([mockIntegration])

      const result = await listIntegrations(mockCtx, mockDb, mockBranding, mockToken, {
        socialId: mockSocialId
      })

      expect(result).toEqual([mockIntegration])
      expect(mockDb.integration.find).toHaveBeenCalledWith({
        socialId: { $in: [mockSocialId] },
        kind: undefined,
        workspaceUuid: undefined
      })
    })

    test('should throw error when user has no verified social ids', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: 'test-account',
        extra: {}
      })
      ;(mockDb.socialId.find as jest.Mock).mockResolvedValue([])

      await expect(listIntegrations(mockCtx, mockDb, mockBranding, mockToken, {})).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integration.find).not.toHaveBeenCalled()
    })

    test('should throw error when user requests unauthorized socialId', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: 'test-account',
        extra: {}
      })

      const verifiedSocialIds = [{ _id: 'other-social-id' as PersonId, personUuid: 'test-account', verifiedOn: 1 }]
      ;(mockDb.socialId.find as jest.Mock).mockResolvedValue(verifiedSocialIds)

      await expect(
        listIntegrations(mockCtx, mockDb, mockBranding, mockToken, {
          socialId: mockSocialId // Not in user's verified social ids
        })
      ).rejects.toThrow(new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {})))

      expect(mockDb.integration.find).not.toHaveBeenCalled()
    })

    test('should throw error for unauthorized service', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'unauthorized-service' }
      })
      ;(mockDb.socialId.find as jest.Mock).mockResolvedValue([])

      await expect(listIntegrations(mockCtx, mockDb, mockBranding, mockToken, {})).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integration.find).not.toHaveBeenCalled()
    })
  })

  describe('addIntegrationSecret', () => {
    test('should allow allowed services to create integration secret', async () => {
      for (const service of integrationServices) {
        jest.clearAllMocks()
        ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
          extra: { service }
        })

        const mockSocialId = 'test-social-id' as PersonId
        const mockSecret: IntegrationSecret = {
          socialId: mockSocialId,
          kind: 'test-kind' as IntegrationKind,
          workspaceUuid: 'test-workspace' as WorkspaceUuid,
          key: 'test-key',
          secret: 'test-secret'
        }

        const mockIntegration: Integration = {
          socialId: mockSecret.socialId,
          kind: mockSecret.kind,
          workspaceUuid: mockSecret.workspaceUuid,
          data: {}
        }

        ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(mockIntegration)
        ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue(null)
        ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
        ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

        await addIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)

        expect(mockDb.integrationSecret.insertOne).toHaveBeenCalledWith(mockSecret)
        expect(mockDb.socialId.findOne).toHaveBeenCalledWith({ _id: mockSocialId, verifiedOn: { $gt: 0 } })
      }
    })

    test('should allow verified user services to create their integration secret', async () => {
      jest.clearAllMocks()
      const mockAccount = 'test-account'
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })

      const mockSocialId = 'test-social-id' as PersonId
      const mockSecret: IntegrationSecret = {
        socialId: mockSocialId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        key: 'test-key',
        secret: 'test-secret'
      }

      const mockIntegration: Integration = {
        socialId: mockSecret.socialId,
        kind: mockSecret.kind,
        workspaceUuid: mockSecret.workspaceUuid,
        data: {}
      }

      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(mockIntegration)
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await addIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)

      expect(mockDb.integrationSecret.insertOne).toHaveBeenCalledWith(mockSecret)
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when user services adds integration secret for different social id', async () => {
      jest.clearAllMocks()
      const mockAccount = 'test-account'
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })

      const mockSocialId = 'test-social-id' as PersonId
      const mockSecret: IntegrationSecret = {
        socialId: mockSocialId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        key: 'test-key',
        secret: 'test-secret'
      }

      const mockIntegration: Integration = {
        socialId: mockSecret.socialId,
        kind: mockSecret.kind,
        workspaceUuid: mockSecret.workspaceUuid,
        data: {}
      }

      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(mockIntegration)
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue(null)

      await expect(addIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integrationSecret.insertOne).not.toHaveBeenCalled()
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when integration does not exist', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })

      const mockSocialId = 'test-social-id' as PersonId
      const mockSecret: IntegrationSecret = {
        socialId: mockSocialId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        key: 'test-key',
        secret: 'test-secret'
      }

      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await expect(addIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.IntegrationNotFound, {}))
      )

      expect(mockDb.integrationSecret.insertOne).not.toHaveBeenCalled()
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({ _id: mockSocialId, verifiedOn: { $gt: 0 } })
    })

    test('should throw error if secret already exists', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })

      const mockSecret: IntegrationSecret = {
        socialId: 'test-social-id' as PersonId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        key: 'test-key',
        secret: 'test-secret'
      }

      const mockIntegration: Integration = {
        socialId: mockSecret.socialId,
        kind: mockSecret.kind,
        workspaceUuid: mockSecret.workspaceUuid,
        data: {}
      }

      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue(mockIntegration)
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue(mockSecret)

      await expect(addIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.IntegrationSecretAlreadyExists, {}))
      )

      expect(mockDb.integrationSecret.insertOne).not.toHaveBeenCalled()
    })

    test('should throw for unauthorized service', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'unauthorized-service' }
      })

      const mockSecret: IntegrationSecret = {
        socialId: 'test-social-id' as PersonId,
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid,
        key: 'test-key',
        secret: 'test-secret'
      }

      await expect(addIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integrationSecret.insertOne).not.toHaveBeenCalled()
    })
  })

  describe('updateIntegrationSecret', () => {
    const mockAccount = 'test-account'
    const mockSocialId = 'test-social-id' as PersonId
    const mockSecret: IntegrationSecret = {
      socialId: mockSocialId,
      kind: 'test-kind' as IntegrationKind,
      workspaceUuid: 'test-workspace' as WorkspaceUuid,
      key: 'test-key',
      secret: 'new-secret'
    }

    const mockSecretKey: IntegrationSecretKey = {
      socialId: mockSecret.socialId,
      kind: mockSecret.kind,
      workspaceUuid: mockSecret.workspaceUuid,
      key: mockSecret.key
    }

    test('should allow allowed service to update secret', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue({
        ...mockSecret,
        secret: 'old-secret'
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({})

      await updateIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)

      expect(mockDb.integrationSecret.update).toHaveBeenCalledWith(mockSecretKey, { secret: mockSecret.secret })
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({ _id: mockSocialId, verifiedOn: { $gt: 0 } })
    })

    test('should allow verified user to update their secret', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue({
        ...mockSecret,
        secret: 'old-secret'
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({})

      await updateIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)

      expect(mockDb.integrationSecret.update).toHaveBeenCalledWith(mockSecretKey, { secret: mockSecret.secret })
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when user updates secret for different social id', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue({
        ...mockSecret,
        secret: 'old-secret'
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })

      await expect(updateIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integrationSecret.update).not.toHaveBeenCalledWith()
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when secret not found', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })

      await expect(updateIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.IntegrationSecretNotFound, {}))
      )

      expect(mockDb.integrationSecret.update).not.toHaveBeenCalled()
    })

    test('should throw error for unauthorized service', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'unauthorized-service' }
      })

      await expect(updateIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecret)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integrationSecret.findOne).not.toHaveBeenCalled()
      expect(mockDb.integrationSecret.update).not.toHaveBeenCalled()
    })
  })

  describe('deleteIntegrationSecret', () => {
    const mockAccount = 'test-account'
    const mockSocialId = 'test-social-id' as PersonId
    const mockSecretKey: IntegrationSecretKey = {
      socialId: mockSocialId,
      kind: 'test-kind' as IntegrationKind,
      workspaceUuid: 'test-workspace' as WorkspaceUuid,
      key: 'test-key'
    }

    test('should allow allowed service to delete secret', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue({
        ...mockSecretKey,
        secret: 'test-secret'
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({})

      await deleteIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecretKey)

      expect(mockDb.integrationSecret.deleteMany).toHaveBeenCalledWith(mockSecretKey)
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({ _id: mockSocialId, verifiedOn: { $gt: 0 } })
    })

    test('should allow verified user to delete their secret', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue({
        ...mockSecretKey,
        secret: 'test-secret'
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({})

      await deleteIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecretKey)

      expect(mockDb.integrationSecret.deleteMany).toHaveBeenCalledWith(mockSecretKey)
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when user deletes secret for different social id', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        account: mockAccount
      })
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue({
        ...mockSecretKey,
        secret: 'test-secret'
      })
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.workspace.findOne as jest.Mock).mockResolvedValue({ uuid: 'test-workspace' })
      ;(mockDb.integration.findOne as jest.Mock).mockResolvedValue({})

      await expect(deleteIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecretKey)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integrationSecret.deleteMany).not.toHaveBeenCalledWith()
      expect(mockDb.socialId.findOne).toHaveBeenCalledWith({
        _id: mockSocialId,
        personUuid: mockAccount,
        verifiedOn: { $gt: 0 }
      })
    })

    test('should throw error when secret not found', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })

      await expect(deleteIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecretKey)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.IntegrationSecretNotFound, {}))
      )

      expect(mockDb.integrationSecret.deleteMany).not.toHaveBeenCalled()
    })

    test('should throw error for unauthorized service', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'unauthorized-service' }
      })

      await expect(deleteIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecretKey)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integrationSecret.deleteMany).not.toHaveBeenCalled()
    })
  })

  describe('getIntegrationSecret', () => {
    const mockSocialId = 'test-social-id' as PersonId
    const mockSecretKey: IntegrationSecretKey = {
      socialId: mockSocialId,
      kind: 'test-kind' as IntegrationKind,
      workspaceUuid: 'test-workspace' as WorkspaceUuid,
      key: 'test-key'
    }

    const mockSecret: IntegrationSecret = {
      ...mockSecretKey,
      secret: 'test-secret'
    }

    test('should allow allowed service to get secret', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue(mockSecret)

      const result = await getIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecretKey)

      expect(result).toEqual(mockSecret)
      expect(mockDb.integrationSecret.findOne).toHaveBeenCalledWith(mockSecretKey)
    })

    test('should return null when integration secret not found', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integrationSecret.findOne as jest.Mock).mockResolvedValue(null)
      ;(mockDb.socialId.findOne as jest.Mock).mockResolvedValue({ _id: mockSocialId })

      const result = await getIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecretKey)
      expect(result).toBeNull()
    })

    test('should throw error for unauthorized service', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'unauthorized-service' }
      })

      await expect(getIntegrationSecret(mockCtx, mockDb, mockBranding, mockToken, mockSecretKey)).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integrationSecret.findOne).not.toHaveBeenCalled()
    })
  })

  describe('listIntegrationsSecrets', () => {
    const mockSocialId = 'test-social-id' as PersonId
    const mockSecret: IntegrationSecret = {
      socialId: mockSocialId,
      kind: 'test-kind' as IntegrationKind,
      workspaceUuid: 'test-workspace' as WorkspaceUuid,
      key: 'test-key',
      secret: 'test-secret'
    }

    test('should allow service to list all secrets without filters', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integrationSecret.find as jest.Mock).mockResolvedValue([mockSecret])

      const result = await listIntegrationsSecrets(mockCtx, mockDb, mockBranding, mockToken, {})

      expect(result).toEqual([mockSecret])
      expect(mockDb.integrationSecret.find).toHaveBeenCalledWith({
        socialId: undefined,
        kind: undefined,
        workspaceUuid: undefined
      })
    })

    test('should allow service to filter by socialId', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integrationSecret.find as jest.Mock).mockResolvedValue([mockSecret])

      const result = await listIntegrationsSecrets(mockCtx, mockDb, mockBranding, mockToken, {
        socialId: mockSocialId
      })

      expect(result).toEqual([mockSecret])
      expect(mockDb.integrationSecret.find).toHaveBeenCalledWith({
        socialId: mockSocialId,
        kind: undefined,
        workspaceUuid: undefined
      })
    })

    test('should allow service to filter by kind and workspace', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integrationSecret.find as jest.Mock).mockResolvedValue([mockSecret])

      const result = await listIntegrationsSecrets(mockCtx, mockDb, mockBranding, mockToken, {
        kind: 'test-kind' as IntegrationKind,
        workspaceUuid: 'test-workspace' as WorkspaceUuid
      })

      expect(result).toEqual([mockSecret])
      expect(mockDb.integrationSecret.find).toHaveBeenCalledWith({
        kind: 'test-kind',
        workspaceUuid: 'test-workspace',
        socialId: undefined
      })
    })

    test('should allow service to filter by null workspace', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'github' }
      })
      ;(mockDb.integrationSecret.find as jest.Mock).mockResolvedValue([mockSecret])

      const result = await listIntegrationsSecrets(mockCtx, mockDb, mockBranding, mockToken, {
        workspaceUuid: null
      })

      expect(result).toEqual([mockSecret])
      expect(mockDb.integrationSecret.find).toHaveBeenCalledWith({
        kind: undefined,
        workspaceUuid: null,
        socialId: undefined
      })
    })

    test('should throw error for unauthorized service', async () => {
      ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
        extra: { service: 'unauthorized-service' }
      })

      await expect(listIntegrationsSecrets(mockCtx, mockDb, mockBranding, mockToken, {})).rejects.toThrow(
        new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      )

      expect(mockDb.integrationSecret.find).not.toHaveBeenCalled()
    })
  })
})

describe('upsertSubscription', () => {
  const mockCtx = {
    error: jest.fn(),
    info: jest.fn()
  } as unknown as MeasureContext

  const mockBranding = null
  const mockToken = 'test-token'

  let mockDb: any
  let getWorkspaceByIdSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()

    mockDb = {
      subscription: {
        findOne: jest.fn(),
        insertOne: jest.fn(),
        update: jest.fn()
      }
    }

    // Mock getWorkspaceById utility function
    getWorkspaceByIdSpy = jest.spyOn(utils, 'getWorkspaceById')
  })

  afterAll(() => {
    getWorkspaceByIdSpy.mockRestore()
  })

  test('should create new subscription', async () => {
    const workspaceUuid = 'test-workspace' as WorkspaceUuid
    const accountUuid = 'test-account' as AccountUuid

    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
      extra: { service: 'payment' }
    })

    getWorkspaceByIdSpy.mockResolvedValue({ uuid: workspaceUuid })
    mockDb.subscription.findOne.mockResolvedValue(null)

    const subscriptionData = {
      id: 'sub-123',
      workspaceUuid,
      accountUuid,
      provider: 'polar',
      providerSubscriptionId: 'polar-sub-123',
      providerCheckoutId: 'checkout-456',
      type: SubscriptionType.Tier,
      status: SubscriptionStatus.Active,
      plan: 'pro'
    }

    await upsertSubscription(mockCtx, mockDb, mockBranding, mockToken, subscriptionData)

    expect(getWorkspaceByIdSpy).toHaveBeenCalledWith(mockDb, workspaceUuid)
    expect(mockDb.subscription.findOne).toHaveBeenCalledWith({
      provider: 'polar',
      providerSubscriptionId: 'polar-sub-123'
    })
    expect(mockDb.subscription.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sub-123',
        workspaceUuid,
        accountUuid,
        provider: 'polar',
        providerSubscriptionId: 'polar-sub-123',
        status: 'active',
        plan: 'pro'
      })
    )
  })

  test('should update existing subscription', async () => {
    const workspaceUuid = 'test-workspace' as WorkspaceUuid
    const accountUuid = 'test-account' as AccountUuid

    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
      extra: { service: 'payment' }
    })

    const existingSubscription = {
      id: 'existing-sub-id',
      workspaceUuid,
      provider: 'polar',
      providerSubscriptionId: 'polar-sub-123'
    }

    getWorkspaceByIdSpy.mockResolvedValue({ uuid: workspaceUuid })
    mockDb.subscription.findOne.mockResolvedValue(existingSubscription)

    const subscriptionData = {
      id: 'sub-123',
      workspaceUuid,
      accountUuid,
      provider: 'polar',
      providerSubscriptionId: 'polar-sub-123',
      type: SubscriptionType.Tier,
      status: SubscriptionStatus.Canceled,
      plan: 'pro',
      canceledAt: Date.now()
    }

    await upsertSubscription(mockCtx, mockDb, mockBranding, mockToken, subscriptionData)

    expect(mockDb.subscription.update).toHaveBeenCalledWith(
      { id: 'existing-sub-id' },
      expect.objectContaining({
        status: 'canceled',
        canceledAt: subscriptionData.canceledAt
      })
    )
    expect(mockDb.subscription.insertOne).not.toHaveBeenCalled()
  })

  test('should reject non-billing service', async () => {
    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
      extra: { service: 'other-service' }
    })

    const subscriptionData = {
      workspaceUuid: 'test-workspace' as WorkspaceUuid,
      provider: 'polar',
      providerSubscriptionId: 'polar-sub-123'
    } as any

    await expect(upsertSubscription(mockCtx, mockDb, mockBranding, mockToken, subscriptionData)).rejects.toThrow(
      new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
    )

    expect(mockDb.subscription.findOne).not.toHaveBeenCalled()
  })

  test('should reject if workspace not found', async () => {
    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
      extra: { service: 'billing' }
    })

    getWorkspaceByIdSpy.mockResolvedValue(null)

    const subscriptionData = {
      workspaceUuid: 'nonexistent-workspace' as WorkspaceUuid,
      provider: 'polar',
      providerSubscriptionId: 'polar-sub-123'
    } as any

    await expect(upsertSubscription(mockCtx, mockDb, mockBranding, mockToken, subscriptionData)).rejects.toThrow(
      PlatformError
    )

    expect(mockDb.subscription.findOne).not.toHaveBeenCalled()
  })

  test('should handle subscription with optional fields', async () => {
    const workspaceUuid = 'test-workspace' as WorkspaceUuid
    const accountUuid = 'test-account' as AccountUuid

    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({
      extra: { service: 'payment' }
    })

    getWorkspaceByIdSpy.mockResolvedValue({ uuid: workspaceUuid })
    mockDb.subscription.findOne.mockResolvedValue(null)

    const subscriptionData = {
      id: 'sub-123',
      workspaceUuid,
      accountUuid,
      provider: 'polar',
      providerSubscriptionId: 'polar-sub-123',
      providerCheckoutId: 'checkout-456',
      type: SubscriptionType.Tier,
      status: SubscriptionStatus.Trialing,
      plan: 'storage-100gb',
      periodStart: Date.now(),
      periodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
      trialEnd: Date.now() + 7 * 24 * 60 * 60 * 1000,
      providerData: {
        customerExternalId: 'cus_123',
        metadata: { source: 'website' }
      }
    }

    await upsertSubscription(mockCtx, mockDb, mockBranding, mockToken, subscriptionData)

    expect(mockDb.subscription.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCheckoutId: 'checkout-456',
        trialEnd: subscriptionData.trialEnd,
        providerData: subscriptionData.providerData
      })
    )
  })
})

describe('restore lifecycle', () => {
  const workspaceUuid = 'restore-workspace' as WorkspaceUuid
  const version = { major: 1, minor: 0, patch: 0 }
  const ctx = { info: jest.fn() } as unknown as MeasureContext
  let status: WorkspaceStatus
  let db: AccountDB

  async function event (event: WorkspaceEvent, message?: string): Promise<void> {
    await updateWorkspaceInfo(ctx, db, null, 'worker', { workspaceUuid, version, event, progress: 0, message })
  }

  async function retry (admin = true, tokenWorkspace = workspaceUuid): Promise<void> {
    jest.mocked(decodeTokenVerbose).mockReturnValue({
      account: 'test-account' as AccountUuid,
      workspace: tokenWorkspace,
      extra: admin ? { admin: 'true' } : {}
    })
    await performWorkspaceOperation(ctx, db, null, 'user', {
      workspaceId: workspaceUuid,
      event: 'unarchive',
      params: []
    })
    jest.mocked(decodeTokenVerbose).mockReturnValue({
      account: 'test-account' as AccountUuid,
      workspace: workspaceUuid,
      extra: { service: 'workspace' }
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    status = {
      workspaceUuid,
      mode: 'pending-restore',
      processingAttempts: 0,
      isDisabled: false,
      versionMajor: 1,
      versionMinor: 0,
      versionPatch: 0
    }
    const update = jest.fn(async (query: Record<string, unknown>, changes: Partial<WorkspaceStatus>) => {
      const matches = Object.entries(query).every(([key, expected]) => {
        const actual = status[key as keyof WorkspaceStatus]
        if (expected != null && typeof expected === 'object') {
          const op = expected as { $in?: unknown[], $ne?: unknown, $lte?: number }
          if (op.$in !== undefined) return op.$in.includes(actual)
          if ('$ne' in op) return actual !== op.$ne
          if (op.$lte !== undefined) return actual == null || Number(actual) <= op.$lte
        }
        return actual === expected
      })
      if (matches) Object.assign(status, changes)
    })
    db = {
      workspace: { exists: jest.fn().mockResolvedValue(true), update: jest.fn() },
      workspaceStatus: { findOne: jest.fn(async () => ({ ...status })), update }
    } as unknown as AccountDB
    jest.mocked(decodeTokenVerbose).mockReturnValue({
      account: 'test-account' as AccountUuid,
      workspace: workspaceUuid,
      extra: { service: 'workspace' }
    })
    jest
      .spyOn(utils, 'getWorkspacesInfoWithStatusByIds')
      .mockImplementation(async () => [{ uuid: workspaceUuid, status } as unknown as WorkspaceInfoWithStatus])
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test.each(['unarchive', 'migration'] as const)('%s fails after exactly three claimed attempts', async (entry) => {
    status.processingAttempts = 12
    if (entry === 'unarchive') {
      status.mode = 'archived'
      await retry()
    } else {
      status.mode = 'migration-clean'
      await event('migrate-clean-done')
    }
    expect(status.processingAttempts).toBe(0)
    for (let claim = 1; claim <= 3; claim++) {
      status.processingAttempts = (status.processingAttempts ?? 0) + 1
      await event('restore-started')
      await event('restore-started') // A duplicate start must not erase the claim.
      expect(status.processingAttempts).toBe(claim)
      await event('restore-failed', 'secret storage endpoint and credentials')
      expect(status.mode).toBe(claim === 3 ? 'restore-failed' : 'restoring')
      expect(status.processingMessage).toBe('Restore failed. Retry or contact support.')
    }
    const failed = { ...status }
    await event('restore-started')
    await event('restore-done')
    await event('restore-failed')
    expect(status).toEqual(failed)
    await event('ping')
    await event('progress')
    expect(status).toMatchObject({ mode: 'restore-failed', processingMessage: failed.processingMessage })
  })

  test('late failures and starts cannot change a successful restore', async () => {
    status.processingAttempts = 3
    await event('restore-started')
    await event('restore-done')
    await event('restore-failed')
    await event('restore-started')
    expect(status.mode).toBe('active')
  })

  test('an old failure cannot change pending retry or a retry racing the status update', async () => {
    status.mode = 'restore-failed'
    await retry()
    await event('restore-failed')
    expect(status.mode).toBe('pending-restore')
    status.mode = 'restoring'
    status.processingAttempts = 3
    jest.mocked(db.workspaceStatus.findOne).mockImplementationOnce(async () => {
      const previous = { ...status }
      status.mode = 'pending-restore'
      status.processingAttempts = 0
      return previous
    })
    await event('restore-failed')
    expect(status.mode).toBe('pending-restore')
    expect(status.processingAttempts).toBe(0)
  })

  test('a failure cannot terminate a newer claim racing the status update', async () => {
    status.mode = 'restoring'
    status.processingAttempts = 3
    jest.mocked(db.workspaceStatus.findOne).mockImplementationOnce(async () => {
      const previous = { ...status }
      status.processingAttempts = 4
      return previous
    })
    await event('restore-failed')
    expect(status.mode).toBe('restoring')
    expect(status.processingAttempts).toBe(4)
  })

  test('lease expiry preserves claims and a heartbeat without a message preserves the failure reason', async () => {
    status.processingAttempts = 2
    await event('restore-started')
    await event('restore-failed')
    await event('ping')
    expect(status.processingMessage).toBe('Restore failed. Retry or contact support.')
    status.lastProcessingTime = 0
    status.processingAttempts++
    await event('restore-started')
    await event('restore-failed')
    expect(status.mode).toBe('restore-failed')
  })

  test.each(['ping', 'progress'] as const)('%s without a message preserves the failure reason', async (name) => {
    status.mode = 'restoring'
    await event('restore-failed')
    await event(name)
    expect(status.processingMessage).toBe('Restore failed. Retry or contact support.')
  })

  test.each(['creating', 'upgrading', 'archiving-backup'] as const)(
    'empty ping and progress messages clear stale messages while %s',
    async (mode) => {
      status.mode = mode
      for (const name of ['ping', 'progress'] as const) {
        status.processingMessage = 'Previous step failed'
        await event(name, '')
        expect(status.processingMessage).toBe('')
      }
    }
  )

  test('restore events pass mode and attempt guards to the status collection', async () => {
    await event('restore-started')
    expect(db.workspaceStatus.update).toHaveBeenLastCalledWith(
      { workspaceUuid, mode: { $in: ['pending-restore', 'restoring'] } },
      expect.objectContaining({ mode: 'restoring' })
    )
    status.processingAttempts = 3
    await event('restore-failed')
    expect(db.workspaceStatus.update).toHaveBeenLastCalledWith(
      { workspaceUuid, mode: 'restoring', processingAttempts: 3 },
      expect.objectContaining({ mode: 'restore-failed' })
    )
    status.mode = 'restoring'
    await event('restore-done')
    expect(db.workspaceStatus.update).toHaveBeenLastCalledWith(
      { workspaceUuid, mode: 'restoring' },
      expect.objectContaining({ mode: 'active' })
    )
  })

  test.each([true, false])('failed restore can be retried with admin=%s', async (admin) => {
    status.mode = 'restore-failed'
    status.processingAttempts = 3
    await retry(admin, admin ? ('another-workspace' as WorkspaceUuid) : workspaceUuid)
    expect(status).toMatchObject({ mode: 'pending-restore', processingAttempts: 0, processingProgress: 0 })
    expect(status.lastProcessingTime).toBeLessThanOrEqual(Date.now() - 30000)
  })

  test('retry keeps existing permission and mode restrictions', async () => {
    status.mode = 'restore-failed'
    await expect(retry(false, 'another-workspace' as WorkspaceUuid)).rejects.toThrow()
    status.mode = 'active'
    await expect(retry()).rejects.toThrow()
  })
})
