// SPDX-License-Identifier: EPL-2.0
import {
  addStringsLoader,
  PlatformError,
  Severity,
  Status,
  getEmbeddedLabel,
  unknownError,
  type IntlString,
  type Plugin
} from '@hcengineering/platform'
import { Analytics } from '@hcengineering/analytics'
import {
  APP_IN_USE_CODE,
  GitlabError,
  GitlabServiceError,
  errorLabel,
  errorText,
  isAppInUseError,
  reportError,
  translateError
} from '../errors'

describe('errorText', () => {
  it('returns the message param of a PlatformError, as the GitLab service errors carry it', () => {
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

  it.each([
    ['text', 'text'],
    [42, '42'],
    [undefined, 'undefined']
  ])('stringifies %p', (value, expected) => {
    expect(errorText(value)).toBe(expected)
  })
})

describe('isAppInUseError', () => {
  it('detects the pod refusal by its code', () => {
    expect(isAppInUseError(new GitlabServiceError('Any wording (connected: alice)', APP_IN_USE_CODE))).toBe(true)
  })

  it('ignores the same text without the code, and other errors', () => {
    expect(isAppInUseError(new GitlabServiceError('Disconnect GitLab before changing the application'))).toBe(false)
    expect(isAppInUseError(new Error('Only workspace owners can change the GitLab application'))).toBe(false)
  })

  it('still shows the pod message', () => {
    expect(errorText(new GitlabServiceError('Disconnect GitLab first', APP_IN_USE_CODE))).toBe(
      'Disconnect GitLab first'
    )
  })
})

describe('errorLabel', () => {
  it('shows a GitlabError through its own translation', () => {
    const label = 'gitlab:string:LinkFailed' as IntlString
    expect(errorLabel(new GitlabError(label))).toBe(label)
  })

  it('shows any other error as its text', () => {
    expect(errorLabel(new Error('boom'))).toBe(getEmbeddedLabel('boom'))
    expect(errorLabel(new PlatformError(unknownError('from the pod')))).toBe(getEmbeddedLabel('from the pod'))
  })
})

describe('translateError', () => {
  beforeAll(() => {
    addStringsLoader('gitlab' as Plugin, async () => ({ string: { LinkFailed: 'Could not link the project' } }))
  })

  it('translates a GitlabError instead of returning its label id', async () => {
    const err = new GitlabError('gitlab:string:LinkFailed' as IntlString)
    expect(errorText(err)).toBe('gitlab:string:LinkFailed')
    expect(await translateError(err, 'en')).toBe('Could not link the project')
  })

  it('returns the text of any other error', async () => {
    expect(await translateError(new GitlabServiceError('Forbidden caller'), 'en')).toBe('Forbidden caller')
    expect(await translateError(new Error('boom'), 'en')).toBe('boom')
  })
})

describe('reportError', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reports an Error as it is', () => {
    const handle = jest.spyOn(Analytics, 'handleError').mockImplementation(() => {})
    const err = new Error('boom')
    reportError(err)
    expect(handle).toHaveBeenCalledWith(err)
  })

  it('wraps a non-Error value with its text', () => {
    const handle = jest.spyOn(Analytics, 'handleError').mockImplementation(() => {})
    reportError('refused')
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle.mock.calls[0][0].message).toBe('refused')
  })
})
