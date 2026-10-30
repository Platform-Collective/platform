// SPDX-License-Identifier: EPL-2.0
import gitlab from '../plugin'
import { reviewLook } from '../review-look'

describe('reviewLook', () => {
  it('marks a review GitLab did not take as not sent', () => {
    expect(reviewLook('approved', true)).toEqual({ label: gitlab.string.ReviewNotSent, color: 'Coin' })
    expect(reviewLook('approved', false)).toEqual({ label: gitlab.string.ReviewApproved, color: 'Grass' })
  })

  it('labels and colors each review state', () => {
    expect(reviewLook('approved')).toEqual({ label: gitlab.string.ReviewApproved, color: 'Grass' })
    expect(reviewLook('unapproved')).toEqual({ label: gitlab.string.ReviewUnapproved, color: 'Coin' })
    expect(reviewLook('requested_changes')).toEqual({ label: gitlab.string.ReviewRequestedChanges, color: 'Sunshine' })
    expect(reviewLook('reviewed')).toEqual({ label: gitlab.string.ReviewReviewed })
    expect(reviewLook(undefined)).toEqual({ label: gitlab.string.ReviewReviewed })
  })
})
