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

import core, { type Tx, TxFactory } from '@hcengineering/core'
import type { PipelineContext, TxMiddlewareResult } from '@hcengineering/server-core'
import { ApplyTxMiddleware } from '../applyTx'
import { NormalizeTxMiddleware } from '../normalizeTx'

const TEST_DOC_CLASS = 'test:class:Document' as any
const TEST_SPACE = 'test:space:Workspace' as any

function createUpdate (factory: TxFactory, id: string): any {
  return factory.createTxUpdateDoc(TEST_DOC_CLASS, TEST_SPACE, id as any, { title: id } as any)
}

describe('NormalizeTxMiddleware server-only meta', () => {
  it('strips reserved meta from client root and apply transactions', async () => {
    const factory = new TxFactory(core.account.System)
    const root = createUpdate(factory, 'root')
    root.meta = { public: 'kept', 'server:dependency-shift-email-recipients': 'forged' }
    const nested = createUpdate(factory, 'nested')
    nested.meta = { public: true, 'server:another-marker': 1 }
    const apply = factory.createTxApplyIf(core.space.Tx, undefined, [], [], [nested], undefined)
    apply.meta = { public: 2, 'server:outer-marker': false }

    let received: Tx[] = []
    const next = {
      tx: async (_ctx: unknown, txes: Tx[]): Promise<TxMiddlewareResult> => {
        received = txes
        return {}
      }
    }
    const middleware = new (NormalizeTxMiddleware as any)({}, next)

    await middleware.tx({} as any, [root, apply])

    expect(received[0].meta).toEqual({ public: 'kept' })
    expect(received[1].meta).toEqual({ public: 2 })
    expect((received[1] as any).txes[0].meta).toEqual({ public: true })
  })
})

describe('ApplyTxMiddleware', () => {
  it('forwards transactions preceding an apply batch', async () => {
    const factory = new TxFactory(core.account.System)
    const preceding = createUpdate(factory, 'preceding')
    const nested = createUpdate(factory, 'nested')
    const apply = factory.createTxApplyIf(core.space.Tx, undefined, [], [], [nested], undefined)
    const received: Tx[][] = []
    const middleware = await ApplyTxMiddleware.create(
      {} as any,
      { hierarchy: { isDerived: (value: unknown, parent: unknown) => value === parent } } as unknown as PipelineContext,
      {
        tx: async (_ctx: unknown, txes: Tx[]): Promise<TxMiddlewareResult> => {
          received.push(txes)
          return {}
        }
      } as any
    )

    await middleware.tx({} as any, [preceding, apply])

    expect(received).toEqual([[preceding], [nested]])
  })
})
