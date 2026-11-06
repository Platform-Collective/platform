// SPDX-License-Identifier: EPL-2.0

import { get } from 'svelte/store'
import { createScreenRecorder } from '../screen-recorder'
import { recorder } from '../stores/recorder'
import { UploadCancelledError } from '../uploader'
import { addNotification } from '@hcengineering/ui'
import { manager } from '../stores/manager'
import { composer } from '../stores/composer'
import { translate } from '@hcengineering/platform'

jest.mock('../screen-recorder', () => ({ createScreenRecorder: jest.fn() }))
jest.mock('../stores/composer', () => ({
  composer: {
    initialize: jest.fn(),
    cleanup: jest.fn(),
    getStream: () => ({ getVideoTracks: () => [] }),
    updateCameraStream: jest.fn(),
    updateScreenStream: jest.fn()
  }
}))
jest.mock('../stores/manager', () => ({
  camStream: { subscribe: jest.fn() },
  screenStream: { subscribe: jest.fn() },
  manager: {
    subscribe: (subscriber: (state: object) => void) => {
      subscriber({ screenStream: null, micStream: null })
      return () => {}
    },
    initialize: jest.fn(),
    cleanup: jest.fn(),
    setCallbacks: jest.fn()
  }
}))
jest.mock('@hcengineering/platform', () => ({ translate: jest.fn(async () => 'Upload failed') }), { virtual: true })
jest.mock('@hcengineering/theme', () => ({ getCurrentLanguage: () => 'en' }), { virtual: true })
jest.mock(
  '@hcengineering/ui',
  () => ({
    addNotification: jest.fn(),
    NotificationSeverity: { Error: 3 }
  }),
  { virtual: true }
)
jest.mock('../components/UploadFailedNotification.svelte', () => ({ __esModule: true, default: {} }))
jest.mock('@hcengineering/presentation', () => ({ deleteFile: jest.fn() }), { virtual: true })
jest.mock('../plugin', () => ({ __esModule: true, default: { string: { UploadFailed: '' } } }))

function deferred<T> (): { promise: Promise<T>, resolve: (value: T) => void, reject: (error: Error) => void } {
  let resolvePromise: (value: T) => void = () => {}
  let rejectPromise: (error: Error) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

beforeEach(async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: jest.fn() })
  await recorder.cleanup()
  jest.clearAllMocks()
})

afterEach(async () => {
  await recorder.cleanup()
})

async function start (stop: () => Promise<unknown>): Promise<void> {
  jest.mocked(createScreenRecorder).mockResolvedValue({
    start: jest.fn(),
    stop,
    cancel: jest.fn(),
    elapsedTime: 0
  } as unknown as Awaited<ReturnType<typeof createScreenRecorder>>)
  await recorder.initialize({})
  await recorder.start()
}

test('failed stop settles stopped/null, always releases capture resources, and shows a notification', async () => {
  await start(async () => {
    throw new Error('upload failed')
  })
  await recorder.stop()
  expect(get(recorder)).toMatchObject({ state: 'stopped', result: null })
  expect(manager.cleanup).toHaveBeenCalledTimes(1)
  expect(composer.cleanup).toHaveBeenCalledTimes(1)
  expect(addNotification).toHaveBeenCalledTimes(1)
})

test('cancellation rejects stop without showing an upload failure notification', async () => {
  await start(async () => {
    throw new UploadCancelledError()
  })
  await recorder.stop()
  expect(get(recorder)).toMatchObject({ state: 'stopped', result: null })
  expect(addNotification).not.toHaveBeenCalled()
  expect(manager.cleanup).toHaveBeenCalledTimes(1)
})

test('cancel overlapping stop cannot restore the stopped state or show a failure notification', async () => {
  const pending = deferred<never>()
  await start(async () => await pending.promise)
  const stopped = recorder.stop()
  await recorder.cancel()
  pending.reject(new UploadCancelledError())
  await stopped
  expect(get(recorder)).toMatchObject({ state: 'idle', result: null })
  expect(addNotification).not.toHaveBeenCalled()
  expect(manager.cleanup).toHaveBeenCalledTimes(1)
})

test('cancel while loading the failure message suppresses the late notification', async () => {
  const message = deferred<string>()
  jest.mocked(translate).mockImplementationOnce(async () => await message.promise)
  await start(async () => {
    throw new Error('upload failed')
  })
  const stopped = recorder.stop()
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve)
  })
  await recorder.cancel()
  message.resolve('Upload failed')
  await stopped
  expect(get(recorder)).toMatchObject({ state: 'idle', result: null })
  expect(addNotification).not.toHaveBeenCalled()
})
