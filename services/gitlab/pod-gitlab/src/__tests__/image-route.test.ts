// SPDX-License-Identifier: EPL-2.0

import type { PersonId, WorkspaceUuid } from '@hcengineering/core'
import { cachedImageLoader, IMAGE_CACHE_SECONDS, IMAGE_HEADERS, imageRoute, imageStatus } from '../image-route'

const caller = { workspace: 'ws-1' as WorkspaceUuid, account: 'acc-1', accountId: 'person-1' as PersonId }

describe('imageRoute', () => {
  it('asks for the image as the verified caller', async () => {
    const image = jest.fn(async () => ({ kind: 'no-access' as const }))
    const onError = jest.fn()
    const result = await imageRoute(
      { token: 't', url: 'https://gitlab.example.com/group/proj/uploads/x/a.png' },
      { verify: async () => caller, image, onError }
    )
    expect(result).toEqual({ kind: 'no-access' })
    expect(image).toHaveBeenCalledWith('ws-1', 'person-1', 'https://gitlab.example.com/group/proj/uploads/x/a.png')
  })

  it('answers not-found without a url', async () => {
    const image = jest.fn()
    const onError = jest.fn()
    expect(await imageRoute({ token: 't' }, { verify: async () => caller, image, onError })).toEqual({
      kind: 'not-found'
    })
    expect(image).not.toHaveBeenCalled()
  })

  it('refuses an unverified caller', async () => {
    const image = jest.fn()
    const onError = jest.fn()
    await expect(
      imageRoute(
        { token: 'bad', url: 'x' },
        {
          verify: async () => {
            throw new Error('bad token')
          },
          image,
          onError
        }
      )
    ).rejects.toThrow('bad token')
    expect(image).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('maps each answer to its HTTP status', () => {
    expect(imageStatus('image')).toBe(200)
    expect(imageStatus('not-connected')).toBe(403)
    expect(imageStatus('no-access')).toBe(403)
    expect(imageStatus('not-found')).toBe(404)
    expect(imageStatus('unavailable')).toBe(503)
  })

  it('never lets the bytes be read as a document', () => {
    expect(IMAGE_HEADERS).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': 'private, max-age=300'
    })
  })

  it('converts GitLab errors to unavailable', async () => {
    const gitlabError = new Error('GitLab GET /projects/42/uploads/secret/a.png failed: 500 body')
    const image = jest.fn(async () => {
      throw gitlabError
    })
    const onError = jest.fn()
    const result = await imageRoute(
      { token: 't', url: 'https://gitlab.example.com/group/proj/uploads/x/a.png' },
      { verify: async () => caller, image, onError }
    )
    expect(result).toEqual({ kind: 'unavailable' })
    expect(onError).toHaveBeenCalledWith(gitlabError)
  })
})

describe('cachedImageLoader', () => {
  const image = { kind: 'image' as const, data: Buffer.from('png'), contentType: 'image/png' }
  const options = { concurrency: 1, queue: 1, cacheTtlMs: 1000, cacheBytes: 1024, cacheEntries: 1000 }

  it('serves a viewer the same upload from the cache, whatever the fragment', async () => {
    const load = jest.fn(async () => image)
    const loader = cachedImageLoader(load, options)
    await loader('ws-1' as WorkspaceUuid, 'person-1' as PersonId, 'https://g/x/uploads/s/a.png#gitlab-image')
    expect(await loader('ws-1' as WorkspaceUuid, 'person-1' as PersonId, 'https://g/x/uploads/s/a.png')).toEqual(image)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('never shares a cached image between viewers', async () => {
    const load = jest.fn(async () => image)
    const loader = cachedImageLoader(load, options)
    await loader('ws-1' as WorkspaceUuid, 'person-1' as PersonId, 'https://g/x/uploads/s/a.png')
    await loader('ws-1' as WorkspaceUuid, 'person-2' as PersonId, 'https://g/x/uploads/s/a.png')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not cache refusals', async () => {
    const load = jest.fn(async () => ({ kind: 'no-access' as const }))
    const loader = cachedImageLoader(load, options)
    await loader('ws-1' as WorkspaceUuid, 'person-1' as PersonId, 'u')
    await loader('ws-1' as WorkspaceUuid, 'person-1' as PersonId, 'u')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('answers unavailable when too many downloads wait', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const load = jest.fn(async () => {
      await gate
      return image
    })
    const loader = cachedImageLoader(load, options)
    const first = loader('ws-1' as WorkspaceUuid, 'p' as PersonId, 'a')
    const second = loader('ws-1' as WorkspaceUuid, 'p' as PersonId, 'b')
    expect(await loader('ws-1' as WorkspaceUuid, 'p' as PersonId, 'c')).toEqual({ kind: 'unavailable' })
    release()
    await Promise.all([first, second])
  })

  it('caches at most cacheEntries images', async () => {
    let loads = 0
    const load = async (): Promise<any> => {
      loads++
      return { kind: 'image', data: Buffer.from('x'), contentType: 'image/png' }
    }
    const loader = cachedImageLoader(load, {
      concurrency: 1,
      queue: 1,
      cacheTtlMs: 60_000,
      cacheBytes: 1024,
      cacheEntries: 1
    })
    await loader('ws' as any, 'a' as any, 'https://g/u/1')
    await loader('ws' as any, 'a' as any, 'https://g/u/2')
    await loader('ws' as any, 'a' as any, 'https://g/u/1')
    expect(loads).toBe(3)
  })

  it('tells browsers to keep an image as long as the pod does', () => {
    expect(IMAGE_HEADERS['Cache-Control']).toBe(`private, max-age=${IMAGE_CACHE_SECONDS}`)
  })
})
