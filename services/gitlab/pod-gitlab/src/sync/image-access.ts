// SPDX-License-Identifier: EPL-2.0

import { GitlabApiError, GitlabUploadTooLargeError } from '../gitlab/api'
import { MAX_IMAGE_BYTES } from './content'
import { absoluteUploadPathOf } from './image-links'
import type { RepositoryContext, UserApi } from './types'

/** What a viewer gets for a GitLab image link. */
export type GitlabImageAccess =
  | { kind: 'image', data: Buffer, contentType: string }
  | { kind: 'not-connected' }
  | { kind: 'no-access' }
  | { kind: 'not-found' }
  | { kind: 'unavailable' }

/**
 * Downloads a linked repository's upload with the viewer's own GitLab API, so GitLab's permissions decide. Never falls
 * back to the integration's token: that would show private images to people GitLab refuses.
 */
export async function findGitlabImage (
  repositories: RepositoryContext[],
  url: string,
  userApi: (repository: RepositoryContext) => Promise<UserApi | undefined>
): Promise<GitlabImageAccess> {
  const hash = url.indexOf('#')
  const base = hash < 0 ? url : url.slice(0, hash)
  for (const repository of repositories) {
    const target = {
      host: repository.integration.host,
      webUrl: repository.repository.webUrl,
      projectId: repository.repository.projectId
    }
    const path = absoluteUploadPathOf(base, target)
    if (path === undefined) continue
    const own = await userApi(repository)
    if (own === undefined) return { kind: 'not-connected' }
    const [, , secret, name] = path.split('/')
    try {
      const { data, contentType } = await own.api.downloadUpload(target.projectId, secret, name, MAX_IMAGE_BYTES)
      // Bytes from GitLab users are only ever served as an image. SVG is refused because it can carry
      // script, which would run in Huly's origin when the blob URL is opened directly.
      const mediaType = contentType.split(';')[0].trim().toLowerCase()
      if (!mediaType.startsWith('image/') || mediaType === 'image/svg+xml') return { kind: 'unavailable' }
      return { kind: 'image', data, contentType }
    } catch (err: unknown) {
      // GitLab answers 404 for projects the user may not see
      if (err instanceof GitlabApiError && [401, 403, 404].includes(err.status)) return { kind: 'no-access' }
      if (err instanceof GitlabUploadTooLargeError) return { kind: 'unavailable' }
      throw err
    }
  }
  return { kind: 'not-found' }
}
