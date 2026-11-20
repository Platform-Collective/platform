// SPDX-License-Identifier: EPL-2.0

import { canPreviewFile, getPreviewType } from '../filetypes'
import type { FilePreviewExtension } from '../types'

const mockGetResource = jest.fn()

jest.mock('@hcengineering/platform', () => ({
  getMetadata: jest.fn(),
  getResource: (resource: unknown) => mockGetResource(resource)
}))
jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('../plugin', () => ({
  __esModule: true,
  default: { class: { FilePreviewExtension: 'preview' }, metadata: { WorkspaceUuid: 'workspace' } }
}))
jest.mock('../preview', () => ({ getPreviewMetadata: jest.fn() }))
jest.mock('../utils', () => ({ createQuery: () => ({ query: jest.fn() }) }))
jest.mock('svelte/store', () => ({
  writable: (value: unknown) => ({
    set: jest.fn(),
    subscribe: (callback: (value: unknown) => void) => {
      callback(value)
      return () => {}
    }
  })
}))

function viewer (id: string, contentType: string | string[], order?: number, checker?: string): FilePreviewExtension {
  const previewType = {
    _id: id,
    contentType,
    order,
    availabilityChecker: checker
  }
  return previewType as FilePreviewExtension
}

describe('file preview selection', () => {
  beforeEach(() => {
    mockGetResource.mockReset()
  })

  it('prefers exact MIME over a subtype wildcard and a global wildcard regardless of order', async () => {
    const exact = viewer('exact', 'text/html', 100)
    expect(await getPreviewType('text/html', [viewer('global', '*/*', -10), viewer('text', 'text/*'), exact])).toBe(
      exact
    )
  })

  it('prefers a subtype wildcard over a global wildcard regardless of order', async () => {
    const text = viewer('text', 'text/*', 100)
    expect(await getPreviewType('text/plain', [viewer('global', '*/*'), text])).toBe(text)
  })

  it('uses the best matching MIME in an array', async () => {
    const exact = viewer('array', ['image/*', 'text/html'], 10)
    expect(await getPreviewType('text/html', [viewer('text', 'text/*', -1), exact])).toBe(exact)
  })

  it('uses order only between candidates with equal MIME specificity, missing order first', async () => {
    const unordered = viewer('missing', 'text/*')
    const candidates = [viewer('later', 'text/*', 1), viewer('first', 'text/*', 0), unordered]
    expect(await getPreviewType('text/plain', candidates)).toBe(unordered)
  })

  it.each([undefined, 4])('uses a stable ID tie-break with equal order %s', async (order) => {
    const a = viewer('a', 'text/plain', order)
    const b = viewer('b', 'text/plain', order)
    expect(await getPreviewType('text/plain', [b, a])).toBe(a)
    expect(await getPreviewType('text/plain', [a, b])).toBe(a)
  })

  it.each(['application/vnd.example+json', 'application/vnd.example.test'])(
    'matches MIME %s literally',
    async (mime) => {
      const exact = viewer('literal', mime)
      expect(await getPreviewType(mime, [exact])).toBe(exact)
      expect(await getPreviewType(mime.replace('+', '').replace('.', 'x'), [exact])).toBeUndefined()
    }
  )

  it('does not interpret an embedded wildcard as MIME syntax', async () => {
    expect(await getPreviewType('application/example+xml', [viewer('invalid', 'application/*+xml')])).toBeUndefined()
  })

  it('does not resolve availability for an unrelated MIME', async () => {
    mockGetResource.mockRejectedValue(new Error('unrelated resource failure'))
    const text = viewer('text', 'text/plain')
    expect(await getPreviewType('text/plain', [viewer('image', 'image/*', 0, 'broken'), text])).toBe(text)
    expect(mockGetResource).not.toHaveBeenCalled()
  })

  it.each(['false', 'missing', 'resolution failure', 'checker failure'])(
    'isolates %s to its candidate',
    async (failure) => {
      if (failure === 'false') mockGetResource.mockResolvedValue(async () => false)
      if (failure === 'missing') mockGetResource.mockResolvedValue(undefined)
      if (failure === 'resolution failure') mockGetResource.mockRejectedValue(new Error('resolution'))
      if (failure === 'checker failure') {
        mockGetResource.mockResolvedValue(async () => {
          throw new Error('checker')
        })
      }
      const fallback = viewer('fallback', 'text/*')
      const candidates = [viewer('checked', 'text/plain', 0, 'checker'), fallback]
      expect(await getPreviewType('text/plain', candidates)).toBe(fallback)
      expect(await canPreviewFile('text/plain', candidates)).toBe(true)
      expect(await getPreviewType('text/plain', candidates.slice(0, 1))).toBeUndefined()
      expect(await canPreviewFile('text/plain', candidates.slice(0, 1))).toBe(false)
    }
  )

  it('accepts an available candidate', async () => {
    mockGetResource.mockResolvedValue(async () => true)
    const checked = viewer('checked', 'text/plain', 0, 'checker')
    expect(await getPreviewType('text/plain', [checked])).toBe(checked)
    expect(await canPreviewFile('text/plain', [checked])).toBe(true)
  })

  it.each(['', 'application/octet-stream', 'application/unregistered'])(
    'has no preview for %s without a matching registration',
    async (mime) => {
      const candidates = [viewer('text', 'text/*')]
      expect(await getPreviewType(mime, candidates)).toBeUndefined()
      expect(await canPreviewFile(mime, candidates)).toBe(false)
    }
  )

  it('returns no preview for an empty registry', async () => {
    expect(await getPreviewType('text/plain', [])).toBeUndefined()
    expect(await canPreviewFile('text/plain', [])).toBe(false)
  })

  const builtins = [
    viewer('audio', 'audio/*'),
    viewer('image', 'image/*'),
    viewer('video', 'video/*'),
    viewer('pdf', 'application/pdf'),
    viewer('text', ['application/json', 'text/*']),
    viewer('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', undefined, 'convert')
  ]

  it.each([
    ['audio/mpeg', 'audio'],
    ['image/png', 'image'],
    ['video/mp4', 'video'],
    ['application/pdf', 'pdf'],
    ['application/json', 'text'],
    ['text/plain', 'text'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx']
  ])('preserves the existing %s registration', async (mime, id) => {
    mockGetResource.mockResolvedValue(async () => true)
    expect((await getPreviewType(mime, builtins))?._id).toBe(id)
    expect(await canPreviewFile(mime, builtins)).toBe(true)
  })

  it('does not preview DOCX when conversion is unavailable', async () => {
    mockGetResource.mockResolvedValue(async () => false)
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    expect(await getPreviewType(mime, builtins)).toBeUndefined()
    expect(await canPreviewFile(mime, builtins)).toBe(false)
  })
})
