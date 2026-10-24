// SPDX-License-Identifier: EPL-2.0

import core, { toFindResult, type MarkupBlobRef, type Ref } from '@hcengineering/core'
import love, {
  MeetingStatus,
  RecordingState,
  RoomAccess,
  TranscriptionState,
  type Floor,
  type MeetingMinutes,
  type Room
} from '@hcengineering/love'
import { getMeetingMinutesQuery, removeRoom } from '../meeting-minutes'

const floor = { _id: 'floor' as Ref<Floor> } as unknown as Floor
const room = { _id: 'room' as Ref<Room>, floor: floor._id, _class: love.class.Room } as unknown as Room
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
const minutes: MeetingMinutes[] = [
  completedMinutes,
  {
    ...completedMinutes,
    _id: 'minutes-2' as Ref<MeetingMinutes>,
    status: MeetingStatus.Scheduled
  }
]

interface MockClient {
  findAll: jest.Mock
  update: jest.Mock
  remove: jest.Mock
}

function createClient (): MockClient {
  return {
    findAll: jest.fn().mockResolvedValue(toFindResult(minutes)),
    update: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue({})
  }
}

describe('removeRoom', () => {
  it('moves every minute, including completed minutes, without changing notes or recording collections', async () => {
    const client = createClient()

    await removeRoom(client, room)

    expect(client.findAll).toHaveBeenCalledWith(love.class.MeetingMinutes, { attachedTo: room._id })
    expect(client.update).toHaveBeenCalledTimes(minutes.length)
    for (const minute of minutes) {
      expect(client.update).toHaveBeenCalledWith(minute, {
        attachedTo: floor._id,
        attachedToClass: love.class.Floor
      })
    }
    expect(client.remove).toHaveBeenCalledTimes(1)
    expect(client.remove).toHaveBeenCalledWith(room)
  })

  it('waits for every move to finish before deleting the room', async () => {
    const client = createClient()
    const pendingMoves: Array<() => void> = []
    client.update.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        pendingMoves.push(resolve)
      })
    })

    const removal = removeRoom(client, room)
    await Promise.resolve()
    expect(pendingMoves).toHaveLength(2)
    expect(client.remove).not.toHaveBeenCalled()

    pendingMoves[0]()
    await Promise.resolve()
    expect(client.remove).not.toHaveBeenCalled()

    pendingMoves[1]()
    await removal
    expect(client.remove).toHaveBeenCalledWith(room)
  })

  it('keeps the room if finding its minutes fails', async () => {
    const client = createClient()
    const error = new Error('Unable to load minutes')
    client.findAll.mockRejectedValue(error)

    await expect(removeRoom(client, room)).rejects.toThrow(error)
    expect(client.update).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
  })

  it('keeps the room if any minute cannot be preserved', async () => {
    const client = createClient()
    const error = new Error('Unable to move minutes')
    client.update.mockResolvedValueOnce({}).mockRejectedValueOnce(error)

    await expect(removeRoom(client, room)).rejects.toThrow(error)
    expect(client.remove).not.toHaveBeenCalled()
  })

  it('allows deleting a room without minutes', async () => {
    const client = createClient()
    client.findAll.mockResolvedValue(toFindResult([]))

    await removeRoom(client, room)

    expect(client.update).not.toHaveBeenCalled()
    expect(client.remove).toHaveBeenCalledWith(room)
  })
})

describe('getMeetingMinutesQuery', () => {
  it('includes floor minutes alongside surviving room minutes', () => {
    expect(getMeetingMinutesQuery(floor, [room])).toEqual({ attachedTo: { $in: [room._id, floor._id] } })
  })

  it('still lists preserved minutes after the last room is deleted and the floor reloads', () => {
    expect(getMeetingMinutesQuery({ ...floor }, [])).toEqual({ attachedTo: { $in: [floor._id] } })
  })
})
