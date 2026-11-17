// SPDX-License-Identifier: EPL-2.0

import type { ConnectMeetingRequest } from '@hcengineering/ai-bot'
import type { Person } from '@hcengineering/contact'
import type { MeasureContext, Ref, TxOperations, WorkspaceUuid } from '@hcengineering/core'
import type { MeetingMinutes, ParticipantInfo, Room, RoomLanguage } from '@hcengineering/love'
import { LoveController } from '../love'

jest.mock('../../config', () => ({
  __esModule: true,
  default: { LoveEndpoint: 'http://love' }
}))

describe('LoveController transcription', () => {
  const meetingId = 'meeting' as Ref<MeetingMinutes>
  const roomId = 'room' as Ref<Room>
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.useFakeTimers()
    global.fetch = jest.fn().mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  async function connect (language: RoomLanguage | undefined, requestedLanguage: RoomLanguage): Promise<LoveController> {
    const room = { _id: roomId, name: 'Room', language } as unknown as Room
    const client = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ _id: meetingId, attachedTo: roomId })
    } as unknown as TxOperations
    const controller = new LoveController(
      'workspace' as WorkspaceUuid,
      { info: jest.fn() } as unknown as MeasureContext,
      'token',
      client,
      { _id: 'person' } as unknown as Person
    )
    jest.spyOn(controller, 'getRoom').mockResolvedValue(room)
    jest.spyOn(controller, 'createAiParticipant').mockResolvedValue('participant' as Ref<ParticipantInfo>)

    const request: ConnectMeetingRequest = { meetingId, language: requestedLanguage, transcription: true }
    await controller.connect(request)
    return controller
  }

  it.each<RoomLanguage>(['es', 'en'])('starts transcription with the saved room language %s', async (language) => {
    await connect(language, 'en')

    expect(global.fetch).toHaveBeenCalledWith(
      'http://love/transcription',
      expect.objectContaining({
        body: expect.any(String)
      })
    )
    const [, options] = jest.mocked(global.fetch).mock.calls[0]
    expect(JSON.parse(options?.body as string)).toMatchObject({ meetingId, language, transcription: true })
  })

  it('preserves the requested language when the room has no language', async () => {
    await connect(undefined, 'fr')

    const [, options] = jest.mocked(global.fetch).mock.calls[0]
    expect(JSON.parse(options?.body as string)).toMatchObject({ meetingId, language: 'fr', transcription: true })
  })

  it('stops transcription for the requested meeting even when it is no longer active', async () => {
    const controller = await connect('es', 'en')
    jest.spyOn(controller, 'getRoomParticipant').mockResolvedValue(undefined)
    const getMeetingMinutes = jest.spyOn(controller, 'getMeetingMinutes').mockResolvedValue(undefined)

    await controller.disconnectMeeting(meetingId)

    expect(getMeetingMinutes).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(2)
    const [url, options] = jest.mocked(global.fetch).mock.calls[1]
    expect(url).toBe('http://love/transcription')
    expect(JSON.parse(options?.body as string)).toEqual({ meetingId, transcription: false })
    expect(controller.hasActiveConnections()).toBe(false)
  })

  it('stops transcription for the active meeting during automatic disconnect', async () => {
    const controller = await connect('es', 'en')
    jest.spyOn(controller, 'getRoomParticipant').mockResolvedValue(undefined)
    jest.spyOn(controller, 'getMeetingMinutes').mockResolvedValue({ _id: meetingId } as unknown as MeetingMinutes)

    await controller.checkConnection()
    // Automatic cleanup starts disconnect without awaiting it.
    await jest.advanceTimersByTimeAsync(0)

    expect(global.fetch).toHaveBeenCalledTimes(2)
    const [url, options] = jest.mocked(global.fetch).mock.calls[1]
    expect(url).toBe('http://love/transcription')
    expect(JSON.parse(options?.body as string)).toEqual({ meetingId, transcription: false })
    expect(controller.hasActiveConnections()).toBe(false)
  })

  it('skips the stop request when no active meeting can be found', async () => {
    const controller = await connect('es', 'en')
    jest.spyOn(controller, 'getRoomParticipant').mockResolvedValue(undefined)
    jest.spyOn(controller, 'getMeetingMinutes').mockResolvedValue(undefined)

    await controller.disconnect(roomId)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(controller.hasActiveConnections()).toBe(false)
  })
})
