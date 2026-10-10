// SPDX-License-Identifier: EPL-2.0
import { createShutdown } from '../shutdown'

function setup (close: () => Promise<void>): { onSignal: () => void, exit: jest.Mock, onError: jest.Mock } {
  const exit = jest.fn()
  const onError = jest.fn()
  return { onSignal: createShutdown({ close, exit, onError, timeoutMs: 1000 }), exit, onError }
}

describe('createShutdown', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('exits 0 after a clean close, and closes once for repeated signals', async () => {
    const close = jest.fn(async () => {})
    const { onSignal, exit } = setup(close)
    onSignal()
    onSignal()
    await jest.advanceTimersByTimeAsync(0)
    expect(close).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits 1 when closing fails', async () => {
    const { onSignal, exit, onError } = setup(async () => {
      throw new Error('db')
    })
    onSignal()
    await jest.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits 1 when closing takes too long', () => {
    const { onSignal, exit } = setup(async () => {
      await new Promise<void>(() => {})
    })
    onSignal()
    jest.advanceTimersByTime(1000)
    expect(exit).toHaveBeenCalledWith(1)
  })
})
