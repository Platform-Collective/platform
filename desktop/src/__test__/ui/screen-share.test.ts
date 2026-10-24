// SPDX-License-Identifier: EPL-2.0

import { setCustomCreateScreenTracks } from '@hcengineering/love-resources'
import { showPopup } from '@hcengineering/ui'
import { LocalAudioTrack, LocalVideoTrack, Track, TrackInvalidError } from 'livekit-client'
import type { LocalParticipant, LocalTrack } from 'livekit-client'
import { defineGetDisplayMedia, defineScreenShare } from '../../ui/screenShare'

jest.mock('electron-log', () => ({ __esModule: true, default: { error: jest.fn() } }))
jest.mock('@hcengineering/love', () => ({
  __esModule: true,
  default: { component: { SelectScreenSourcePopup: 'select-source' } }
}))
jest.mock('@hcengineering/love-resources', () => ({ setCustomCreateScreenTracks: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({ showPopup: jest.fn() }))
jest.mock('livekit-client', () => ({
  Track: { Source: { ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio' } },
  ParticipantEvent: { AudioStreamAcquired: 'audioStreamAcquired' },
  ScreenSharePresets: { h1080fps30: { resolution: { width: 1920, height: 1080, frameRate: 30 } } },
  DeviceUnsupportedError: class extends Error {},
  TrackInvalidError: class extends Error {},
  LocalVideoTrack: jest.fn((mediaStreamTrack) => ({ mediaStreamTrack })),
  LocalAudioTrack: jest.fn((mediaStreamTrack) => ({ mediaStreamTrack }))
}))

const getUserMedia = jest.fn()
const participant = { roomOptions: {}, emit: jest.fn() } as unknown as LocalParticipant
const videoTrack = { kind: 'video' } as unknown as MediaStreamTrack
const audioTrack = { kind: 'audio' } as unknown as MediaStreamTrack

function streamWith (video: MediaStreamTrack[], audio: MediaStreamTrack[] = []): MediaStream {
  return { getVideoTracks: () => video, getAudioTracks: () => audio } as unknown as MediaStream
}

async function selectSource (popupIndex: number = 0): Promise<void> {
  // Allow the IPC permission and source requests to finish before using the popup.
  await Promise.resolve()
  await Promise.resolve()
  expect(showPopup).toHaveBeenCalledTimes(popupIndex + 1)
  const [, , , onClose, onSelect] = jest.mocked(showPopup).mock.calls[popupIndex]
  await onSelect?.('screen:0')
  await onClose?.(undefined)
}

function createScreenTracks (): Promise<LocalTrack[]> {
  defineScreenShare()
  return jest.mocked(setCustomCreateScreenTracks).mock.calls[0][0].call(participant)
}

beforeEach(() => {
  jest.clearAllMocks()
  getUserMedia.mockReset()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: jest.fn(), getUserMedia }
  })
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      getScreenSources: jest.fn().mockResolvedValue([{ id: 'screen:0' }]),
      getScreenAccess: jest.fn().mockResolvedValue(true)
    }
  })
})

describe('desktop display capture', () => {
  test('forwards a rejected Windows capture request', async () => {
    const error = new DOMException('Permission denied', 'NotAllowedError')
    getUserMedia.mockRejectedValue(error)
    defineGetDisplayMedia()

    const capture = navigator.mediaDevices.getDisplayMedia({ video: true })
    const rejected = expect(capture).rejects.toBe(error)
    await selectSource()
    await rejected
  })

  test('returns the selected display stream', async () => {
    const stream = streamWith([videoTrack])
    getUserMedia.mockResolvedValue(stream)
    defineGetDisplayMedia()

    const capture = navigator.mediaDevices.getDisplayMedia({ video: true })
    await selectSource()

    await expect(capture).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'screen:0' } }
    })
  })
})

describe('desktop LiveKit capture', () => {
  test('forwards a rejected Windows capture request', async () => {
    const error = new DOMException('Could not start video source', 'NotReadableError')
    getUserMedia.mockRejectedValue(error)

    const capture = createScreenTracks()
    const rejected = expect(capture).rejects.toBe(error)
    await selectSource()
    await rejected
  })

  test('rejects when the captured stream has no video track', async () => {
    getUserMedia.mockResolvedValue(streamWith([]))

    const capture = createScreenTracks()
    const rejected = expect(capture).rejects.toBeInstanceOf(TrackInvalidError)
    await selectSource()
    await rejected
  })

  test.each([LocalVideoTrack, LocalAudioTrack])('forwards track constructor errors (%#)', async (constructor) => {
    const error = new Error('Unable to construct track')
    getUserMedia.mockResolvedValue(streamWith([videoTrack], [audioTrack]))
    jest.mocked(constructor).mockImplementationOnce(() => {
      throw error
    })

    const capture = createScreenTracks()
    const rejected = expect(capture).rejects.toBe(error)
    await selectSource()
    await rejected
  })

  test('returns the screen video and audio tracks', async () => {
    getUserMedia.mockResolvedValue(streamWith([videoTrack], [audioTrack]))

    const capture = createScreenTracks()
    await selectSource()

    await expect(capture).resolves.toEqual([
      { mediaStreamTrack: videoTrack, source: Track.Source.ScreenShare },
      { mediaStreamTrack: audioTrack, source: Track.Source.ScreenShareAudio }
    ])
  })

  test('can capture again after a rejected request', async () => {
    const error = new DOMException('Permission denied', 'NotAllowedError')
    getUserMedia.mockRejectedValueOnce(error).mockResolvedValueOnce(streamWith([videoTrack]))
    defineScreenShare()
    const createTracks = jest.mocked(setCustomCreateScreenTracks).mock.calls[0][0].bind(participant)

    const capture = createTracks()
    const rejected = expect(capture).rejects.toBe(error)
    await selectSource()
    await rejected

    const retry = createTracks()
    await selectSource(1)

    await expect(retry).resolves.toEqual([{ mediaStreamTrack: videoTrack, source: Track.Source.ScreenShare }])
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })
})
