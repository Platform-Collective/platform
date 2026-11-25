// SPDX-License-Identifier: EPL-2.0

import { clearOidcSessionExpiryWarning, scheduleOidcSessionExpiryWarning } from '../session-expiry'

describe('OIDC session expiry warning', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    clearOidcSessionExpiryWarning()
    jest.useRealTimers()
  })

  test('warns once five minutes before expiry', () => {
    const warning = jest.fn()
    const exp = Math.floor(Date.now() / 1000) + 3600
    scheduleOidcSessionExpiryWarning({ exp, extra: { authMethod: 'oidc' } }, warning)

    jest.advanceTimersByTime(55 * 60 * 1000 - 1)
    expect(warning).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)

    expect(warning).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test('warns immediately when less than five minutes remain', () => {
    const warning = jest.fn()
    const exp = Math.floor(Date.now() / 1000) + 120
    scheduleOidcSessionExpiryWarning({ exp, extra: { authMethod: 'oidc' } }, warning)

    expect(warning).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each([
    [3600, undefined],
    [3600, 'password'],
    [-1, 'oidc'],
    [undefined, 'oidc']
  ])(
    'does not schedule a warning for a session without a future OIDC expiry',
    (secondsFromNow: number | undefined, authMethod: string | undefined) => {
      const warning = jest.fn()
      const exp = secondsFromNow === undefined ? undefined : Math.floor(Date.now() / 1000) + secondsFromNow
      scheduleOidcSessionExpiryWarning({ exp, extra: { authMethod } }, warning)

      expect(warning).not.toHaveBeenCalled()
      expect(jest.getTimerCount()).toBe(0)
    }
  )

  test('supports lifetimes beyond the maximum timer delay and cancels replaced warnings', () => {
    const firstWarning = jest.fn()
    const secondWarning = jest.fn()
    const exp = Math.floor(Date.now() / 1000) + 40 * 24 * 60 * 60
    const payload = { exp, extra: { authMethod: 'oidc' } }

    scheduleOidcSessionExpiryWarning(payload, firstWarning)
    expect(firstWarning).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(1)

    scheduleOidcSessionExpiryWarning(payload, secondWarning)
    clearOidcSessionExpiryWarning()
    expect(jest.getTimerCount()).toBe(0)
    jest.runAllTimers()
    expect(firstWarning).not.toHaveBeenCalled()
    expect(secondWarning).not.toHaveBeenCalled()
  })
})
