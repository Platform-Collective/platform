// SPDX-License-Identifier: EPL-2.0

import { deleteCookieForLogout } from '../logout'

describe('expired session logout', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  test('an unresponsive DELETE /cookie cannot prevent local logout and navigation', async () => {
    const clearAndNavigate = jest.fn()
    const deletion = jest.fn(async () => {
      await new Promise<void>(() => {})
    })
    const logout = deleteCookieForLogout(deletion, 1000).then(clearAndNavigate)
    await jest.advanceTimersByTimeAsync(1000)
    await logout
    expect(deletion).toHaveBeenCalledTimes(1)
    expect(clearAndNavigate).toHaveBeenCalledTimes(1)
  })

  test('failed deletion still allows logout, including a late failure after timeout', async () => {
    await expect(
      deleteCookieForLogout(async () => {
        throw new Error('offline')
      }, 1000)
    ).resolves.toBeUndefined()
    let rejectDeletion: (err: Error) => void = () => {}
    const logout = deleteCookieForLogout(async () => {
      await new Promise<void>((resolve, reject) => {
        rejectDeletion = reject
      })
    }, 1000)
    await jest.advanceTimersByTimeAsync(1000)
    await logout
    rejectDeletion(new Error('late failure'))
    await Promise.resolve()
    expect(jest.getTimerCount()).toBe(0)
  })

  test('ordinary logout still waits for cookie deletion', async () => {
    let deleted = false
    const clearAndNavigate = jest.fn()
    const logout = deleteCookieForLogout(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 2000))
      deleted = true
    }).then(clearAndNavigate)
    await jest.advanceTimersByTimeAsync(1000)
    expect(clearAndNavigate).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(1000)
    await logout
    expect(deleted).toBe(true)
    expect(clearAndNavigate).toHaveBeenCalledTimes(1)
  })
})
