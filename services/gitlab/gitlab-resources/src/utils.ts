// SPDX-License-Identifier: EPL-2.0

import { getCurrentAccount, type Account } from '@hcengineering/core'
import { getMetadata, type IntlString } from '@hcengineering/platform'
import presentation, { MessageBox } from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'
import { GitlabError } from './errors'
import { type GitlabImageRequest } from './image-link'
import gitlab from './plugin'
import { parseServiceResponse, serviceUrl } from './service'
import { stateFromAuthorizeUrl } from './state'

export interface ServiceAuth {
  token: string | undefined
  accountId: string | undefined
}

/** The caller's Huly token and primary social id, sent with every GitLab service request. */
export function serviceAuth (): ServiceAuth {
  return {
    token: getMetadata(presentation.metadata.Token),
    // The workspace token does not carry the social id. A tab without a session has no account: the pod rejects it,
    // instead of a TypeError here.
    accountId: (getCurrentAccount() as Account | undefined)?.primarySocialId
  }
}

export async function sendGLServiceRequest (
  path: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const base = getMetadata(gitlab.metadata.GitlabURL)
  if (base === undefined || base === '') {
    throw new GitlabError(gitlab.string.NotConfigured)
  }
  const res = await fetch(serviceUrl(base, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...serviceAuth(), ...args })
  })
  return parseServiceResponse(res.status, res.ok, await res.text())
}

/** What the image viewer needs to ask the GitLab service for an image as the viewer. */
export function gitlabImageRequest (): GitlabImageRequest {
  return {
    base: getMetadata(gitlab.metadata.GitlabURL) ?? '',
    ...serviceAuth(),
    // Called as request.fetch(...): window.fetch called on another object throws "Illegal invocation"
    fetch: async (...args) => await fetch(...args)
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
    throw new GitlabError(gitlab.string.AuthorizeLinkInvalid)
  }
  window.open(authorizeUrl)
  return state
}

/** Asks before a destructive action; runs it only when the user confirms. */
export function confirmDangerous (
  label: IntlString,
  message: IntlString,
  onConfirm: () => Promise<void>,
  params?: Record<string, string>
): void {
  showPopup(MessageBox, { label, message, params, okLabel: label, dangerous: true }, undefined, (confirmed) => {
    if (confirmed === true) void onConfirm()
  })
}
