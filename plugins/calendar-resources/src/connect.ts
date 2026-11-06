// SPDX-License-Identifier: EPL-2.0

const REQUEST_TIMEOUT = 30000

/**
 * Request the Google authentication URL from the calendar service and open it.
 * Rejects when the service is unreachable, answers with an error or does not answer in time.
 */
export async function connectCalendar (url: URL, token: string | undefined): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, REQUEST_TIMEOUT)
  let redirectTo: string
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    })
    if (!res.ok) {
      throw new Error(`Google Calendar authentication failed: ${res.status}`)
    }
    redirectTo = (await res.text()).trim()
  } finally {
    clearTimeout(timeout)
  }
  if (redirectTo === '') {
    throw new Error('Google Calendar authentication URL is empty')
  }
  // The returned window is not checked: the desktop app opens external URLs in the system browser and returns null.
  window.open(redirectTo, '_blank', 'location=yes,height=870,width=720,scrollbars=yes,status=yes')
}
