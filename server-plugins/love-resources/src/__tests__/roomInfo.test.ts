// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
import core, { type Doc, type TxCUD, type TxUpdateDoc, TxFactory } from '@hcengineering/core'
import love, { type RoomInfo, RoomAccess } from '@hcengineering/love'
import { type TriggerControl } from '@hcengineering/server-core'
import resources from '../index'

jest.mock('@hcengineering/server-contact', () => ({}))
jest.mock('@hcengineering/server-notification-resources', () => ({}))

async function leave (
  office: boolean,
  persons: string[],
  leaving: string[],
  joining: string[] = []
): Promise<TxCUD<Doc>[]> {
  const room = {
    _id: 'room',
    _class: office ? love.class.Office : love.class.Room,
    space: core.space.Workspace,
    person: 'owner',
    access: RoomAccess.DND
  }
  const info = { _id: 'info', room: room._id, isOffice: office, persons }
  const control = {
    ctx: {},
    queryFind: jest.fn().mockResolvedValue([info]),
    findAll: jest.fn().mockResolvedValue([room]),
    txFactory: new TxFactory(core.account.System),
    removedMap: new Map()
  } as unknown as TriggerControl
  const tx = {
    _class: core.class.TxUpdateDoc,
    objectId: info._id,
    operations: { $pull: { persons: { $in: leaving } }, $push: { persons: { $each: joining } } }
  } as unknown as TxCUD<RoomInfo>
  return (await (await resources()).trigger.OnRoomInfo([tx], control)) as TxCUD<Doc>[]
}

describe('PC room access after participants leave', () => {
  it('restores an empty room without finishing meetings', async () => {
    const txs = await leave(false, ['guest'], ['guest'])
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ objectClass: love.class.Room, operations: { access: RoomAccess.Open } })
    expect((txs[0] as TxUpdateDoc<any>).operations).not.toHaveProperty('status')
  })

  it('restores an office when only its owner remains', async () => {
    const txs = await leave(true, ['owner', 'guest'], ['guest'])
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ objectClass: love.class.Office, operations: { access: RoomAccess.Knock } })
  })

  it('preserves access while another participant remains or joins', async () => {
    expect(await leave(false, ['guest', 'other'], ['guest'])).toEqual([])
    expect(await leave(false, ['guest'], ['guest'], ['joining'])).toEqual([])
  })
})
