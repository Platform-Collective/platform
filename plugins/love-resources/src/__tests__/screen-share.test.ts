// SPDX-License-Identifier: EPL-2.0

import { addNotification, NotificationSeverity } from '@hcengineering/ui'
import { LiveKitClient } from '../liveKitClient'

jest.mock(
  '@hcengineering/platform',
  () => ({
    translate: jest.fn(async (key) => key)
  }),
  { virtual: true }
)
jest.mock('@hcengineering/media', () => ({}), { virtual: true })
jest.mock('@hcengineering/love', () => ({}), { virtual: true })
jest.mock('@hcengineering/media-resources', () => ({}), { virtual: true })
jest.mock('@hcengineering/analytics', () => ({}), { virtual: true })
jest.mock('@hcengineering/ui', () => ({ addNotification: jest.fn(), NotificationSeverity: { Error: 'error' } }), { virtual: true })
jest.mock('@hcengineering/view-resources', () => ({ SimpleNotification: {} }), { virtual: true })
jest.mock('@hcengineering/theme', () => ({ getCurrentLanguage: () => 'en' }), { virtual: true })
jest.mock('svelte/store', () => ({ writable: jest.fn() }), { virtual: true })
jest.mock('../components/meeting/LastParticipantNotification.svelte', () => ({}))
jest.mock('../plugin', () => ({ string: { ScreenShareFailed: 'failed', ScreenShareDenied: 'denied', ScreenShareError: 'generic' } }))
jest.mock('../stores', () => ({}))
jest.mock('../meetings', () => ({}))

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
beforeAll(() => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getDisplayMedia: jest.fn() } } })
})
afterAll(() => {
  if (navigatorDescriptor !== undefined) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
  else Reflect.deleteProperty(globalThis, 'navigator')
})

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

  expect(addNotification).toHaveBeenCalledWith('failed', 'generic', expect.anything(), undefined, NotificationSeverity.Error, 'love')

  await client.setScreenShareEnabled(true, true)

  expect(setScreenShareEnabled).toHaveBeenCalledTimes(2)
  expect(setScreenShareEnabled).toHaveBeenLastCalledWith(true, { audio: true })
  expect(addNotification).toHaveBeenCalledTimes(1)
})

test('does not show an error when source selection is cancelled', async () => {
  setScreenShareEnabled.mockRejectedValueOnce(new DOMException('No source selected', 'AbortError'))

  await client.setScreenShareEnabled(true)

  expect(addNotification).not.toHaveBeenCalled()
})

test('does not show an error when the browser picker is dismissed', async () => {
  setScreenShareEnabled.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))

  await client.setScreenShareEnabled(true)

  expect(addNotification).not.toHaveBeenCalled()
})

test('surfaces screen capture blocked by the operating system', async () => {
  const error = new DOMException('Permission denied by system', 'NotAllowedError')
  setScreenShareEnabled.mockRejectedValueOnce(error)

  await client.setScreenShareEnabled(true)

  expect(addNotification).toHaveBeenCalledWith('failed', 'denied', expect.anything(), undefined, NotificationSeverity.Error, 'love')
})
