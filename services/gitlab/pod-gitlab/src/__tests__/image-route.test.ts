// SPDX-License-Identifier: EPL-2.0

import type { PersonId, WorkspaceUuid } from '@hcengineering/core'
import { IMAGE_HEADERS, imageRoute, imageStatus } from '../image-route'

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
