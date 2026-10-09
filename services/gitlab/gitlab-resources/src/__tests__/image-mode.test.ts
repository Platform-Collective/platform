// SPDX-License-Identifier: EPL-2.0
import gitlab from '../plugin'
import { IMAGE_MODES, imageModeHint, imageModeLabel } from '../image-mode'

describe('image mode choices', () => {
  it('offers link first, then copy', () => {
    expect(IMAGE_MODES).toEqual(['link', 'copy'])
  })

  it('labels and explains each mode', () => {
    expect(imageModeLabel('link')).toBe(gitlab.string.ImageModeLink)
    expect(imageModeLabel('copy')).toBe(gitlab.string.ImageModeCopy)
    expect(imageModeHint('link')).toBe(gitlab.string.ImageModeLinkHint)
    expect(imageModeHint('copy')).toBe(gitlab.string.ImageModeCopyHint)
  })
})
