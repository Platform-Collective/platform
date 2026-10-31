//
// Copyright © 2026 Hardcore Engineering Inc.
// Copyright © 2026 Exaviz
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

import core, {
  type Account,
  AccountRole,
  type AccountUuid,
  type Doc,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Tx,
  type TxRemoveDoc,
  type TxUpdateDoc
} from '@hcengineering/core'
import gif, { type WorkspaceGif } from '@hcengineering/gif'
import platform, { PlatformError } from '@hcengineering/platform'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { GifMiddleware } from '../index'

const uploader = 'social-uploader' as PersonId
const other = 'social-other' as PersonId

const account = (role: AccountRole, socialIds: PersonId[]): Account => ({
  uuid: 'acc' as AccountUuid,
  role,
  primarySocialId: socialIds[0] ?? ('' as PersonId),
  socialIds,
  fullSocialIds: []
})

const ctxFor = (acc: Account): MeasureContext<SessionData> =>
  ({ contextData: { account: acc }, warn: () => {} }) as unknown as MeasureContext<SessionData>

const stored: WorkspaceGif = {
  _id: 'gif-abc' as Ref<WorkspaceGif>,
  _class: gif.class.WorkspaceGif,
  space: core.space.Workspace,
  modifiedOn: 0,
  modifiedBy: uploader,
  createdBy: uploader,
  title: 'Party Parrot',
  keywords: ['party', 'parrot'],
  blob: 'blob-abc' as any,
  width: 10,
  height: 10,
  size: 100,
  sha256: 'abc'
}

function removeTx (objectId: Ref<Doc>, objectClass = gif.class.WorkspaceGif as any): TxRemoveDoc<Doc> {
  return {
    _id: `tx-${objectId}` as any,
    _class: core.class.TxRemoveDoc,
    space: core.space.Tx,
    objectId,
    objectClass,
    objectSpace: core.space.Workspace,
    modifiedOn: 0,
    modifiedBy: other
  }
}

interface Harness {
  mw: GifMiddleware
  forwarded: Tx[][]
  finds: number
}

async function harness (docs: WorkspaceGif[] = [stored]): Promise<Harness> {
  const h: Harness = { mw: undefined as any, forwarded: [], finds: 0 }
  const next = {
    tx: async (_ctx: MeasureContext, txes: Tx[]) => {
      h.forwarded.push(txes)
      return {}
    },
    findAll: async (_ctx: MeasureContext, _class: Ref<any>, query: any) => {
      h.finds++
      return docs.filter((d) => d._class === _class && d._id === query._id)
    }
  } as unknown as Middleware
  // Only the class check is needed from the hierarchy: WorkspaceGif has no subclasses.
  const context = { hierarchy: { isDerived: (a: Ref<any>, b: Ref<any>) => a === b } } as unknown as PipelineContext
  h.mw = (await GifMiddleware.create({} as any, context, next)) as GifMiddleware
  return h
}

async function expectForbidden (p: Promise<unknown>): Promise<void> {
  let err: unknown
  try {
    await p
  } catch (e) {
    err = e
  }
  expect(err).toBeInstanceOf(PlatformError)
  expect((err as PlatformError<any>).status.code).toBe(platform.status.Forbidden)
}

