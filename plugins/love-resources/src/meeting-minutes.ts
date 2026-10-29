// SPDX-License-Identifier: EPL-2.0

import type { DocumentQuery, TxOperations } from '@hcengineering/core'
import love, { MeetingStatus, type Floor, type MeetingMinutes, type Room } from '@hcengineering/love'
import { PlatformError, Severity, Status } from '@hcengineering/platform'

/** Remove a room while preserving its meeting minutes on the floor. */
export async function removeRoom (client: Pick<TxOperations, 'findAll' | 'apply'>, room: Room): Promise<void> {
  const minutes = await client.findAll(love.class.MeetingMinutes, { attachedTo: room._id })
  if (minutes.some((minute) => minute.status !== MeetingStatus.Finished)) {
    throw new PlatformError(new Status(Severity.ERROR, love.string.RoomHasUnfinishedMeetings, {}))
  }

  // Share the scope with meeting creation and verify the snapshot before deleting.
  const ops = client.apply(`create_meeting_${room._id}`)
  ops.match(room._class, { _id: room._id, floor: room.floor })
  ops.match(love.class.Floor, { _id: room.floor })
  ops.notMatch(love.class.MeetingMinutes, {
    attachedTo: room._id,
    status: { $ne: MeetingStatus.Finished }
  })
  ops.notMatch(love.class.MeetingMinutes, {
    attachedTo: room._id,
    _id: { $nin: minutes.map((minute) => minute._id) }
  })
  for (const minute of minutes) {
    ops.match(love.class.MeetingMinutes, {
      _id: minute._id,
      attachedTo: room._id,
      status: MeetingStatus.Finished
    })
    // Retain the old collection metadata so server bookkeeping can transfer its counter.
    await ops.updateCollection(
      minute._class,
      minute.space,
      minute._id,
      minute.attachedTo,
      minute.attachedToClass,
      minute.collection,
      { attachedTo: room.floor, attachedToClass: love.class.Floor, collection: 'meetings' }
    )
  }
  await ops.remove(room)
  const { result } = await ops.commit()
  if (!result) {
    throw new PlatformError(new Status(Severity.ERROR, love.string.RoomRemovalFailed, {}))
  }
}

/** Include minutes from existing rooms and minutes preserved on the floor. */
export function getMeetingMinutesQuery (floor: Floor, rooms: Room[]): DocumentQuery<MeetingMinutes> {
  return { attachedTo: { $in: [...rooms.map((room) => room._id), floor._id] } }
}
