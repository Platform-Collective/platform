// SPDX-License-Identifier: EPL-2.0

interface SessionExpiryPayload {
  exp?: unknown
  extra?: { authMethod?: unknown }
}

const WARNING_WINDOW_MS = 5 * 60 * 1000
const MAX_TIMER_DELAY_MS = 2_147_483_647

let warningTimer: ReturnType<typeof setTimeout> | undefined

export function clearOidcSessionExpiryWarning (): void {
  if (warningTimer !== undefined) {
    clearTimeout(warningTimer)
    warningTimer = undefined
  }
}

export function scheduleOidcSessionExpiryWarning (payload: SessionExpiryPayload, onWarning: () => void): void {
  clearOidcSessionExpiryWarning()
  const exp = payload.exp
  if (payload.extra?.authMethod !== 'oidc' || typeof exp !== 'number' || !Number.isFinite(exp)) return

  const checkExpiry = (): void => {
    const remainingMs = exp * 1000 - Date.now()
    if (remainingMs <= WARNING_WINDOW_MS) {
      warningTimer = undefined
      if (remainingMs > 0) onWarning()
      return
    }
    warningTimer = setTimeout(checkExpiry, Math.min(remainingMs - WARNING_WINDOW_MS, MAX_TIMER_DELAY_MS))
  }

  checkExpiry()
}
