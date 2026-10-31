// SPDX-License-Identifier: EPL-2.0

import type { GitlabReviewKind } from '@hcengineering/gitlab'
import { type IntlString } from '@hcengineering/platform'
import gitlab from './plugin'

export interface ReviewLook {
  label: IntlString
  // A PaletteColorIndexes name; no frame for plain reviews
  color?: 'Grass' | 'Coin' | 'Sunshine'
}

/** `notSent`: a review GitLab did not take. */
export function reviewLook (state: GitlabReviewKind | undefined, notSent = false): ReviewLook {
  if (notSent) return { label: gitlab.string.ReviewNotSent, color: 'Coin' }
  switch (state) {
    case 'approved':
      return { label: gitlab.string.ReviewApproved, color: 'Grass' }
    case 'unapproved':
      return { label: gitlab.string.ReviewUnapproved, color: 'Coin' }
    case 'requested_changes':
      return { label: gitlab.string.ReviewRequestedChanges, color: 'Sunshine' }
    default:
      return { label: gitlab.string.ReviewReviewed }
  }
}
