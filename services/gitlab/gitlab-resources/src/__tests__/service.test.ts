// SPDX-License-Identifier: EPL-2.0
import { GitlabServiceError, errorText } from '../errors'
import { parseServiceResponse, serviceUrl } from '../service'

describe('serviceUrl', () => {
  it('joins service url and path without double slashes', () => {
    expect(serviceUrl('http://pod:3600/', 'auth')).toBe('http://pod:3600/api/v1/auth')
    expect(serviceUrl('http://pod:3600', 'repository-enable')).toBe('http://pod:3600/api/v1/repository-enable')
  })
})

describe('parseServiceResponse', () => {
  function thrownBy (fn: () => unknown): unknown {
    try {
      fn()
    } catch (err) {
      return err
    }
    throw new Error('expected a throw')
  }

  it('returns the parsed body of an ok JSON response', () => {
    expect(parseServiceResponse(200, true, '{"url":"https://x"}')).toEqual({ url: 'https://x' })
  })

  it('throws the error field of an error JSON response', () => {
    expect(errorText(thrownBy(() => parseServiceResponse(403, false, '{"error":"Forbidden caller"}')))).toBe(
      'Forbidden caller'
    )
  })

  it('throws HTTP <status> for a non-JSON error response', () => {
    expect(errorText(thrownBy(() => parseServiceResponse(502, false, '<html><body>Bad Gateway</body></html>')))).toBe(
      'HTTP 502'
    )
  })

  it('handles an empty body', () => {
    expect(errorText(thrownBy(() => parseServiceResponse(500, false, '')))).toBe('HTTP 500')
    expect(parseServiceResponse(200, true, '')).toEqual({})
  })

  it('rejects an ok response that is not a JSON object', () => {
    expect(errorText(thrownBy(() => parseServiceResponse(200, true, '<html></html>')))).toBe('HTTP 200')
  })

  it('throws a GitlabServiceError with the message and the machine-readable code', () => {
    const err = thrownBy(() =>
      parseServiceResponse(409, false, '{"error":"Disconnect GitLab first","code":"app-in-use"}')
    )
    expect(err).toBeInstanceOf(GitlabServiceError)
    expect((err as GitlabServiceError).code).toBe('app-in-use')
    expect(errorText(err)).toBe('Disconnect GitLab first')
  })

  it('has no code for an error without one', () => {
    for (const [status, body] of [
      [409, '{"error":"x"}'],
      [502, 'Bad Gateway']
    ] as const) {
      const err = thrownBy(() => parseServiceResponse(status, false, body))
      expect(err).toBeInstanceOf(GitlabServiceError)
      expect((err as GitlabServiceError).code).toBeUndefined()
    }
  })
})
