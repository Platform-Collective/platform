// SPDX-License-Identifier: EPL-2.0

import core, { TxFactory, TxProcessor } from '@hcengineering/core'
import type { Client, MeasureContext, PersonId, Tx, TxUpdateDoc, WorkspaceUuid } from '@hcengineering/core'
import gmail from '@hcengineering/gmail'
import type { NewMessage } from '@hcengineering/gmail'
import type { StorageAdapter } from '@hcengineering/server-core'
import { getClient } from '../client'
import type { ProjectCredentials } from '../types'
import { WorkspaceClient } from '../workspaceClient'

jest.mock('../client', () => ({ getClient: jest.fn() }))
jest.mock('../gmail', () => ({ GmailClient: {} }))
jest.mock('../accounts', () => ({ getAccountSocialIds: jest.fn() }))
jest.mock('../integrations', () => ({ cleanIntegrations: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({ generateToken: jest.fn().mockReturnValue('token') }))

interface TestWorkspaceClient extends Pick<WorkspaceClient, 'getGmailClient' | 'getNewMessages' | 'subscribeMessages'> {
  txHandler: (...tx: Tx[]) => Promise<void>
}

describe('WorkspaceClient outgoing messages', () => {
  const sender = 'sender' as PersonId
  const creator = 'creator' as PersonId
  const modifier = 'modifier' as PersonId
  const factory = new TxFactory(creator)
  const createTx = factory.createTxCreateDoc(gmail.class.NewMessage, core.space.Workspace, {
    from: sender,
    to: 'recipient@example.com',
    subject: 'Test message',
    content: '<p>Hello</p>',
    status: 'new'
  })
  const mockClient = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    tx: jest.fn(),
    getHierarchy: () => ({ isDerived: (child: string, parent: string) => child === parent })
  }
  const createMessage = jest.fn()
  let workspace: TestWorkspaceClient
  let message: NewMessage
  let getGmailClient: jest.SpyInstance

  beforeEach(async () => {
    jest.clearAllMocks()
    message = { ...TxProcessor.createDoc2Doc(createTx), modifiedBy: modifier }
    mockClient.findAll.mockResolvedValue([])
    mockClient.findOne.mockImplementation(async () => message)
    mockClient.tx.mockImplementation(async (tx: TxUpdateDoc<NewMessage>) => {
      Object.assign(message, tx.operations)
      return {}
    })
    createMessage.mockResolvedValue(undefined)
    jest.mocked(getClient).mockResolvedValue(mockClient as unknown as Client)
    workspace = (await WorkspaceClient.create(
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as MeasureContext,
      {} as unknown as ProjectCredentials,
      {} as unknown as StorageAdapter,
      'workspace' as WorkspaceUuid
    )) as unknown as TestWorkspaceClient
    getGmailClient = jest.spyOn(workspace, 'getGmailClient').mockReturnValue(undefined)
    await workspace.subscribeMessages()
  })

  function expectUnavailableError (): void {
    expect(mockClient.tx).toHaveBeenCalledWith(
      expect.objectContaining({
        _class: core.class.TxUpdateDoc,
        objectClass: message._class,
        objectSpace: message.space,
        objectId: message._id,
        modifiedBy: sender,
        operations: { status: 'error', error: expect.any(String) }
      })
    )
    expect(message.status).toBe('error')
    const error = JSON.parse(message.error ?? '{}')
    expect(error.data.error).toBe('integration_unavailable')
    expect(error.data.error_description).toMatch(/Gmail.*unavailable/)
    expect(error.data.error_description).toMatch(/reconnect/i)
    expect(error.data.error_description).toMatch(/resend/i)
    expect(createMessage).not.toHaveBeenCalled()
  }

  it('marks pending messages as errors when the sender integration is absent', async () => {
    mockClient.findAll.mockResolvedValue([message])

    await workspace.getNewMessages()

    expectUnavailableError()
  })

  it('marks live messages as errors when the sender integration is absent', async () => {
    await workspace.txHandler(createTx)

    expectUnavailableError()
  })

  it('marks a resend as an error again while disconnected, then sends after reconnecting', async () => {
    const resendTx = factory.createTxUpdateDoc(message._class, message.space, message._id, { status: 'new' })
    await workspace.txHandler(resendTx)
    expectUnavailableError()

    getGmailClient.mockReturnValue({ createMessage })
    message.status = 'new'
    await workspace.txHandler(resendTx)

    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(createMessage).toHaveBeenCalledWith(message)
    expect(getGmailClient).toHaveBeenLastCalledWith(sender)
    expect(mockClient.tx).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['from', sender],
    ['createdBy', creator],
    ['modifiedBy', modifier]
  ])('sends pending messages using %s as the sender', async (field, expectedSender) => {
    if (field !== 'from') delete message.from
    if (field === 'modifiedBy') delete message.createdBy
    getGmailClient.mockReturnValue({ createMessage })
    mockClient.findAll.mockResolvedValue([message])

    await workspace.getNewMessages()

    expect(getGmailClient).toHaveBeenCalledWith(expectedSender)
    expect(createMessage).toHaveBeenCalledWith(message)
    expect(mockClient.tx).not.toHaveBeenCalled()
  })

  it('sends live messages when the sender integration is connected', async () => {
    getGmailClient.mockReturnValue({ createMessage })

    await workspace.txHandler(createTx)

    expect(getGmailClient).toHaveBeenCalledWith(sender)
    expect(createMessage).toHaveBeenCalledWith(TxProcessor.createDoc2Doc(createTx))
    expect(mockClient.tx).not.toHaveBeenCalled()
  })

  it.each(['error', 'sent'] as const)('does not retry a status update to %s', async (status) => {
    await workspace.txHandler(factory.createTxUpdateDoc(message._class, message.space, message._id, { status }))

    expect(getGmailClient).not.toHaveBeenCalled()
    expect(mockClient.tx).not.toHaveBeenCalled()
    expect(createMessage).not.toHaveBeenCalled()
  })
})
