//
// Copyright © 2026 Hardcore Engineering Inc.
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

import { authorizationHeaders, fetchAsObjectUrl, isLocalObjectUrl } from '../file-embed-utils'

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

describe('fetchAsObjectUrl', () => {
  const originalFetch = global.fetch
  const originalCreate = URL.createObjectURL

  beforeEach(() => {
    global.fetch = jest.fn()
    URL.createObjectURL = jest.fn(() => 'blob:https://huly.app/generated')
  })

  afterEach(() => {
    global.fetch = originalFetch
    URL.createObjectURL = originalCreate
  })

  it('returns local object URLs without fetching', async () => {
    const src = 'blob:https://huly.app/existing'
    await expect(fetchAsObjectUrl(src, 'token')).resolves.toEqual({ url: src, owned: false })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fetches remote files with Authorization and wraps the body in a blob URL', async () => {
    const body = new Blob(['%PDF-1.4'], { type: 'application/pdf' })
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      blob: async () => body
    })

    await expect(fetchAsObjectUrl('https://dl.huly.app/blob/ws/file', 'tok')).resolves.toEqual({
      url: 'blob:https://huly.app/generated',
      owned: true
    })
    expect(global.fetch).toHaveBeenCalledWith('https://dl.huly.app/blob/ws/file', {
      headers: { Authorization: 'Bearer tok' },
      signal: undefined
    })
    expect(URL.createObjectURL).toHaveBeenCalledWith(body)
  })

  it('does not send credentials via the Authorization header when no token is given', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['x'])
    })

    await fetchAsObjectUrl('/files/ws/file')
    expect(global.fetch).toHaveBeenCalledWith('/files/ws/file', {
      headers: {},
      signal: undefined
    })
  })

  it('throws when the file server rejects the request', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 })
    await expect(fetchAsObjectUrl('https://dl.huly.app/blob/ws/file', 'tok')).rejects.toThrow(
      'Failed to fetch file: 401'
    )
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
