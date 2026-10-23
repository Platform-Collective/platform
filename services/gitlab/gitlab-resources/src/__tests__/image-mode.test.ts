// SPDX-License-Identifier: EPL-2.0
import { DEFAULT_IMAGE_MODE } from '@hcengineering/gitlab'
import gitlab from '../plugin'
import { IMAGE_MODES, imageModeHint, imageModeLabel } from '../image-mode'

describe('image mode choices', () => {
  it('offers the default mode first, then the others', () => {
    expect(IMAGE_MODES[0]).toBe(DEFAULT_IMAGE_MODE)
    expect([...IMAGE_MODES].sort()).toEqual(['copy', 'link'])
  })

  it('labels and explains each mode', () => {
    expect(imageModeLabel('link')).toBe(gitlab.string.ImageModeLink)
    expect(imageModeLabel('copy')).toBe(gitlab.string.ImageModeCopy)
    expect(imageModeHint('link')).toBe(gitlab.string.ImageModeLinkHint)
    expect(imageModeHint('copy')).toBe(gitlab.string.ImageModeCopyHint)
  })
})
