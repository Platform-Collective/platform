import { concatLink } from '@hcengineering/core'
import love, { RecordingState, type MeetingMinutes, type Room } from '@hcengineering/love'
import { getMetadata } from '@hcengineering/platform'
import { getPlatformToken } from './utils'
import { getCurrentEmployee } from '@hcengineering/contact'
import { getPersonByPersonRef } from '@hcengineering/contact-resources'
import { Analytics } from '@hcengineering/analytics'
import { selectedRoomPlace } from './stores'
import { get } from 'svelte/store'

export function getLoveClient (): LoveClient {
  return new LoveClient()
}

export class LoveClient {
  async getRoomToken (meetingMinutes: MeetingMinutes): Promise<string> {
    return await this.refreshRoomToken(meetingMinutes)
  }

  async updateSessionLanguage (mm: MeetingMinutes, room: Room): Promise<void> {
    try {
      const endpoint = this.getLoveEndpoint()
      const token = getPlatformToken()

      await fetch(concatLink(endpoint, '/language'), {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          meetingId: mm._id,
          language: room.language
        })
      })
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
    }
  }

  async record (mm: MeetingMinutes): Promise<void> {
    try {
      const endpoint = this.getLoveEndpoint()
      const token = getPlatformToken()
      if (mm.recordingState === RecordingState.Recording) {
        await fetch(concatLink(endpoint, '/stopRecord'), {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            meetingId: mm._id,
            title: mm.title
          })
        })
      } else {
        await fetch(concatLink(endpoint, '/startRecord'), {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            meetingId: mm._id,
            title: mm.title
          })
        })
      }
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
    }
  }

  private getLoveEndpoint (): string {
    const endpoint = getMetadata(love.metadata.ServiceEndpoint)
    if (endpoint === undefined) {
      throw new Error('Love service endpoint not found')
    }

    return endpoint
  }

  private async refreshRoomToken (meetingMinutes: MeetingMinutes): Promise<string> {
    const endpoint = this.getLoveEndpoint()
    if (endpoint === undefined) {
      throw new Error('Love service endpoint not found')
    }
    const myPerson = await getPersonByPersonRef(getCurrentEmployee())
    if (myPerson == null) {
      throw new Error('Cannot find current person')
    }
    const platformToken = getPlatformToken()

    const place = get(selectedRoomPlace)

    let x: number | undefined
    let y: number | undefined

    if (meetingMinutes.attachedTo === place?._id && place != null) {
      x = place.x
      y = place.y
    }

    const res = await fetch(concatLink(endpoint, '/getToken'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        meetingId: meetingMinutes._id,
        _id: myPerson._id,
        participantName: myPerson.name,
        x,
        y
      })
    })
    return await res.text()
  }

  async getGuestToken (mm: MeetingMinutes): Promise<string> {
    const res = await fetch(concatLink(this.getLoveEndpoint(), '/guestToken'), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + getPlatformToken(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ meetingId: mm._id })
    })

    if (!res.ok) {
      console.error('Failed to create guest token', { status: res.status })
      return ''
    }

    const data = await res.json()
    return data?.token ?? data
  }
}
