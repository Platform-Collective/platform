// SPDX-License-Identifier: EPL-2.0

import type { PersonId, WorkspaceUuid } from '@hcengineering/core'
import type { VerifiedCaller } from './caller'
import type { RouteBody } from './routes'
import type { GitlabImageAccess } from './sync/image-access'
import { Limiter, LimiterFullError } from './limiter'
import { TtlCache } from './ttl-cache'

export interface ImageRouteDeps {
  verify: (body: RouteBody) => Promise<VerifiedCaller>
  image: (workspace: WorkspaceUuid, actor: PersonId, url: string) => Promise<GitlabImageAccess>
  onError: (err: unknown) => void
}

/** How long browsers and the pod keep a downloaded image. */
export const IMAGE_CACHE_SECONDS = 5 * 60

/** Headers of an image answer: bytes from GitLab users are never read as a document. */
export const IMAGE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
  'Cache-Control': `private, max-age=${IMAGE_CACHE_SECONDS}`
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

export interface ImageLoaderOptions {
  // GitLab downloads at once per pod, and how many more may wait
  concurrency: number
  queue: number
  // As long as browsers may keep it (IMAGE_HEADERS max-age)
  cacheTtlMs: number
  cacheBytes: number
  // Images kept at most
  cacheEntries: number
  now?: () => number
}

const IMAGE_LOADER_DEFAULTS: ImageLoaderOptions = {
  concurrency: 4,
  queue: 32,
  cacheTtlMs: IMAGE_CACHE_SECONDS * 1000,
  cacheBytes: 64 * 1024 * 1024,
  cacheEntries: 1000
}

/**
 * Bounds parallel GitLab downloads (each may buffer MAX_IMAGE_BYTES) and keeps recent images per viewer. The key holds
 * the viewer's social id: an image downloaded with one person's GitLab token is never served to another.
 */
export function cachedImageLoader (
  load: ImageRouteDeps['image'],
  options: ImageLoaderOptions = IMAGE_LOADER_DEFAULTS
): ImageRouteDeps['image'] {
  const limiter = new Limiter(options.concurrency, options.queue)
  const cache = new TtlCache<{ data: Buffer, contentType: string }>({
    ttlMs: options.cacheTtlMs,
    maxEntries: options.cacheEntries,
    maxSize: options.cacheBytes,
    sizeOf: (it) => it.data.length,
    now: options.now
  })
  return async (workspace, actor, url) => {
    // The fragment only carries the size
    const key = `${workspace}\n${actor}\n${url.split('#')[0]}`
    const cached = cache.get(key)
    if (cached !== undefined) return { kind: 'image', ...cached }
    try {
      const result = await limiter.run(async () => await load(workspace, actor, url))
      if (result.kind === 'image') cache.set(key, { data: result.data, contentType: result.contentType })
      return result
    } catch (err: unknown) {
      if (err instanceof LimiterFullError) return { kind: 'unavailable' }
      throw err
    }
  }
}
