// SPDX-License-Identifier: EPL-2.0

import { setPlatformStatus, unknownError } from '@hcengineering/platform'
import { LiveKitClient } from '../liveKitClient'

const mockSetScreenShareEnabled = jest.fn()

jest.mock('svelte/store', () => ({
  get: jest.fn(),
  writable: jest.fn(() => ({ set: jest.fn(), update: jest.fn(), subscribe: jest.fn() }))
}))
jest.mock('livekit-client', () => ({
  Room: jest.fn(() => ({
    on: jest.fn(),
    localParticipant: { setScreenShareEnabled: mockSetScreenShareEnabled }
  })),
  RoomEvent: {}
}))
jest.mock('@hcengineering/platform', () => ({
  setPlatformStatus: jest.fn().mockResolvedValue(undefined),
  unknownError: jest.fn((error) => ({ error }))
}))
jest.mock('@hcengineering/media', () => ({ getSelectedSpeakerId: jest.fn() }))
jest.mock('@hcengineering/love', () => ({}))
jest.mock('@hcengineering/media-resources', () => ({}))
jest.mock('@hcengineering/analytics', () => ({}))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('@hcengineering/theme', () => ({}))
jest.mock('../components/meeting/LastParticipantNotification.svelte', () => ({}))
jest.mock('../plugin', () => ({}))
jest.mock('../stores', () => ({}))
jest.mock('../meetings', () => ({}))

beforeEach(() => {
  jest.clearAllMocks()
  mockSetScreenShareEnabled.mockReset()
})

test('displays capture failure and allows another sharing attempt', async () => {
  const client = new LiveKitClient()
  const error = new DOMException('Could not start video source', 'NotReadableError')
  mockSetScreenShareEnabled.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)

  await client.setScreenShareEnabled(true, true)

  expect(unknownError).toHaveBeenCalledWith(error)
  expect(setPlatformStatus).toHaveBeenCalledWith(unknownError(error))

  await client.setScreenShareEnabled(true, true)

  expect(mockSetScreenShareEnabled).toHaveBeenCalledTimes(2)
  expect(mockSetScreenShareEnabled).toHaveBeenLastCalledWith(true, { audio: true })
  expect(setPlatformStatus).toHaveBeenCalledTimes(1)
})

test.each([new DOMException('Permission denied', 'NotAllowedError'), new Error('No source selected')])(
  'does not display an error when the user cancels sharing (%#)',
  async (error) => {
    const client = new LiveKitClient()
    mockSetScreenShareEnabled.mockRejectedValueOnce(error)

    await client.setScreenShareEnabled(true)

    expect(setPlatformStatus).not.toHaveBeenCalled()
  }
)

test('does not display an error after successful capture', async () => {
  const client = new LiveKitClient()
  mockSetScreenShareEnabled.mockResolvedValue(undefined)

  await client.setScreenShareEnabled(true)

  expect(setPlatformStatus).not.toHaveBeenCalled()
  expect(mockSetScreenShareEnabled).toHaveBeenCalledWith(true, { audio: false })
})