describe('GifMiddleware: removal rule enforced on the server', () => {
  it('lets the uploader remove their own library entry', async () => {
    const h = await harness()
    const tx = removeTx(stored._id)
    await h.mw.tx(ctxFor(account(AccountRole.User, [uploader])), [tx])
    expect(h.forwarded).toEqual([[tx]])
  })

  it('matches any of the caller social ids, not only the primary one', async () => {
    const h = await harness()
    await h.mw.tx(ctxFor(account(AccountRole.User, [other, uploader])), [removeTx(stored._id)])
    expect(h.forwarded).toHaveLength(1)
  })

  it('rejects another member removing the entry, and forwards nothing', async () => {
    const h = await harness()
    await expectForbidden(h.mw.tx(ctxFor(account(AccountRole.User, [other])), [removeTx(stored._id)]))
    expect(h.forwarded).toHaveLength(0)
  })

  it('rejects a guest who did not upload the entry', async () => {
    const h = await harness()
    await expectForbidden(h.mw.tx(ctxFor(account(AccountRole.Guest, [other])), [removeTx(stored._id)]))
  })

  it.each([AccountRole.Maintainer, AccountRole.Owner])('lets a workspace %s remove any entry', async (role) => {
    const h = await harness()
    await h.mw.tx(ctxFor(account(role, [other])), [removeTx(stored._id)])
    expect(h.forwarded).toHaveLength(1)
    expect(h.finds).toBe(0)
  })

  it('rejects removal of an entry with no recorded uploader unless admin', async () => {
    const orphan = { ...stored, createdBy: undefined }
    const h = await harness([orphan])
    await expectForbidden(h.mw.tx(ctxFor(account(AccountRole.User, [uploader])), [removeTx(orphan._id)]))
  })

  it('passes a removal of an entry that is already gone (idempotent remove)', async () => {
    const h = await harness([])
    await h.mw.tx(ctxFor(account(AccountRole.User, [other])), [removeTx('gif-missing' as Ref<Doc>)])
    expect(h.forwarded).toHaveLength(1)
  })

  it('does not look at removals of other classes', async () => {
    const h = await harness()
    await h.mw.tx(ctxFor(account(AccountRole.User, [other])), [removeTx(stored._id, core.class.Space)])
    expect(h.forwarded).toHaveLength(1)
    expect(h.finds).toBe(0)
  })

  const updateTx = (objectId: Ref<Doc>, operations: Record<string, unknown>): TxUpdateDoc<Doc> =>
    ({ ...removeTx(objectId), _class: core.class.TxUpdateDoc, operations }) as unknown as TxUpdateDoc<Doc>

  it('leaves creating a library entry alone', async () => {
    const h = await harness()
    const create = { ...removeTx(stored._id), _class: core.class.TxCreateDoc, attributes: {} }
    await h.mw.tx(ctxFor(account(AccountRole.User, [other])), [create])
    expect(h.forwarded).toHaveLength(1)
    expect(h.finds).toBe(0)
  })

  it('rejects another member rewriting createdBy, which would let them remove the entry next', async () => {
    const h = await harness()
    await expectForbidden(
      h.mw.tx(ctxFor(account(AccountRole.User, [other])), [updateTx(stored._id, { createdBy: other })])
    )
    expect(h.forwarded).toHaveLength(0)
  })

  it('rejects another member swapping the blob behind an entry', async () => {
    const h = await harness()
    await expectForbidden(h.mw.tx(ctxFor(account(AccountRole.User, [other])), [updateTx(stored._id, { blob: 'x' })]))
  })

  it('rejects another member applying a mixin to the entry', async () => {
    const h = await harness()
    const mixin = { ...removeTx(stored._id), _class: core.class.TxMixin, mixin: 'some:mixin:M', attributes: {} }
    await expectForbidden(h.mw.tx(ctxFor(account(AccountRole.User, [other])), [mixin]))
  })

  it('lets the uploader and an admin update an entry', async () => {
    const h = await harness()
    await h.mw.tx(ctxFor(account(AccountRole.User, [uploader])), [updateTx(stored._id, { title: 'Parrot' })])
    await h.mw.tx(ctxFor(account(AccountRole.Maintainer, [other])), [updateTx(stored._id, { title: 'Parrot' })])
    expect(h.forwarded).toHaveLength(2)
  })

  it('rejects the whole batch when any removal in it is not allowed', async () => {
    const mine = stored
    const theirs = { ...stored, _id: 'gif-def' as Ref<WorkspaceGif>, createdBy: other }
    const h = await harness([mine, theirs])
    await expectForbidden(
      h.mw.tx(ctxFor(account(AccountRole.User, [uploader])), [removeTx(mine._id), removeTx(theirs._id)])
    )
    expect(h.forwarded).toHaveLength(0)
  })
})
