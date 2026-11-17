// SPDX-License-Identifier: EPL-2.0

import type { Blob, Ref } from '@hcengineering/core'
import { getBlobRef } from '../preview'

let mockPreviewUrl = 'https://preview.test'

jest.mock('@hcengineering/core', () => ({
  concatLink: (base: string, path: string) => base + path
}))
jest.mock('@hcengineering/platform', () => ({
  getMetadata: (key: string) => (key === 'PreviewUrl' ? mockPreviewUrl : 'https://front.test')
}))
jest.mock('@hcengineering/retry', () => ({}))
jest.mock('../file', () => ({
  getFileUrl: () => 'https://front.test/original.png',
  getCurrentWorkspaceUuid: () => 'workspace'
}))
jest.mock('../plugin', () => ({
  __esModule: true,
  default: { metadata: { PreviewUrl: 'PreviewUrl', FrontUrl: 'FrontUrl' } }
}))

describe('getBlobRef', () => {
  const blob = 'screenshot' as Ref<Blob>

  beforeEach(() => {
    mockPreviewUrl = 'https://preview.test'
  })

  it.each([
    [64, 64],
    [64, 400],
    [200, 400],
    [300, 400],
    [400, 400],
    [400, 200]
  ])('requests the preview box dimensions at every DPR for a %ix%i preview', async (width, height) => {
    const result = await getBlobRef(blob, 'screenshot.png', width, height)

    expect(result.src).toBe('https://front.test/original.png')
    const candidates = result.srcset.split(/,\s+(?=https:)/).map((candidate) => candidate.trim())
    expect(candidates).toHaveLength(3)
    candidates.forEach((candidate, index) => {
      const dpr = index + 1
      expect(candidate).toBe(
        `https://preview.test/image/fit=cover,width=${width},height=${height},dpr=${dpr}/workspace/screenshot ${dpr}x`
      )
    })
  })

  it('retains width-based front thumbnails without a preview service', async () => {
    mockPreviewUrl = ''
    const { src, srcset } = await getBlobRef(blob, 'screenshot.png', 300, 400)

    expect(src).toBe('https://front.test/original.png')
    const candidates = srcset.split(/,\s+(?=https:)/).map((candidate) => candidate.trim())
    expect(candidates).toEqual([
      'https://front.test/files/workspace?file=screenshot&size=300 1x',
      'https://front.test/files/workspace?file=screenshot&size=600 2x',
      'https://front.test/files/workspace?file=screenshot&size=900 3x'
    ])
  })
})
