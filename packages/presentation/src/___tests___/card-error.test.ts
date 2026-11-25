// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { unknownError } from '@hcengineering/platform'
import { executeCardAction } from '../card-error'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))

describe('Card actions', () => {
  const onProcessing = jest.fn()
  const onClose = jest.fn()
  const onError = jest.fn()
  const callbacks = { onProcessing, onClose, onError }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows a rejection, resets processing and retains dialog state without repeating the action', async () => {
    const error = new Error('Offline')
    const action = jest.fn(async () => {
      throw error
    })
    executeCardAction(action, callbacks)
    await Promise.resolve()

    expect(action).toHaveBeenCalledTimes(1)
    expect(onProcessing.mock.calls).toEqual([[true], [false]])
    expect(onClose).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(unknownError(error))
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Analytics.handleError).toHaveBeenCalledWith(error)
  })

  it('shows a synchronous failure and leaves the dialog open', () => {
    const error = new Error('Offline')
    executeCardAction(() => {
      throw error
    }, callbacks)

    expect(onProcessing.mock.calls).toEqual([[true], [false]])
    expect(onClose).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(unknownError(error))
  })

  it('closes after an explicitly resubmitted action succeeds', async () => {
    const action = jest.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(undefined)
    executeCardAction(action, callbacks)
    await Promise.resolve()
    executeCardAction(action, callbacks)
    await Promise.resolve()

    expect(action).toHaveBeenCalledTimes(2)
    expect(onProcessing.mock.calls).toEqual([[true], [false], [true], [false]])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('closes immediately after a synchronous action succeeds', () => {
    executeCardAction(() => {}, callbacks)

    expect(onProcessing.mock.calls).toEqual([[true], [false]])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })
})
