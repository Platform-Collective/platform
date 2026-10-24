// SPDX-License-Identifier: EPL-2.0

import type { DocumentQuery, TxOperations } from '@hcengineering/core'
import love, { type Floor, type MeetingMinutes, type Room } from '@hcengineering/love'

/** Remove a room while preserving its meeting minutes on the floor. */
export async function removeRoom (
  client: Pick<TxOperations, 'findAll' | 'update' | 'remove'>,
  room: Room
): Promise<void> {
  const minutes = await client.findAll(love.class.MeetingMinutes, { attachedTo: room._id })
  await Promise.all(
    minutes.map(async (minute) => {
      await client.update(minute, { attachedTo: room.floor, attachedToClass: love.class.Floor })
    })
  )
  await client.remove(room)
}

/** Include minutes from existing rooms and minutes preserved on the floor. */
export function getMeetingMinutesQuery (floor: Floor, rooms: Room[]): DocumentQuery<MeetingMinutes> {
  return { attachedTo: { $in: [...rooms.map((room) => room._id), floor._id] } }
}
