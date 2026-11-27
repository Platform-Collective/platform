// SPDX-License-Identifier: EPL-2.0

import core, {
  AccountRole,
  Hierarchy,
  MeasureMetricsContext,
  ModelDb,
  TxFactory,
  TxOperations
} from '@hcengineering/core'
import type { Account, AccountUuid, Doc, MeasureContext, MeasureLogger, PersonId, Ref } from '@hcengineering/core'
import { createRestClient, createRestTxOperations } from '../index'

const endpoint = 'https://rest.example.test'
const workspace = 'workspace'
const token = 'synthetic-original-token'
const account: Account = {
  uuid: 'caller' as AccountUuid,
  role: AccountRole.User,
  primarySocialId: 'caller-primary' as PersonId,
  socialIds: ['caller-author' as PersonId],
  fullSocialIds: []
}
const orphan = new TxFactory(account.socialIds[0]).createTxUpdateDoc(
  core.class.Doc,
  core.space.Model,
  'missing-model-document' as Ref<Doc>,
  {}
)
let fetchMock: jest.SpiedFunction<typeof fetch>
let info: jest.SpiedFunction<typeof console.info>

beforeEach(() => {
  info = jest.spyOn(console, 'info').mockImplementation(() => {})
  fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === `/api/v1/account/${workspace}`) return Response.json(account)
    if (url.pathname === `/api/v1/load-model/${workspace}`) return Response.json([orphan])
    throw new Error('Unexpected REST request')
  })
})
afterEach(() => {
  jest.restoreAllMocks()
})

function expectRequests (full: boolean | undefined): void {
  const modelRequest = fetchMock.mock.calls.find(([input]) => String(input).includes('/load-model/'))
  expect(modelRequest).toBeDefined()
  expect(new URL(String(modelRequest?.[0])).searchParams.get('full')).toBe(full === true ? 'true' : null)
  for (const [, init] of fetchMock.mock.calls) {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`)
  }
}

function callerContext (): { ctx: MeasureContext, logger: MeasureLogger } {
  const logger: MeasureLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    logOperation: jest.fn(),
    close: jest.fn(async () => {})
  }
  return { ctx: new MeasureMetricsContext('caller', {}, {}, undefined, logger), logger }
}

test.each([undefined, false, true])('retainsOrdinaryFactoryLoggingAndFullModel:%s', async (full) => {
  const tx = await createRestTxOperations(endpoint, workspace, token, full)
  try {
    expect(tx).toBeInstanceOf(TxOperations)
    expect(tx.user).toBe(account.socialIds[0])
    expect(tx.getHierarchy()).toBeInstanceOf(Hierarchy)
    expect(tx.getModel()).toBeInstanceOf(ModelDb)
    expect(info).toHaveBeenCalledWith(
      'skipped model transactions for orphan documents',
      'total=1',
      'byClass={"core:class:TxUpdateDoc":1}'
    )
    expectRequests(full)
  } finally {
    await tx.close()
  }
})

test.each([false, true])('routesNativeFactoryModelDiagnosticsThroughCallerContext:%s', async (full) => {
  const { ctx, logger } = callerContext()
  const tx = await createRestTxOperations(endpoint, workspace, token, full, ctx)
  try {
    expect(tx.user).toBe(account.socialIds[0])
    expect(tx.getModel()).toBeInstanceOf(ModelDb)
    expect(info).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('skipped model transactions for orphan documents', {
      total: 1,
      byClass: { [core.class.TxUpdateDoc]: 1 }
    })
    expect(logger.close).not.toHaveBeenCalled()
    expectRequests(full)
  } finally {
    await tx.close()
  }
})

test('retainsOrdinaryRestClientModelLogging', async () => {
  const client = createRestClient(endpoint, workspace, token)
  expect((await client.getModel()).model).toBeInstanceOf(ModelDb)
  expect(info).toHaveBeenCalledTimes(1)
  expectRequests(false)
})

test.each([false, true])('routesPublicRestClientModelDiagnosticsThroughCallerContext:%s', async (full) => {
  const { ctx, logger } = callerContext()
  const client = createRestClient(endpoint, workspace, token)
  const result = await client.getModel(full, ctx)
  expect(result.hierarchy).toBeInstanceOf(Hierarchy)
  expect(result.model).toBeInstanceOf(ModelDb)
  expect(logger.info).toHaveBeenCalledTimes(1)
  expect(info).not.toHaveBeenCalled()
  expectRequests(full)
})
