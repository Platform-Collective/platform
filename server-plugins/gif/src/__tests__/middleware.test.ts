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
  const updateTx = (objectId: Ref<Doc>, operations: Record<string, unknown>): TxUpdateDoc<Doc> =>
    ({ ...removeTx(objectId), _class: core.class.TxUpdateDoc, operations }) as unknown as TxUpdateDoc<Doc>

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

  // Library ids are deterministic (gif-<sha256>). While another member's upload of the same file
  // is still being stored, its row is not there yet. A removal let through at that moment would be
  // applied once the create lands and delete the other member's entry.
  it('rejects a member removing an entry that is not stored yet (upload still in flight)', async () => {
    const h = await harness([])
    await expectForbidden(h.mw.tx(ctxFor(account(AccountRole.User, [other])), [removeTx(stored._id)]))
    expect(h.forwarded).toHaveLength(0)
  })

  it('rejects a member updating an entry that is not stored yet', async () => {
    const h = await harness([])
    await expectForbidden(
      h.mw.tx(ctxFor(account(AccountRole.User, [other])), [updateTx(stored._id, { createdBy: other })])
    )
    expect(h.forwarded).toHaveLength(0)
  })

  it.each([AccountRole.Maintainer, AccountRole.Owner])(
    'lets a workspace %s remove an entry that is already gone',
    async (role) => {
      const h = await harness([])
      await h.mw.tx(ctxFor(account(role, [other])), [removeTx('gif-missing' as Ref<Doc>)])
      expect(h.forwarded).toHaveLength(1)
    }
  )

  it('does not look at removals of other classes', async () => {
    const h = await harness()
    await h.mw.tx(ctxFor(account(AccountRole.User, [other])), [removeTx(stored._id, core.class.Space)])
    expect(h.forwarded).toHaveLength(1)
    expect(h.finds).toBe(0)
  })

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

