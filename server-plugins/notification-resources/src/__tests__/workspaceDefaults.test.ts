// SPDX-License-Identifier: EPL-2.0

import {
  AccountRole,
  generateId,
  MeasureMetricsContext,
  systemAccountUuid,
  TxFactory,
  type Account,
  type Class,
  type Doc,
  type Domain,
  type MeasureContext,
  type Mixin,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx
} from '@hcengineering/core'
import notification, { DOMAIN_WORKSPACE_NOTIFICATION } from '@hcengineering/notification'
import type { PipelineContext } from '@hcengineering/server-core'

const DEFAULT_CLASS = notification.class.WorkspaceNotificationTypeSetting
const OTHER_CLASS = 'test:class:Other' as Ref<Class<Doc>>
const OTHER_DOMAIN = 'test-other' as Domain

function makeAccount (role: AccountRole, uuid?: string): Account {
  return {
    uuid: (uuid ?? generateId()) as any,
    role,
    primarySocialId: 'test' as PersonId,
    socialIds: ['test' as PersonId],
    fullSocialIds: []
  }
}

function makeCtx (account: Account, admin?: boolean): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = { account, admin, broadcast: { txes: [], queue: [], sessions: {} } } as any
  return ctx
}

const hierarchy = {
  isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) => a === b,
  findDomain: (c: Ref<Class<Doc>>) => (c === DEFAULT_CLASS ? DOMAIN_WORKSPACE_NOTIFICATION : OTHER_DOMAIN)
}

const factory = new TxFactory('test' as PersonId)
const space = 'core:space:Workspace' as Ref<Space>

function cud (_class: Ref<Class<Doc>>): Tx[] {
  const id = generateId<Doc>()
  return [
    factory.createTxCreateDoc(_class, space, { enabled: true }),
    factory.createTxUpdateDoc(_class, space, id, { enabled: false } as any),
    factory.createTxMixin(id, _class, space, 'test:mixin:Any' as Ref<Mixin<Doc>>, {}),
    factory.createTxRemoveDoc(_class, space, id)
  ]
}

import { WorkspaceNotificationDefaultsMiddleware } from '../workspaceDefaults'

function makeMiddleware (received: Tx[][]): any {
  const context = { hierarchy } as unknown as PipelineContext
  const next = {
    tx: async (_ctx: MeasureContext, txes: Tx[]) => {
      received.push(txes)
      return {}
    }
  }
  return new (WorkspaceNotificationDefaultsMiddleware as any)(context, next)
}

describe('WorkspaceNotificationDefaultsMiddleware', () => {
  for (const role of [AccountRole.Guest, AccountRole.User, AccountRole.Maintainer]) {
    it(`does not let a ${role} create, update, change a mixin of or remove workspace defaults`, async () => {
      const received: Tx[][] = []
      const mw = makeMiddleware(received)
      for (const tx of cud(DEFAULT_CLASS)) {
        await expect(async () => await mw.tx(makeCtx(makeAccount(role)), [tx])).rejects.toThrow()
      }
      expect(received).toHaveLength(0)
    })
  }

  it('allows owners, admin sessions and the system account to manage workspace defaults', async () => {
    const received: Tx[][] = []
    const mw = makeMiddleware(received)
    const accounts: Array<[Account, boolean | undefined]> = [
      [makeAccount(AccountRole.Owner), undefined],
      [makeAccount(AccountRole.User), true],
      [makeAccount(AccountRole.User, systemAccountUuid), undefined]
    ]
    for (const [account, admin] of accounts) {
      for (const tx of cud(DEFAULT_CLASS)) {
        await mw.tx(makeCtx(account, admin), [tx])
      }
    }
    expect(received).toHaveLength(12)
  })

  it('does not affect other classes', async () => {
    const received: Tx[][] = []
    const mw = makeMiddleware(received)
    for (const tx of cud(OTHER_CLASS)) {
      await mw.tx(makeCtx(makeAccount(AccountRole.User)), [tx])
    }
    expect(received).toHaveLength(4)
  })
})
