// SPDX-License-Identifier: EPL-2.0

import { Recorder } from '../recorder'
import { releaseStream } from '@hcengineering/media'

jest.mock('@hcengineering/media', () => ({ releaseStream: jest.fn() }), { virtual: true })
jest.mock('../utils', () => ({ formatElapsedTime: () => '' }))

class Capture {
  static instance: Capture
  static isTypeSupported (): boolean {
    return true
  }
  state: RecordingState = 'inactive'
  ondataavailable?: (event: BlobEvent) => void
  onstop?: () => void
  onerror?: (event: Event) => void
  constructor () {
    Capture.instance = this
  }
  start (): void {
    this.state = 'recording'
  }
  requestData (): void {
    this.emit('requested')
  }
  addEventListener (): void {}
  stop (): void {
    this.state = 'inactive'
    queueMicrotask(() => {
      this.emit('final')
      this.onstop?.()
    })
  }
  emit (data: string): void {
    this.ondataavailable?.({ data: new Blob([data]), timecode: 0 } as unknown as BlobEvent)
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Capture })
})

test('normal stop waits for onstop and preserves the final chunk', async () => {
  const recorder = new Recorder({} as unknown as MediaStream, { recoveryEnabled: true })
  recorder.start()
  Capture.instance.emit('start')
  await recorder.stop()
  const replay = recorder.asStream().replayBlob()
  expect(await replay.text()).toBe('startrequestedfinal')
})

test('capture error is forwarded but final data remains available until stop', async () => {
  const recorder = new Recorder({} as unknown as MediaStream, { recoveryEnabled: true })
  const reader = recorder.asStream()
  const failed = jest.fn()
  reader.onError = failed
  recorder.start()
  Capture.instance.emit('start')
  Capture.instance.state = 'inactive'
  Capture.instance.onerror?.(new Event('error'))
  expect(failed).toHaveBeenCalledTimes(1)
  expect(() => reader.replayBlob()).toThrow()
  const stopped = recorder.stop()
  Capture.instance.emit('final')
  Capture.instance.onstop?.()
  await stopped
  expect(await reader.replayBlob().text()).toBe('startfinal')
})

test('a missing stop event rejects within the deadline and releases capture resources', async () => {
  jest.useFakeTimers()
  try {
    const recorder = new Recorder({} as unknown as MediaStream, { recoveryEnabled: true })
    recorder.start()
    Capture.instance.state = 'inactive'
    const stopped = recorder.stop()
    const rejection = expect(stopped).rejects.toThrow('MediaRecorder did not stop')
    await jest.advanceTimersByTimeAsync(5000)
    await rejection
    expect(releaseStream).toHaveBeenCalledWith(expect.any(Object))
    expect(recorder.asStream()).toMatchObject({ chunks: [], sent: [], recoverable: false })
  } finally {
    jest.useRealTimers()
  }
})
