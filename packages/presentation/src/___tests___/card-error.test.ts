// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { setPlatformStatus, unknownError } from '@hcengineering/platform'
import { reportCardError } from '../card-error'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/platform', () => ({
  setPlatformStatus: jest.fn(),
  unknownError: jest.fn()
}))

describe('Card errors', () => {
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
})