// The ownership check above runs before TxMiddleware and TxOrderingMiddleware, so the stored row
// can change between the check and the write. These tests hold each forwarded batch, the way
// persistence further down the pipeline would, until the test releases it, and apply its effect
// to a small in-memory store only then.
describe('GifMiddleware: GIF writes are checked against what is stored', () => {
  interface Held {
    txes: Tx[]
    release: () => void
  }

  interface StoreHarness {
    mw: GifMiddleware
    rows: Map<Ref<Doc>, WorkspaceGif>
    held: Held[]
  }

  async function storeHarness (docs: WorkspaceGif[]): Promise<StoreHarness> {
    const h: StoreHarness = { mw: undefined as any, rows: new Map(docs.map((d) => [d._id, d])), held: [] }
    const apply = (tx: Tx): void => {
      const cud = tx as TxRemoveDoc<Doc> & { attributes?: Partial<WorkspaceGif> }
      if (tx._class === core.class.TxRemoveDoc) h.rows.delete(cud.objectId)
      if (tx._class === core.class.TxCreateDoc) {
        h.rows.set(cud.objectId, { ...stored, ...cud.attributes, _id: cud.objectId as Ref<WorkspaceGif> })
      }
    }
    const next = {
      tx: async (_ctx: MeasureContext, txes: Tx[]) => {
        await new Promise<void>((resolve) => {
          h.held.push({
            txes,
            release: () => {
              txes.forEach(apply)
              resolve()
            }
          })
        })
        return {}
      },
      findAll: async (_ctx: MeasureContext, _class: Ref<any>, query: any) => {
        const row = h.rows.get(query._id)
        return row !== undefined && row._class === _class ? [row] : []
      }
    } as unknown as Middleware
    const context = { hierarchy: { isDerived: (a: Ref<any>, b: Ref<any>) => a === b } } as unknown as PipelineContext
    h.mw = (await GifMiddleware.create({} as any, context, next)) as GifMiddleware
    return h
  }

  // Lets every pending promise callback run, so whatever can reach the store has done so.
  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  // Releases the first held batch whose first tx has the given class.
  const releaseHeld = (h: StoreHarness, txClass: Ref<any>): boolean => {
    const i = h.held.findIndex((it) => it.txes[0]._class === txClass)
    if (i < 0) return false
    h.held.splice(i, 1)[0].release()
    return true
  }

  const createTx = (objectId: Ref<Doc>, by: PersonId): Tx =>
    ({
      ...removeTx(objectId),
      _class: core.class.TxCreateDoc,
      modifiedBy: by,
      attributes: { ...stored, createdBy: by }
    }) as unknown as Tx

  // Michael Uray's sequence on PR #58: a member sends two removals of their own entry (two open
  // settings dialogs), both would pass the check, the first is stored, another member uploads the
  // same file (same gif-<sha256> id, new owner), and only then is the second removal applied. The
  // second removal must be checked against the row as it is after the first one is stored, so it
  // is rejected as "not stored" and the new upload survives.
  it('does not let a delayed second removal delete the entry another member re-uploaded', async () => {
    const h = await storeHarness([stored])
    const owner = ctxFor(account(AccountRole.User, [uploader]))
    const first = h.mw.tx(owner, [removeTx(stored._id)])
    const second = h.mw.tx(owner, [removeTx(stored._id)]).then(
      () => 'applied',
      (err: PlatformError<any>) => err.status.code
    )
    await settle()

    expect(releaseHeld(h, core.class.TxRemoveDoc)).toBe(true)
    await first
    await settle()
    expect(h.rows.has(stored._id)).toBe(false)

    const reupload = h.mw.tx(ctxFor(account(AccountRole.User, [other])), [createTx(stored._id, other)])
    await settle()
    // The second removal was checked once the first was stored, found no row and was rejected,
    // before the re-upload is stored. Had it been forwarded, the loop below would apply it after
    // the re-upload and delete the new member's entry.
    expect(await second).toBe(platform.status.Forbidden)
    expect(releaseHeld(h, core.class.TxCreateDoc)).toBe(true)
    await reupload
    await settle()
    while (releaseHeld(h, core.class.TxRemoveDoc)) await settle()

    expect(h.rows.get(stored._id)?.createdBy).toBe(other)
  })

  // The other half of the same race: a removal that has passed its check but is not stored yet,
  // and a re-upload of the same file. The create must wait, or the removal would land after it.
  it('holds a re-upload until an earlier removal of the same id has been stored', async () => {
    const h = await storeHarness([stored])
    const removal = h.mw.tx(ctxFor(account(AccountRole.User, [uploader])), [removeTx(stored._id)])
    await settle()
    const reupload = h.mw.tx(ctxFor(account(AccountRole.User, [other])), [createTx(stored._id, other)])
    await settle()
    expect(h.held.map((it) => it.txes[0]._class)).toEqual([core.class.TxRemoveDoc])

    releaseHeld(h, core.class.TxRemoveDoc)
    await removal
    await settle()
    expect(releaseHeld(h, core.class.TxCreateDoc)).toBe(true)
    await reupload
    expect(h.rows.get(stored._id)?.createdBy).toBe(other)
  })

  // Sync triggers send derived transactions back in above this middleware, with the same request
  // context, while the batch that caused them still holds the queue.
  it('lets a derived GIF batch from the same request through instead of waiting on itself', async () => {
    const h: { mw: GifMiddleware } = { mw: undefined as any }
    const owner = ctxFor(account(AccountRole.User, [uploader]))
    let depth = 0
    const next = {
      tx: async (ctx: MeasureContext<SessionData>, txes: Tx[]) => {
        if (depth++ === 0) await h.mw.tx(ctx, [createTx('gif-derived' as Ref<Doc>, uploader)])
        return {}
      },
      findAll: async () => [stored]
    } as unknown as Middleware
    const context = { hierarchy: { isDerived: (a: Ref<any>, b: Ref<any>) => a === b } } as unknown as PipelineContext
    h.mw = (await GifMiddleware.create({} as any, context, next)) as GifMiddleware
    const done = h.mw.tx(owner, [removeTx(stored._id)]).then(() => 'done')
    const timeout = new Promise((resolve) =>
      setTimeout(() => {
        resolve('stuck')
      }, 200)
    )
    expect(await Promise.race([done, timeout])).toBe('done')
    expect(depth).toBe(2)
  })

  it('checks a GIF write only after the previous GIF write has been stored', async () => {
    const h = await storeHarness([stored])
    const owner = ctxFor(account(AccountRole.User, [uploader]))
    const first = h.mw.tx(owner, [removeTx(stored._id)])
    const second = h.mw.tx(owner, [removeTx(stored._id)]).catch(() => undefined)
    await settle()
    // Only the first removal has gone downstream; the second waits for it to be stored.
    expect(h.held).toHaveLength(1)
    releaseHeld(h, core.class.TxRemoveDoc)
    await first
    await second
    expect(h.held).toHaveLength(0)
  })

  it('does not hold writes to other classes behind a pending GIF write', async () => {
    const h = await storeHarness([stored])
    const owner = ctxFor(account(AccountRole.User, [uploader]))
    const gifWrite = h.mw.tx(owner, [removeTx(stored._id)])
    const otherWrite = h.mw.tx(owner, [removeTx('space-1' as Ref<Doc>, core.class.Space)])
    await settle()
    // The Space removal reached the store while the GIF removal is still held there.
    const i = h.held.findIndex((it) => (it.txes[0] as TxRemoveDoc<Doc>).objectClass === core.class.Space)
    expect(i).toBeGreaterThanOrEqual(0)
    h.held.splice(i, 1)[0].release()
    await otherWrite
    releaseHeld(h, core.class.TxRemoveDoc)
    await gifWrite
  })

  it('keeps processing GIF writes after one is rejected', async () => {
    const h = await storeHarness([stored])
    await expectForbidden(h.mw.tx(ctxFor(account(AccountRole.User, [other])), [removeTx(stored._id)]))
    const next = h.mw.tx(ctxFor(account(AccountRole.User, [uploader])), [removeTx(stored._id)])
    await settle()
    expect(releaseHeld(h, core.class.TxRemoveDoc)).toBe(true)
    await next
    expect(h.rows.has(stored._id)).toBe(false)
  })

  it('keeps processing GIF writes after the store fails one', async () => {
    const failing = {
      tx: jest.fn(async () => {
        throw new Error('db down')
      }),
      findAll: async () => [stored]
    } as unknown as Middleware
    const context = { hierarchy: { isDerived: (a: Ref<any>, b: Ref<any>) => a === b } } as unknown as PipelineContext
    const mw = (await GifMiddleware.create({} as any, context, failing)) as GifMiddleware
    const owner = ctxFor(account(AccountRole.User, [uploader]))
    await expect(mw.tx(owner, [removeTx(stored._id)])).rejects.toThrow('db down')
    await expect(mw.tx(owner, [removeTx(stored._id)])).rejects.toThrow('db down')
    expect((failing as any).tx).toHaveBeenCalledTimes(2)
  })
})
