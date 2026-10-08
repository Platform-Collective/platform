// SPDX-License-Identifier: EPL-2.0
import { PlatformError, Severity, Status, unknownError } from '@hcengineering/platform'
import { APP_IN_USE_PREFIX, errorText, isAppInUseError } from '../errors'

describe('errorText', () => {
  it('returns the message param of a PlatformError (as wrapped by sendGLServiceRequest)', () => {
    const err = new PlatformError(unknownError('Disconnect GitLab before changing the application (connected: alice)'))
    expect(err.message).toContain('UnknownError')
    expect(errorText(err)).toBe('Disconnect GitLab before changing the application (connected: alice)')
  })

  it('falls back to the message of a PlatformError without a message param', () => {
    const err = new PlatformError(new Status(Severity.ERROR, 'platform:status:Forbidden' as any, {}))
    expect(errorText(err)).toBe(err.message)
  })

  it('ignores a non-string message param', () => {
    const err = new PlatformError(new Status(Severity.ERROR, 'platform:status:X' as any, { message: 42 }))
    expect(errorText(err)).toBe(err.message)
  })

  it('returns the message of a plain Error', () => {
    expect(errorText(new Error('boom'))).toBe('boom')
  })

  it.each([['text', 'text'], [42, '42'], [undefined, 'undefined']])('stringifies %p', (value, expected) => {
    expect(errorText(value)).toBe(expected)
  })
})

describe('isAppInUseError', () => {
  it('detects the pod refusal through the PlatformError wrapper', () => {
    expect(isAppInUseError(new PlatformError(unknownError(`${APP_IN_USE_PREFIX} (connected: alice, bob)`)))).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isAppInUseError(new Error('Only workspace owners can change the GitLab application'))).toBe(false)
  })
})
