// SPDX-License-Identifier: EPL-2.0

import { type Person } from '@hcengineering/contact'
import core, {
  TxOperations,
  type Client,
  type Doc,
  type PersonId,
  type Ref,
  type Space,
  type Tx,
  type TxResult
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { isBackgroundTx } from '@hcengineering/presentation'
import { deletePresence, updatePresence } from '../presence'

const connection = {
  findOne: jest.fn(async (): Promise<Doc | undefined> => undefined),
  tx: jest.fn<Promise<TxResult>, [Tx]>(async () => ({})),
  getHierarchy: () => ({ isDerived: () => false, findDomain: () => 'transient' })
}
const client = new TxOperations(connection as unknown as Client, 'account' as PersonId)
const otherConnection = {
  findOne: jest.fn(async (): Promise<Doc | undefined> => undefined),
  tx: jest.fn<Promise<TxResult>, [Tx]>(async () => ({})),
  getHierarchy: () => ({ isDerived: () => false, findDomain: () => 'transient' })
}
const otherClient = new TxOperations(otherConnection as unknown as Client, 'account' as PersonId)
let currentClient = client

jest.mock('@hcengineering/presentation', () => ({
  ...jest.requireActual('@hcengineering/presentation/src/pipeline'),
  getClient: () => currentClient,
  createQuery: jest.fn()
}))

const forbidden = (): PlatformError<any> => new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))

function info (space: string): Parameters<typeof updatePresence>[0] {
  return {
    personId: 'person' as Ref<Person>,
    objectId: `issue-${space}`,
    objectClass: core.class.Doc,
    space: space as Ref<Space>
  }
}

describe('updatePresence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    currentClient = client
  })

  it('sends presence as a background write', async () => {
    await updatePresence(info('allowed'))
    expect(connection.tx).toHaveBeenCalledTimes(1)
    expect(isBackgroundTx(connection.tx.mock.calls[0][0])).toBe(true)
  })

  it('stops writing presence to a space after the server rejected it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    connection.tx.mockRejectedValueOnce(forbidden())
    await updatePresence(info('rejected'))
    await updatePresence(info('rejected'))
    await updatePresence(info('rejected'))
    expect(connection.tx).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()

    await updatePresence(info('other'))
    expect(connection.tx).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('scopes rejected spaces to the current client', async () => {
    connection.tx.mockRejectedValueOnce(forbidden())
    await updatePresence(info('shared'))
    await updatePresence(info('shared'))
    expect(connection.tx).toHaveBeenCalledTimes(1)

    currentClient = otherClient
    await updatePresence(info('shared'))
    expect(otherConnection.tx).toHaveBeenCalledTimes(1)

    currentClient = client
    await updatePresence(info('shared'))
    expect(connection.tx).toHaveBeenCalledTimes(1)
  })

  it('retries a rejected space after the retry delay', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(0)
    connection.tx.mockRejectedValueOnce(forbidden())
    await updatePresence(info('role-upgraded'))
    await updatePresence(info('role-upgraded'))
    expect(connection.tx).toHaveBeenCalledTimes(1)

    now.mockReturnValue(60_000)
    await updatePresence(info('role-upgraded'))
    expect(connection.tx).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })

  it('stops cleanup and heartbeat writes after a rejected deletion', async () => {
    const existing = {
      _id: 'presence:issue-delete-rejected:person',
      _class: 'pulse:class:DocumentPresence',
      space: 'delete-rejected'
    } as unknown as Doc
    connection.findOne.mockResolvedValue(existing)
    connection.tx.mockRejectedValueOnce(forbidden())
    await deletePresence(info('delete-rejected'))
    await deletePresence(info('delete-rejected'))
    await updatePresence(info('delete-rejected'))
    expect(connection.tx).toHaveBeenCalledTimes(1)
    connection.findOne.mockResolvedValue(undefined)
  })

  it('retries after a failure that is not a rejection', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    connection.tx.mockRejectedValueOnce(new Error('connection lost'))
    await updatePresence(info('transient'))
    await updatePresence(info('transient'))
    expect(connection.tx).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
