// SPDX-License-Identifier: EPL-2.0

import { setPlatformStatus, unknownError } from '@hcengineering/platform'
import { LiveKitClient } from '../liveKitClient'

jest.mock(
  '@hcengineering/platform',
  () => ({
    setPlatformStatus: jest.fn().mockResolvedValue(undefined),
    unknownError: jest.fn((error) => ({ error }))
  }),
  { virtual: true }
)
jest.mock('@hcengineering/media', () => ({}), { virtual: true })
jest.mock('@hcengineering/love', () => ({}), { virtual: true })
jest.mock('@hcengineering/media-resources', () => ({}), { virtual: true })
jest.mock('@hcengineering/analytics', () => ({}), { virtual: true })
jest.mock('@hcengineering/ui', () => ({}), { virtual: true })
jest.mock('@hcengineering/theme', () => ({}), { virtual: true })
jest.mock('svelte/store', () => ({ writable: jest.fn() }), { virtual: true })
jest.mock('../components/meeting/LastParticipantNotification.svelte', () => ({}))
jest.mock('../plugin', () => ({}))
jest.mock('../stores', () => ({}))
jest.mock('../meetings', () => ({}))

const setScreenShareEnabled = jest.fn()
let client: LiveKitClient

beforeEach(() => {
  jest.clearAllMocks()
  setScreenShareEnabled.mockReset().mockResolvedValue(undefined)
  client = Object.create(LiveKitClient.prototype) as LiveKitClient
  Object.defineProperty(client, 'liveKitRoom', { value: { localParticipant: { setScreenShareEnabled } } })
})

test('surfaces capture failures and permits a successful retry', async () => {
  const error = new Error('No screen access granted')
  setScreenShareEnabled.mockRejectedValueOnce(error)

  await client.setScreenShareEnabled(true, true)

  expect(unknownError).toHaveBeenCalledWith(error)
  expect(setPlatformStatus).toHaveBeenCalledWith(unknownError(error))

  await client.setScreenShareEnabled(true, true)

  expect(setScreenShareEnabled).toHaveBeenCalledTimes(2)
  expect(setScreenShareEnabled).toHaveBeenLastCalledWith(true, { audio: true })
  expect(setPlatformStatus).toHaveBeenCalledTimes(1)
})

test('does not show an error when source selection is cancelled', async () => {
  setScreenShareEnabled.mockRejectedValueOnce(new DOMException('No source selected', 'AbortError'))

  await client.setScreenShareEnabled(true)

  expect(setPlatformStatus).not.toHaveBeenCalled()
})

test('does not show an error when the browser picker is dismissed', async () => {
  setScreenShareEnabled.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))

  await client.setScreenShareEnabled(true)

  expect(setPlatformStatus).not.toHaveBeenCalled()
})

test('surfaces screen capture blocked by the operating system', async () => {
  const error = new DOMException('Permission denied by system', 'NotAllowedError')
  setScreenShareEnabled.mockRejectedValueOnce(error)

  await client.setScreenShareEnabled(true)

  expect(setPlatformStatus).toHaveBeenCalledWith(unknownError(error))
})
