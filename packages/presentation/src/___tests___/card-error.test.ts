// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { setPlatformStatus, unknownError } from '@hcengineering/platform'
import { executeCardAction, reportCardError } from '../card-error'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/platform', () => ({
  setPlatformStatus: jest.fn(),
  unknownError: jest.fn()
}))

describe('Card errors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(unknownError as jest.Mock).mockImplementation((err) => ({ code: 'unknown', params: { err } }))
  })

  it('shows a rejected retryable action to the user and reports it to analytics', () => {
    const error = new Error('Offline')
    const status = { code: 'unknown', params: {} }
    ;(unknownError as jest.Mock).mockReturnValue(status)

    reportCardError(error)

    expect(unknownError).toHaveBeenCalledWith(error)
    expect(setPlatformStatus).toHaveBeenCalledWith(status)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Analytics.handleError).toHaveBeenCalledWith(error)
  })

  it('unblocks and closes a non-retryable action after a rejection', async () => {
    const onProcessing = jest.fn()
    const onClose = jest.fn()
    executeCardAction(
      async () => {
        throw new Error('Offline')
      },
      false,
      { onProcessing, onClose }
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(onProcessing.mock.calls).toEqual([[true], [false]])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(setPlatformStatus).toHaveBeenCalledTimes(1)
  })

  it('unblocks a retryable action without closing or repeating it', async () => {
    const action = jest.fn(async () => {
      throw new Error('Offline')
    })
    const onProcessing = jest.fn()
    const onClose = jest.fn()
    executeCardAction(action, true, { onProcessing, onClose })
    await Promise.resolve()
    await Promise.resolve()

    expect(action).toHaveBeenCalledTimes(1)
    expect(onProcessing.mock.calls).toEqual([[true], [false]])
    expect(onClose).not.toHaveBeenCalled()
    expect(setPlatformStatus).toHaveBeenCalledTimes(1)
  })

  it('handles a synchronous action failure like a rejection', () => {
    const onProcessing = jest.fn()
    const onClose = jest.fn()
    executeCardAction(
      () => {
        throw new Error('Offline')
      },
      true,
      { onProcessing, onClose }
    )

    expect(onProcessing.mock.calls).toEqual([[true], [false]])
    expect(onClose).not.toHaveBeenCalled()
    expect(setPlatformStatus).toHaveBeenCalledTimes(1)
  })
})
