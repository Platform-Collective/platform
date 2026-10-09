// SPDX-License-Identifier: EPL-2.0

import type { GitlabReviewKind } from '@hcengineering/gitlab'

export interface ReviewLook {
  label: 'ReviewApproved' | 'ReviewUnapproved' | 'ReviewRequestedChanges' | 'ReviewReviewed' | 'ReviewNotSent'
  // A PaletteColorIndexes name; no frame for plain reviews
  color?: 'Grass' | 'Coin' | 'Sunshine'
}

/** `notSent`: a review GitLab did not take. */
export function reviewLook (state: GitlabReviewKind | undefined, notSent = false): ReviewLook {
  if (notSent) return { label: 'ReviewNotSent', color: 'Coin' }
  switch (state) {
    case 'approved':
      return { label: 'ReviewApproved', color: 'Grass' }
    case 'unapproved':
      return { label: 'ReviewUnapproved', color: 'Coin' }
    case 'requested_changes':
      return { label: 'ReviewRequestedChanges', color: 'Sunshine' }
    default:
      return { label: 'ReviewReviewed' }
  }
}
