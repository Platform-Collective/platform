// SPDX-License-Identifier: EPL-2.0

import { setCustomCreateScreenTracks } from '@hcengineering/love-resources'
import { showPopup } from '@hcengineering/ui'
import { LocalVideoTrack, Track, TrackInvalidError, type LocalParticipant } from 'livekit-client'
import { defineGetDisplayMedia, defineScreenShare } from '../../ui/screenShare'
import { ipcMainExposed } from '../../ui/typesUtils'

// The desktop tsconfig has no esModuleInterop, so default imports need an explicit `default` export.
jest.mock('electron-log', () => ({ __esModule: true, default: { error: jest.fn() } }), { virtual: true })
jest.mock(
  '@hcengineering/love',
  () => ({ __esModule: true, default: { component: { SelectScreenSourcePopup: 'select-screen' } } }),
  { virtual: true }
)
jest.mock('@hcengineering/love-resources', () => ({ setCustomCreateScreenTracks: jest.fn() }), { virtual: true })
jest.mock('@hcengineering/ui', () => ({ showPopup: jest.fn() }), { virtual: true })
jest.mock('../../ui/typesUtils', () => ({ ipcMainExposed: jest.fn() }))
jest.mock('livekit-client', () => {
  const { TextEncoder, TextDecoder } = jest.requireActual('util')
  Object.assign(globalThis, { TextEncoder, TextDecoder })
  return {
    ...jest.requireActual('livekit-client'),
    LocalVideoTrack: jest.fn().mockImplementation((track) => ({ mediaStreamTrack: track })),
    LocalAudioTrack: jest.fn().mockImplementation((track) => ({ mediaStreamTrack: track }))
  }
})

const getUserMedia = jest.fn()
const getScreenAccess = jest.fn()
const videoTrack = { contentHint: '' } as MediaStreamTrack
const stream = {
  getVideoTracks: () => [videoTrack],
  getAudioTracks: () => []
} as unknown as MediaStream
const participant = {
  roomOptions: { loggerName: 'test' },
  logContext: {},
  emit: jest.fn()
} as unknown as LocalParticipant

beforeEach(() => {
  jest.clearAllMocks()
  getScreenAccess.mockResolvedValue(true)
  getUserMedia.mockReset().mockResolvedValue(stream)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, getDisplayMedia: jest.fn() }
  })
  jest.mocked(ipcMainExposed).mockReturnValue({
    getScreenSources: jest.fn().mockResolvedValue([]),
    getScreenAccess
  } as unknown as ReturnType<typeof ipcMainExposed>)
  jest.mocked(showPopup).mockImplementation((_component, _props, _position, onClose, onUpdate) => {
    onUpdate?.('screen:1')
    onClose?.(undefined)
    return { id: 'popup', close: jest.fn(), update: jest.fn() }
  })
})

describe.each(['getDisplayMedia', 'createScreenTracks'])('%s', (adapter) => {
  let capture: () => Promise<MediaStream | Awaited<ReturnType<LocalParticipant['createScreenTracks']>>>

  beforeEach(() => {
    if (adapter === 'getDisplayMedia') {
      defineGetDisplayMedia()
      capture = async () => await navigator.mediaDevices.getDisplayMedia({ video: true })
    } else {
      defineScreenShare()
      const createScreenTracks = jest.mocked(setCustomCreateScreenTracks).mock.calls[0][0]
      capture = async () => await createScreenTracks.call(participant)
    }
  })

  test.each(['NotAllowedError', 'NotReadableError'])('rejects %s and allows retry', async (name) => {
    const error = new DOMException('Screen capture permission denied', name)
    getUserMedia.mockRejectedValueOnce(error)

    await expect(capture()).rejects.toBe(error)
    await expect(capture()).resolves.toBeDefined()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  test('rejects denied access before capture and allows retry', async () => {
    getScreenAccess.mockResolvedValueOnce(false)

    await expect(capture()).rejects.toThrow('No screen access granted')
    expect(getUserMedia).not.toHaveBeenCalled()
    await expect(capture()).resolves.toBeDefined()
  })

  test('rejects cancellation without starting capture', async () => {
    jest.mocked(showPopup).mockImplementation((_component, _props, _position, onClose) => {
      onClose?.(undefined)
      return { id: 'popup', close: jest.fn(), update: jest.fn() }
    })

    await expect(capture()).rejects.toMatchObject({ name: 'AbortError' })
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  test('captures the selected source', async () => {
    const result = await capture()

    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({
          mandatory: expect.objectContaining({ chromeMediaSource: 'desktop', chromeMediaSourceId: 'screen:1' })
        })
      })
    )
    if (adapter === 'getDisplayMedia') {
      expect(result).toBe(stream)
    } else {
      expect(result).toEqual([expect.objectContaining({ source: Track.Source.ScreenShare })])
    }
  })
})

test('rejects an empty video stream and allows retry', async () => {
  defineScreenShare()
  const capture = jest.mocked(setCustomCreateScreenTracks).mock.calls[0][0]
  getUserMedia.mockResolvedValueOnce({ getVideoTracks: () => [], getAudioTracks: () => [] })

  await expect(capture.call(participant)).rejects.toBeInstanceOf(TrackInvalidError)
  await expect(capture.call(participant)).resolves.toHaveLength(1)
})

test('rejects track conversion errors', async () => {
  defineScreenShare()
  const capture = jest.mocked(setCustomCreateScreenTracks).mock.calls[0][0]
  const error = new Error('Track conversion failed')
  jest.mocked(LocalVideoTrack).mockImplementationOnce(() => {
    throw error
  })

  await expect(capture.call(participant)).rejects.toBe(error)
})
