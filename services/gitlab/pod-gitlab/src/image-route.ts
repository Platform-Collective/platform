// SPDX-License-Identifier: EPL-2.0

import type { PersonId, WorkspaceUuid } from '@hcengineering/core'
import type { VerifiedCaller } from './caller'
import type { RouteBody } from './routes'
import type { GitlabImageAccess } from './sync/image-access'

export interface ImageRouteDeps {
  verify: (body: RouteBody) => Promise<VerifiedCaller>
  image: (workspace: WorkspaceUuid, actor: PersonId, url: string) => Promise<GitlabImageAccess>
  onError: (err: unknown) => void
}

/** Headers of an image answer: bytes from GitLab users are never read as a document. */
export const IMAGE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
  'Cache-Control': 'private, max-age=300'
}

/** A GitLab image for the verified caller. */
export async function imageRoute (body: RouteBody, deps: ImageRouteDeps): Promise<GitlabImageAccess> {
  const { workspace, accountId } = await deps.verify(body)
  const url = typeof body.url === 'string' ? body.url : ''
  if (url === '') return { kind: 'not-found' }
  try {
    return await deps.image(workspace, accountId, url)
  } catch (err: unknown) {
    deps.onError(err)
    return { kind: 'unavailable' }
  }
}

export function imageStatus (kind: GitlabImageAccess['kind']): number {
  switch (kind) {
    case 'image':
      return 200
    case 'not-connected':
    case 'no-access':
      return 403
    case 'not-found':
      return 404
    case 'unavailable':
      return 503
  }
}
