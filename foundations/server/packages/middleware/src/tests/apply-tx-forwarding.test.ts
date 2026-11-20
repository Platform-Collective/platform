// SPDX-License-Identifier: EPL-2.0

import core, {
  type Doc,
  Hierarchy,
  type MeasureContext,
  MeasureMetricsContext,
  ModelDb,
  type Ref,
  type SessionData,
  systemAccount,
  type Tx,
  TxFactory,
  type TxUpdateDoc,
  type WorkspaceUuid
} from '@hcengineering/core'
import { BaseMiddleware, type PipelineContext, type TxMiddlewareResult } from '@hcengineering/server-core'
import { ApplyTxMiddleware } from '../applyTx'

describe('ApplyTxMiddleware forwarding order', () => {
  it('forwards every plain transaction before an ApplyIf, then its contents and trailing transactions', async () => {
    const factory = new TxFactory(core.account.System)
    const update = (id: string): TxUpdateDoc<Doc> =>
      factory.createTxUpdateDoc(core.class.Doc, core.space.Workspace, id as Ref<Doc>, {})
    const first = update('first')
    const second = update('second')
    const nested = update('nested')
    const last = update('last')
    const apply = factory.createTxApplyIf(core.space.Tx, undefined, [], [], [nested], undefined)
    const received: Tx[][] = []
    const hierarchy = new Hierarchy()
    const context: PipelineContext = {
      hierarchy,
      modelDb: new ModelDb(hierarchy),
      workspace: { uuid: 'test-workspace' as WorkspaceUuid, url: 'test-workspace' },
      branding: null,
      contextVars: {}
    }
    const next = new (class extends BaseMiddleware {
      constructor () {
        super(context)
      }

      override async tx (_ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
        received.push([...txes])
        return {}
      }
    })()
    const sessionData: SessionData = {
      broadcast: { txes: [], targets: {}, queue: [], sessions: {} },
      contextCache: new Map(),
      removedMap: new Map(),
      account: systemAccount,
      service: 'test',
      sessionId: 'test-session',
      workspace: context.workspace,
      socialStringsToUsers: new Map()
    }
    const ctx = Object.assign(new MeasureMetricsContext('test', {}), { contextData: sessionData })
    jest.spyOn(hierarchy, 'isDerived').mockImplementation((value, parent) => value === parent)
    const middleware = await ApplyTxMiddleware.create(ctx, context, next)

    await middleware.tx(ctx, [first, second, apply, last])

    expect(received).toEqual([[first, second], [nested], [last]])
  })
})
