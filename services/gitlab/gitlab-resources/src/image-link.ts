// SPDX-License-Identifier: EPL-2.0

import { serviceUrl } from './state'

/** What the image viewer shows. */
export type GitlabImageResult =
  | { kind: 'image', blob: Blob }
  | { kind: 'not-connected' }
  | { kind: 'no-access' }
  | { kind: 'unavailable' }

export interface GitlabImageRequest {
  // URL of the pod-gitlab service
  base: string
  // The viewer's Huly token and primary social id, as on every other pod call
  token: string | undefined
  accountId: string | undefined
  fetch: typeof fetch
}

/** The image's file name, decoded and without the fragment; the href itself when it is not a URL. */
export function imageNameOf (href: string): string {
  try {
    const path = new URL(href).pathname
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
  } catch {
    return href
  }
}

/** The placeholder for a pod answer that is not an image. */
export function imageResultOf (status: number, error: unknown): Exclude<GitlabImageResult, { kind: 'image' }> {
  if (status === 403 && error === 'not-connected') return { kind: 'not-connected' }
  if (status === 403 && error === 'no-access') return { kind: 'no-access' }
  return { kind: 'unavailable' }
}

/** Asks the pod for a GitLab image as the viewer; failures become placeholders. */
export async function loadGitlabImage (href: string, request: GitlabImageRequest): Promise<GitlabImageResult> {
  if (request.base === '') return { kind: 'unavailable' }
  try {
    const res = await request.fetch(serviceUrl(request.base, 'image'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: request.token, accountId: request.accountId, url: href })
    })
    if (res.ok && (res.headers.get('Content-Type') ?? '').toLowerCase().startsWith('image/')) {
      return { kind: 'image', blob: await res.blob() }
    }
    let error: unknown
    try {
      error = ((await res.json()) as { error?: unknown }).error
    } catch {}
    return imageResultOf(res.status, error)
  } catch {
    return { kind: 'unavailable' }
  }
}
