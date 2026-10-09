// SPDX-License-Identifier: EPL-2.0
import { DEFAULT_IMAGE_MODE, imageModeOf } from '../index'

describe('imageModeOf', () => {
  it('links by default', () => {
    expect(DEFAULT_IMAGE_MODE).toBe('link')
    expect(imageModeOf({})).toBe('link')
    expect(imageModeOf({ imageMode: undefined })).toBe('link')
  })

  it('returns the chosen mode', () => {
    expect(imageModeOf({ imageMode: 'copy' })).toBe('copy')
    expect(imageModeOf({ imageMode: 'link' })).toBe('link')
  })
})
