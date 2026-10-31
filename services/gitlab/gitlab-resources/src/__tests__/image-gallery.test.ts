// SPDX-License-Identifier: EPL-2.0
import { stepIndex } from '../image-gallery'

describe('stepIndex', () => {
  it('moves within the list and stops at both ends', () => {
    expect(stepIndex(0, 1, 3)).toBe(1)
    expect(stepIndex(2, 1, 3)).toBe(2)
    expect(stepIndex(0, -1, 3)).toBe(0)
    expect(stepIndex(2, -1, 3)).toBe(1)
  })

  it('stays at 0 for an empty or one-image list', () => {
    expect(stepIndex(0, 1, 0)).toBe(0)
    expect(stepIndex(0, 1, 1)).toBe(0)
  })
})
