// SPDX-License-Identifier: EPL-2.0
import { imageNameOf, imageResultOf, loadGitlabImage } from '../image-link'

const HREF = 'https://gitlab.example.com/group/proj/uploads/0123456789abcdef0123456789abcdef/my%20shot.png#gitlab-image=width%3D3'

function respond (status: number, body: BodyInit, type = 'application/json'): typeof fetch {
  return (async () => new Response(body, { status, headers: { 'Content-Type': type } })) as unknown as typeof fetch
}

describe('GitLab image link', () => {
  it('names the image after its file, without the fragment', () => {
    expect(imageNameOf(HREF)).toBe('my shot.png')
    expect(imageNameOf('not a url')).toBe('not a url')
  })

  it('maps the pod answer to a placeholder', () => {
    expect(imageResultOf(403, 'not-connected')).toEqual({ kind: 'not-connected' })
    expect(imageResultOf(403, 'no-access')).toEqual({ kind: 'no-access' })
    expect(imageResultOf(404, 'not-found')).toEqual({ kind: 'unavailable' })
    expect(imageResultOf(503, undefined)).toEqual({ kind: 'unavailable' })
  })

  it('posts the link with the Huly token and returns the image', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const fetchImage = (async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return new Response('png', { status: 200, headers: { 'Content-Type': 'image/png' } })
    }) as unknown as typeof fetch
    const result = await loadGitlabImage(HREF, { base: 'https://pod.example.com', token: 'tok', accountId: 'p1', fetch: fetchImage })
    expect(result.kind).toBe('image')
    expect(calls[0][0]).toBe('https://pod.example.com/api/v1/image')
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ token: 'tok', accountId: 'p1', url: HREF })
  })

  it('accepts an image content type in any case', async () => {
    const result = await loadGitlabImage(HREF, { base: 'https://pod.example.com', token: 'tok', accountId: 'p1', fetch: respond(200, 'png', 'IMAGE/PNG') })
    expect(result.kind).toBe('image')
  })

  it('turns refusals and failures into placeholders, never an exception', async () => {
    const request = { base: 'https://pod.example.com', token: 'tok', accountId: 'p1' }
    expect(await loadGitlabImage(HREF, { ...request, fetch: respond(403, JSON.stringify({ error: 'no-access' })) })).toEqual({ kind: 'no-access' })
    expect(await loadGitlabImage(HREF, { ...request, fetch: respond(403, JSON.stringify({ error: 'not-connected' })) })).toEqual({ kind: 'not-connected' })
    expect(await loadGitlabImage(HREF, { ...request, fetch: respond(500, 'boom', 'text/plain') })).toEqual({ kind: 'unavailable' })
    const offline = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await loadGitlabImage(HREF, { ...request, fetch: offline })).toEqual({ kind: 'unavailable' })
    expect(await loadGitlabImage(HREF, { ...request, base: '', fetch: offline })).toEqual({ kind: 'unavailable' })
  })
})
