// SPDX-License-Identifier: EPL-2.0

import core, {
  Hierarchy,
  matchQuery,
  toFindResult,
  TxOperations,
  TxProcessor,
  type Client,
  type Doc,
  type DocumentClassQuery,
  type MarkupBlobRef,
  type Ref,
  type Tx,
  type TxApplyIf,
  type TxUpdateDoc
} from '@hcengineering/core'
import love, {
  getMeetingRoomId,
  MeetingStatus,
  RecordingState,
  RoomAccess,
  TranscriptionState,
  type Floor,
  type MeetingMinutes,
  type Room
} from '@hcengineering/love'
import { PlatformError, unknownError } from '@hcengineering/platform'
import { getMeetingMinutesQuery, removeRoom } from '../meeting-minutes'

const floor: Floor = {
  _id: 'floor' as Ref<Floor>,
  _class: love.class.Floor,
  space: core.space.Workspace,
  modifiedBy: core.account.System,
  modifiedOn: 0,
  name: 'Floor',
  meetings: 0
}
const room = { ...floor, _id: 'room' as Ref<Room>, floor: floor._id, _class: love.class.Room } as Room
const completedMinutes: MeetingMinutes = {
  _id: 'minutes-1' as Ref<MeetingMinutes>,
  _class: love.class.MeetingMinutes,
  space: core.space.Workspace,
  modifiedBy: core.account.System,
  modifiedOn: 0,
  attachedTo: room._id,
  attachedToClass: love.class.Room,
  collection: 'meetings',
  title: 'Completed meeting',
  status: MeetingStatus.Finished,
  description: 'notes' as MarkupBlobRef,
  attachments: 1,
  recordings: 1,
  transcriptionState: TranscriptionState.Finished,
  recordingState: RecordingState.Finished,
  access: RoomAccess.Open,
  language: 'en'
}
const minutes = [completedMinutes, { ...completedMinutes, _id: 'minutes-2' as Ref<MeetingMinutes> }]

function createClient (initialMinutes: MeetingMinutes[] = minutes): {
  client: TxOperations
  ops: ReturnType<TxOperations['apply']>
  findAll: jest.Mock
  tx: jest.Mock
  docs: Map<Ref<Doc>, Doc>
} {
  const docs = new Map<Ref<Doc>, Doc>(
    [floor, { ...room, meetings: initialMinutes.length }, ...initialMinutes].map((doc) => [doc._id, { ...doc }])
  )
  const hierarchy = new Hierarchy()
  jest.spyOn(hierarchy, 'isMixin').mockReturnValue(false)
  jest.spyOn(hierarchy, 'getBaseClass').mockImplementation((_class) => _class)
  jest.spyOn(hierarchy, 'isDerived').mockImplementation((_class, base) =>
    _class === base || (_class === love.class.MeetingMinutes && base === core.class.AttachedDoc)
  )
  const findAll = jest.fn().mockImplementation(async (_class, query) =>
    toFindResult(matchQuery([...docs.values()], query, _class, hierarchy))
  )
  // Exercise real ApplyOperations/TxOperations. This transport accepts a batch only after its preconditions pass.
  const tx = jest.fn().mockImplementation(async (tx: Tx) => {
    if (tx._class !== core.class.TxApplyIf) throw new Error('Expected one atomic apply')
    const batch = tx as TxApplyIf
    const matches = ({ _class, query }: DocumentClassQuery<Doc>): boolean =>
      matchQuery([...docs.values()], query, _class, hierarchy).length > 0
    if (!(batch.match ?? []).every(matches) || (batch.notMatch ?? []).some(matches)) return { success: false }
    for (const operation of batch.txes) {
      if (operation._class === core.class.TxUpdateDoc) {
        const doc = docs.get(operation.objectId)
        if (doc === undefined) throw new Error('Missing document')
        TxProcessor.applyUpdate(doc, (operation as TxUpdateDoc<Doc>).operations)
      } else if (operation._class === core.class.TxRemoveDoc) {
        docs.delete(operation.objectId)
      } else {
        throw new Error('Unexpected transaction')
      }
    }
    return { success: true }
  })
  const client = new TxOperations({ getHierarchy: () => hierarchy, findAll, tx } as unknown as Client, core.account.System)
  const ops = client.apply(`create_meeting_${room._id}`)
  jest.spyOn(client, 'apply').mockReturnValue(ops)
  return { client, ops, findAll, tx, docs }
}

