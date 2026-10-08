// SPDX-License-Identifier: EPL-2.0

import { getCurrentAccount, type Account } from '@hcengineering/core'
import { PlatformError, getMetadata, unknownError } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'
import gitlab from './plugin'
import { parseServiceResponse, serviceUrl, stateFromAuthorizeUrl } from './state'

export async function sendGLServiceRequest (path: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const base = getMetadata(gitlab.metadata.GitlabURL)
  if (base === undefined || base === '') {
    throw new PlatformError(unknownError('GitLab integration is not configured'))
  }
  const res = await fetch(serviceUrl(base, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // accountId = caller's primary social id; the workspace token does not carry it.
    // getCurrentAccount() is unset in a tab without a session; let the pod reject instead of throwing a TypeError here.
    body: JSON.stringify({
      token: getMetadata(presentation.metadata.Token),
      accountId: (getCurrentAccount() as Account | undefined)?.primarySocialId,
      ...args
    })
  })
  const text = await res.text()
  try {
    return parseServiceResponse(res.status, res.ok, text)
  } catch (err: unknown) {
    throw new PlatformError(unknownError(err instanceof Error ? err.message : String(err)))
  }
}

/**
 * Opens the GitLab consent page and returns the signed OAuth state, so the caller
 * can accept exactly this callback from the landing tab.
 */
export async function onAuthorize (): Promise<string> {
  // The pod signs the OAuth state from the caller's token; no Huly token goes to GitLab.
  // GitLab redirects back to the front the user is on (its URL must be registered in the GitLab application)
  const { url } = await sendGLServiceRequest('authorize-url', { origin: window.location.origin })
  const authorizeUrl = String(url)
  const state = stateFromAuthorizeUrl(authorizeUrl)
  if (state === undefined) {
    throw new PlatformError(unknownError('GitLab authorize URL has no state'))
  }
  window.open(authorizeUrl)
  return state
}
