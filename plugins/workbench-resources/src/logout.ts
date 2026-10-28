// SPDX-License-Identifier: EPL-2.0

/** Waits for best-effort cookie deletion, optionally bounded for expired sessions. */
export async function deleteCookieForLogout (deleteCookie: () => Promise<void>, timeoutMs?: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const deletion = deleteCookie()
    if (timeoutMs === undefined) {
      await deletion
    } else {
      await Promise.race([
        deletion,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs)
        })
      ])
    }
  } catch {
    // An unavailable account service must not prevent local logout.
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
