// SPDX-License-Identifier: EPL-2.0
import { reviewLook } from '../review-look'

describe('reviewLook', () => {
  it('marks a review GitLab did not take as not sent', () => {
    expect(reviewLook('approved', true)).toEqual({ label: 'ReviewNotSent', color: 'Coin' })
    expect(reviewLook('approved', false)).toEqual({ label: 'ReviewApproved', color: 'Grass' })
  })

  it('labels and colors each review state', () => {
    expect(reviewLook('approved')).toEqual({ label: 'ReviewApproved', color: 'Grass' })
    expect(reviewLook('unapproved')).toEqual({ label: 'ReviewUnapproved', color: 'Coin' })
    expect(reviewLook('requested_changes')).toEqual({ label: 'ReviewRequestedChanges', color: 'Sunshine' })
    expect(reviewLook('reviewed')).toEqual({ label: 'ReviewReviewed' })
    expect(reviewLook(undefined)).toEqual({ label: 'ReviewReviewed' })
  })
})
