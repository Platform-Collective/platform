// SPDX-License-Identifier: EPL-2.0

import { getAdjacentImageIndex } from '../preview-navigation'

describe('getAdjacentImageIndex', () => {
  it('returns the adjacent image index when it is in the list', () => {
    expect(getAdjacentImageIndex(1, -1, 3)).toBe(0)
    expect(getAdjacentImageIndex(1, 1, 3)).toBe(2)
  })

  it('does not navigate beyond the image list', () => {
    expect(getAdjacentImageIndex(0, -1, 3)).toBeUndefined()
    expect(getAdjacentImageIndex(2, 1, 3)).toBeUndefined()
  })
})
