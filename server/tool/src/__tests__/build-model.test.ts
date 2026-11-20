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

import core, { type MeasureContext, type Ref, type Space, TxFactory } from '@hcengineering/core'
import { buildModel } from '../index'

function testContext (): MeasureContext & { error: jest.Mock } {
  const ctx: any = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    withSync: (_name: string, _params: unknown, op: (ctx: MeasureContext) => unknown) => op(ctx)
  }
  return ctx
}

// An update whose document never exists stays unapplied.
const unapplied = new TxFactory(core.account.System).createTxUpdateDoc(
  core.class.Space,
  core.space.Model,
  'missing-space' as Ref<Space>,
  { name: 'x' }
)

describe('buildModel required transactions', () => {
  const previous = process.env.MODEL_UPGRADE_STRICT

  afterEach(() => {
    if (previous === undefined) delete process.env.MODEL_UPGRADE_STRICT
    else process.env.MODEL_UPGRADE_STRICT = previous
  })

  it('reports unapplied required transactions and continues by default', async () => {
    delete process.env.MODEL_UPGRADE_STRICT
    const ctx = testContext()

    await expect(buildModel(ctx, [unapplied], [unapplied])).resolves.toBeDefined()

    expect(ctx.error).toHaveBeenCalledWith(
      expect.stringContaining('MODEL_UPGRADE_STRICT'),
      expect.objectContaining({ count: 1, txIds: [unapplied._id] })
    )
  })

  it('fails with MODEL_UPGRADE_STRICT=true', async () => {
    process.env.MODEL_UPGRADE_STRICT = 'true'
    const ctx = testContext()

    await expect(buildModel(ctx, [unapplied], [unapplied])).rejects.toThrow(
      `Failed to apply required model transactions: ${unapplied._id}`
    )
  })
})
