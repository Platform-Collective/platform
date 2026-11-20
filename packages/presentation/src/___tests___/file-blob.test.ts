//
// Copyright © 2026 Hardcore Engineering Inc.
// Copyright © 2026 Exaviz.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { setMetadata } from '@hcengineering/platform'

import { authorizationHeaders, getFileBlobUrl, isLocalObjectUrl } from '../file-blob'
import plugin from '../plugin'

describe('isLocalObjectUrl', () => {
  it('accepts blob and data URLs', () => {
    expect(isLocalObjectUrl('blob:https://huly.app/abc')).toBe(true)
    expect(isLocalObjectUrl('data:application/pdf;base64,AAA')).toBe(true)
  })

  it('rejects remote and relative URLs', () => {
    expect(isLocalObjectUrl('https://dl.huly.app/blob/ws/file')).toBe(false)
    expect(isLocalObjectUrl('/files/ws/file')).toBe(false)
    expect(isLocalObjectUrl('')).toBe(false)
  })
})

describe('authorizationHeaders', () => {
  it('omits Authorization when the token is empty', () => {
    expect(authorizationHeaders(undefined)).toEqual({})
    expect(authorizationHeaders('')).toEqual({})
  })

  it('sends a Bearer token', () => {
    expect(authorizationHeaders('abc.def')).toEqual({ Authorization: 'Bearer abc.def' })
  })
})

describe('getFileBlobUrl', () => {
  const originalFetch = globalThis.fetch
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalCreate = URL.createObjectURL
  const createObjectUrl = jest.fn(() => 'blob:https://huly.app/generated')

  beforeEach(() => {
    globalThis.fetch = jest.fn()
    createObjectUrl.mockClear()
    URL.createObjectURL = createObjectUrl
    setMetadata(plugin.metadata.Token, 'tok')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    URL.createObjectURL = originalCreate
    setMetadata(plugin.metadata.Token, undefined)
  })

  it('returns local object URLs without fetching', async () => {
    const src = 'blob:https://huly.app/existing'
    await expect(getFileBlobUrl(src)).resolves.toEqual({ url: src, owned: false })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('fetches remote files with the session token and wraps the body in a blob URL', async () => {
    const body = new Blob(['%PDF-1.4'], { type: 'application/pdf' })
    ;(globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true, blob: async () => body })

    await expect(getFileBlobUrl('https://dl.huly.app/blob/ws/file')).resolves.toEqual({
      url: 'blob:https://huly.app/generated',
      owned: true
    })
    expect(globalThis.fetch).toHaveBeenCalledWith('https://dl.huly.app/blob/ws/file', {
      headers: { Authorization: 'Bearer tok' },
      signal: undefined
    })
    expect(createObjectUrl).toHaveBeenCalledWith(body)
  })

  it('sends no Authorization header when there is no session token', async () => {
    setMetadata(plugin.metadata.Token, undefined)
    ;(globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) })

    await getFileBlobUrl('/files/ws/file')
    expect(globalThis.fetch).toHaveBeenCalledWith('/files/ws/file', { headers: {}, signal: undefined })
  })

  it('throws when the file server rejects the request', async () => {
    ;(globalThis.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 })
    await expect(getFileBlobUrl('https://dl.huly.app/blob/ws/file')).rejects.toThrow('Failed to fetch file: 401')
    expect(createObjectUrl).not.toHaveBeenCalled()
  })
})
