// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import { GitlabApiError, GitlabUploadTooLargeError } from '../gitlab/api'
import { findGitlabImage } from '../sync/image-access'
import type { RepositoryContext, UserApi } from '../sync/types'

const S = '0123456789abcdef0123456789abcdef'
const repo = {
  integration: { _id: 'int-1', host: 'https://gitlab.example.com' },
  repository: { _id: 'repo-1', webUrl: 'https://gitlab.example.com/group/proj', projectId: 42 }
} as unknown as RepositoryContext
const URL_OF = (name = 'a.png'): string =>
  `https://gitlab.example.com/group/proj/uploads/${S}/${name}#gitlab-image=width%3D3`

function userApi (download: jest.Mock): (repository: RepositoryContext) => Promise<UserApi> {
  return async () => ({
    api: { downloadUpload: download } as any,
    user: { id: 7, username: 'u7', name: 'U7', avatar_url: null }
  })
}

describe('findGitlabImage', () => {
  it("downloads with the viewer's own API, ignoring the fragment", async () => {
    const download = jest.fn(async () => ({ data: Buffer.from('png'), contentType: 'image/png' }))
    const result = await findGitlabImage([repo], URL_OF(), userApi(download))
    expect(result).toEqual({ kind: 'image', data: Buffer.from('png'), contentType: 'image/png' })
    expect(download).toHaveBeenCalledWith(42, S, 'a.png', 20 * 1024 * 1024)
  })

  it('answers not-connected without using any other token', async () => {
    expect(await findGitlabImage([repo], URL_OF(), async () => undefined)).toEqual({ kind: 'not-connected' })
  })

  it.each([401, 403, 404])('answers no-access when GitLab refuses with %p', async (status) => {
    const download = jest.fn(async () => {
      throw new GitlabApiError(status, 'refused')
    })
    expect(await findGitlabImage([repo], URL_OF(), userApi(download))).toEqual({ kind: 'no-access' })
  })

  it('answers unavailable for an image over the limit or a non-image', async () => {
    const tooLarge = jest.fn(async () => {
      throw new GitlabUploadTooLargeError(30, 20)
    })
    expect(await findGitlabImage([repo], URL_OF(), userApi(tooLarge))).toEqual({ kind: 'unavailable' })
    const html = jest.fn(async () => ({ data: Buffer.from('<html>'), contentType: 'text/html' }))
    expect(await findGitlabImage([repo], URL_OF(), userApi(html))).toEqual({ kind: 'unavailable' })
  })

  it.each(['image/svg+xml', 'Image/SVG+XML; charset=utf-8'])(
    'refuses %p because SVG can carry script',
    async (contentType) => {
      const download = jest.fn(async () => ({ data: Buffer.from('<svg/>'), contentType }))
      expect(await findGitlabImage([repo], URL_OF(), userApi(download))).toEqual({ kind: 'unavailable' })
    }
  )

  it('accepts an image type in any case and keeps the content type as GitLab sent it', async () => {
    const download = jest.fn(async () => ({ data: Buffer.from('png'), contentType: 'IMAGE/PNG' }))
    expect(await findGitlabImage([repo], URL_OF(), userApi(download))).toEqual({
      kind: 'image',
      data: Buffer.from('png'),
      contentType: 'IMAGE/PNG'
    })
  })

  it('answers not-found for anything that is not an upload of a linked repository', async () => {
    const download = jest.fn()
    for (const url of [
      `/uploads/${S}/a.png`,
      `https://gitlab.example.com/other/proj/uploads/${S}/a.png`,
      'https://example.com/a.png',
      `https://gitlab.example.com/group/proj/uploads/${S}/..`
    ]) {
      expect(await findGitlabImage([repo], url, userApi(download))).toEqual({ kind: 'not-found' })
    }
    expect(download).not.toHaveBeenCalled()
  })

  it('lets other errors through', async () => {
    const download = jest.fn(async () => {
      throw new Error('network down')
    })
    await expect(findGitlabImage([repo], URL_OF(), userApi(download))).rejects.toThrow('network down')
  })
})