describe('removeRoom', () => {
  it('preserves finished minutes in one apply with collection metadata and all content intact', async () => {
    const { client, tx, docs, findAll } = createClient()

    await removeRoom(client, room)

    expect(findAll).toHaveBeenCalledWith(love.class.MeetingMinutes, { attachedTo: room._id }, undefined)
    expect(client.apply).toHaveBeenCalledWith(`create_meeting_${room._id}`)
    expect(tx).toHaveBeenCalledTimes(1)
    const batch = tx.mock.calls[0][0] as TxApplyIf
    expect(batch.txes).toHaveLength(3)
    for (const [index, minute] of minutes.entries()) {
      expect(batch.txes[index]).toMatchObject({
        _class: core.class.TxUpdateDoc,
        objectId: minute._id,
        attachedTo: room._id,
        attachedToClass: love.class.Room,
        collection: 'meetings',
        operations: { attachedTo: floor._id, attachedToClass: love.class.Floor, collection: 'meetings' }
      })
      expect(docs.get(minute._id)).toEqual({
        ...minute, attachedTo: floor._id, attachedToClass: love.class.Floor, collection: 'meetings'
      })
    }
    expect(batch.txes[2]).toMatchObject({ _class: core.class.TxRemoveDoc, objectId: room._id })
    expect(docs.has(room._id)).toBe(false)
  })

  it('does not send a transaction until every move and room removal have been staged', async () => {
    const { client, ops, tx, docs } = createClient()
    const update = ops.updateCollection.bind(ops)
    let resume: () => void = () => {}
    const pending = new Promise<void>((resolve) => { resume = resolve })
    jest.spyOn(ops, 'updateCollection').mockImplementationOnce(async (...args) => {
      await pending
      return await update(...args)
    })

    const removal = removeRoom(client, room)
    await Promise.resolve()
    expect(ops.updateCollection).toHaveBeenCalledTimes(1)
    expect(tx).not.toHaveBeenCalled()
    expect(docs.get(completedMinutes._id)).toEqual(completedMinutes)
    expect(docs.has(room._id)).toBe(true)

    resume()
    await removal
    expect(tx).toHaveBeenCalledTimes(1)
    expect(docs.has(room._id)).toBe(false)
  })

  it('keeps the room and all minutes if finding its minutes fails', async () => {
    const { client, findAll, tx, docs } = createClient()
    const before = new Map([...docs].map(([id, doc]) => [id, { ...doc }]))
    const error = new Error('Unable to load minutes')
    findAll.mockRejectedValue(error)

    await expect(removeRoom(client, room)).rejects.toThrow(error)
    expect(client.apply).not.toHaveBeenCalled()
    expect(tx).not.toHaveBeenCalled()
    expect(docs).toEqual(before)
  })

  it('moves nothing and keeps the room when the second update fails after the first was staged', async () => {
    const { client, ops, tx, docs } = createClient()
    const before = new Map([...docs].map(([id, doc]) => [id, { ...doc }]))
    const error = new Error('Unable to move minutes')
    const update = ops.updateCollection.bind(ops)
    jest.spyOn(ops, 'updateCollection').mockImplementationOnce(update).mockRejectedValueOnce(error)

    await expect(removeRoom(client, room)).rejects.toThrow(error)
    expect(ops.updateCollection).toHaveBeenCalledTimes(2)
    expect(ops.txes).toHaveLength(1)
    expect(tx).not.toHaveBeenCalled()
    expect(docs).toEqual(before)
  })

  it('does not submit staged moves if staging the room removal fails', async () => {
    const { client, ops, tx, docs } = createClient()
    const before = new Map([...docs].map(([id, doc]) => [id, { ...doc }]))
    const error = new Error('Unable to remove room')
    jest.spyOn(ops, 'remove').mockRejectedValue(error)

    await expect(removeRoom(client, room)).rejects.toThrow(error)
    expect(ops.txes).toHaveLength(minutes.length)
    expect(tx).not.toHaveBeenCalled()
    expect(docs).toEqual(before)
  })

  it('propagates a rejected commit without sending individual updates or a separate room deletion', async () => {
    const { client, tx, docs } = createClient()
    const before = new Map([...docs].map(([id, doc]) => [id, { ...doc }]))
    const error = new Error('Commit failed')
    tx.mockRejectedValue(error)

    await expect(removeRoom(client, room)).rejects.toThrow(error)
    expect(tx).toHaveBeenCalledTimes(1)
    expect(tx.mock.calls[0][0]._class).toBe(core.class.TxApplyIf)
    expect(docs).toEqual(before)
  })

  it.each([MeetingStatus.Scheduled, MeetingStatus.Active, MeetingStatus.Pending])(
    'blocks deletion before moving any minutes when status %s remains, with a localized error', async (status) => {
      const { client, tx, docs } = createClient([completedMinutes, { ...minutes[1], status }])
      const before = new Map([...docs].map(([id, doc]) => [id, { ...doc }]))

      await expect(removeRoom(client, room)).rejects.toMatchObject({
        status: { code: love.string.RoomHasUnfinishedMeetings }
      })
      expect(client.apply).not.toHaveBeenCalled()
      expect(tx).not.toHaveBeenCalled()
      expect(docs).toEqual(before)
    }
  )

  it('allows deleting a room without minutes', async () => {
    const { client, tx, docs } = createClient([])

    await removeRoom(client, room)

    expect(tx).toHaveBeenCalledTimes(1)
    expect((tx.mock.calls[0][0] as TxApplyIf).txes).toEqual([
      expect.objectContaining({ _class: core.class.TxRemoveDoc, objectId: room._id })
    ])
    expect(docs.has(room._id)).toBe(false)
    expect(docs.get(floor._id)).toEqual(floor)
  })

  it.each([MeetingStatus.Finished, MeetingStatus.Scheduled, MeetingStatus.Active, MeetingStatus.Pending])(
    'rejects deletion if a new minute with status %s appears before commit', async (status) => {
      const { client, ops, docs } = createClient()
      const commit = ops.commit.bind(ops)
      const concurrent = { ...completedMinutes, _id: 'concurrent' as Ref<MeetingMinutes>, status }
      jest.spyOn(ops, 'commit').mockImplementationOnce(async () => {
        docs.set(concurrent._id, concurrent)
        return await commit()
      })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await expect(removeRoom(client, room)).rejects.toMatchObject({ status: { code: love.string.RoomRemovalFailed } })
        expect(docs.get(completedMinutes._id)).toEqual(completedMinutes)
        expect(docs.get(concurrent._id)).toEqual(concurrent)
        expect(docs.has(room._id)).toBe(true)
      } finally {
        warn.mockRestore()
      }
    }
  )

  it('rejects deletion if a finished minute becomes active before commit', async () => {
    const { client, ops, docs } = createClient()
    const commit = ops.commit.bind(ops)
    jest.spyOn(ops, 'commit').mockImplementationOnce(async () => {
      const activeMinute: MeetingMinutes = { ...completedMinutes, status: MeetingStatus.Active }
      docs.set(activeMinute._id, activeMinute)
      return await commit()
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(removeRoom(client, room)).rejects.toMatchObject({ status: { code: love.string.RoomRemovalFailed } })
      expect(docs.get(completedMinutes._id)).toMatchObject({ attachedTo: room._id, status: MeetingStatus.Active })
      expect(docs.has(room._id)).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('preserves the localized status through the RoomConfigure error handler', async () => {
    const { client } = createClient([{ ...completedMinutes, status: MeetingStatus.Scheduled }])
    expect.assertions(2)
    try {
      await removeRoom(client, room)
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformError)
      expect(unknownError(error).code).toBe(love.string.RoomHasUnfinishedMeetings)
    }
  })
})

describe('getMeetingMinutesQuery', () => {
  it('includes floor minutes alongside surviving room minutes', () => {
    expect(getMeetingMinutesQuery(floor, [room])).toEqual({ attachedTo: { $in: [room._id, floor._id] } })
  })

  it('still lists preserved minutes after the last room is deleted and the floor reloads', async () => {
    const { client } = createClient()
    await removeRoom(client, room)
    const query = getMeetingMinutesQuery({ ...floor }, [])

    expect(query).toEqual({ attachedTo: { $in: [floor._id] } })
    expect(await client.findAll(love.class.MeetingMinutes, query)).toEqual(toFindResult(
      minutes.map((minute) => ({ ...minute, attachedTo: floor._id, attachedToClass: love.class.Floor }))
    ))
  })
})

describe('getMeetingRoomId', () => {
  it.each([love.class.Room, love.class.Office])('returns room attachments of class %s', (attachedToClass) => {
    expect(getMeetingRoomId({ ...completedMinutes, attachedToClass })).toBe(room._id)
  })

  it.each([MeetingStatus.Finished, MeetingStatus.Scheduled, MeetingStatus.Active, MeetingStatus.Pending])(
    'never interprets a floor as a room, even with stale status %s', (status) => {
      expect(getMeetingRoomId({ ...completedMinutes, status })).toBe(room._id)
      expect(getMeetingRoomId({ ...completedMinutes, status, attachedTo: floor._id, attachedToClass: love.class.Floor }))
        .toBeUndefined()
    }
  )

  it('handles missing minutes while participant state loads', () => {
    expect(getMeetingRoomId(completedMinutes)).toBe(room._id)
    expect(getMeetingRoomId(undefined)).toBeUndefined()
  })
})
