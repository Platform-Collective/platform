// SPDX-License-Identifier: EPL-2.0

const SIGNIN_TIMEOUT = 30000

/**
 * Request the Google authorization URL from the Gmail service.
 * Fails on HTTP errors, on a response that is not an https URL, and when
 * the request (including the response body) takes longer than 30 seconds.
 */
export async function getGmailAuthUrl (url: string, token: string | undefined): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, SIGNIN_TIMEOUT)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    })
    if (!res.ok) {
      throw new Error(`Gmail signin failed: ${res.status}`)
    }
    const redirectTo = new URL(await res.text())
    if (redirectTo.protocol !== 'https:') {
      throw new Error('Invalid Gmail authorization URL')
    }
    return redirectTo.toString()
  } finally {
    clearTimeout(timeout)
  }
}
