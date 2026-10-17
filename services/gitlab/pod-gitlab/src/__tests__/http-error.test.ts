// SPDX-License-Identifier: EPL-2.0
import { APP_IN_USE, errorResponse, HttpError } from '../http-error'

describe('errorResponse', () => {
  it('answers an HttpError with its status, message and code', () => {
    expect(errorResponse(new HttpError(409, 'Disconnect GitLab first', APP_IN_USE))).toEqual({
      status: 409,
      body: { error: 'Disconnect GitLab first', code: 'app-in-use' }
    })
    expect(errorResponse(new HttpError(403, 'No'))).toEqual({ status: 403, body: { error: 'No' } })
  })

  it('answers anything else with 400 and its message', () => {
    expect(errorResponse(new Error('bad input'))).toEqual({ status: 400, body: { error: 'bad input' } })
    expect(errorResponse('text')).toEqual({ status: 400, body: { error: 'text' } })
  })
})
