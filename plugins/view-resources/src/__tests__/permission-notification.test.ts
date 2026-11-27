// SPDX-License-Identifier: EPL-2.0

import core, { AccountRole, Hierarchy, TxFactory, setCurrentAccount } from '@hcengineering/core'
import type { AccountUuid, Client, Doc, PersonId, Ref, Tx, TxResult } from '@hcengineering/core'
import platform, { PlatformError, setPlatformStatus, Severity, Status } from '@hcengineering/platform'
import { markBackgroundTx, PresentationPipelineImpl, type PresentationPipeline } from '@hcengineering/presentation'
import { addNotification } from '@hcengineering/ui'
import { ReadOnlyAccessMiddleware } from '../middleware'

jest.mock('@hcengineering/presentation', () => jest.requireActual('@hcengineering/presentation/src/pipeline'))
jest.mock('@hcengineering/platform', () => ({
  __esModule: true,
  ...jest.requireActual('@hcengineering/platform'),
  translate: jest.fn(async (label: string) => label),
  setPlatformStatus: jest.fn(async () => {})
}))
jest.mock('@hcengineering/ui', () => ({ addNotification: jest.fn(), NotificationSeverity: { Info: 'info' } }))
jest.mock('@hcengineering/theme', () => ({ getCurrentLanguage: () => 'en' }))
jest.mock('../components/ReadOnlyNotification.svelte', () => ({ __esModule: true, default: {} }))
jest.mock('../components/ForbiddenNotification.svelte', () => ({ __esModule: true, default: {} }))

const account = 'account' as PersonId

function role (role: AccountRole): void {
  setCurrentAccount({
    uuid: 'account' as AccountUuid,
    role,
    primarySocialId: account,
    socialIds: [account],
    fullSocialIds: []
  })
}

function setup (): { pipeline: PresentationPipeline, send: jest.Mock<Promise<TxResult>, [Tx]> } {
  const send = jest.fn<Promise<TxResult>, [Tx]>()
  const client = { tx: send, getHierarchy: () => new Hierarchy() } as unknown as Client
  const pipeline = PresentationPipelineImpl.create(client, [
    (client, next) => ReadOnlyAccessMiddleware.create(client, next)
  ])
  return { pipeline, send }
}

function createTx (): Tx {
  return new TxFactory(account).createTxCreateDoc(core.class.Doc, core.space.Workspace, {}, 'doc' as Ref<Doc>)
}

const forbidden = (): PlatformError<any> => new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))

describe('permission notification', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    role(AccountRole.User)
  })

  it('keeps one notification for repeated rejected writes', async () => {
    const { pipeline, send } = setup()
    send.mockRejectedValue(forbidden())
    await expect(pipeline.tx(createTx())).resolves.toEqual({})
    await expect(pipeline.tx(createTx())).resolves.toEqual({})
    expect(addNotification).toHaveBeenCalledTimes(2)
    for (const call of (addNotification as jest.Mock).mock.calls) {
      expect(call[5]).toBe('permissionNotification')
    }
  })

  it('returns a rejected background write to its writer without notification or error status', async () => {
    const { pipeline, send } = setup()
    const error = forbidden()
    send.mockRejectedValueOnce(error)
    await expect(pipeline.tx(markBackgroundTx(createTx()))).rejects.toBe(error)
    expect(addNotification).not.toHaveBeenCalled()
    expect(setPlatformStatus).not.toHaveBeenCalled()
  })

  it('does not send or announce a background write of a read-only guest', async () => {
    const { pipeline, send } = setup()
    role(AccountRole.ReadOnlyGuest)
    await expect(pipeline.tx(markBackgroundTx(createTx()))).rejects.toMatchObject({
      status: { code: platform.status.Forbidden }
    })
    expect(send).not.toHaveBeenCalled()
    expect(addNotification).not.toHaveBeenCalled()
    expect(setPlatformStatus).not.toHaveBeenCalled()
  })

  it('still reports a rejected user write', async () => {
    const { pipeline, send } = setup()
    const error = forbidden()
    send.mockRejectedValueOnce(error)
    await expect(pipeline.tx(createTx())).resolves.toEqual({})
    expect(addNotification).toHaveBeenCalledTimes(1)
    expect(setPlatformStatus).not.toHaveBeenCalled()
  })
})
