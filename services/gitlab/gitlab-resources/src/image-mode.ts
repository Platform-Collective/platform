// SPDX-License-Identifier: EPL-2.0

import { type GitlabImageMode } from '@hcengineering/gitlab'
import { type IntlString } from '@hcengineering/platform'
import gitlab from './plugin'

/** The choices of the integration's image mode, the default first. */
export const IMAGE_MODES: GitlabImageMode[] = ['link', 'copy']

export function imageModeLabel (mode: GitlabImageMode): IntlString {
  return mode === 'copy' ? gitlab.string.ImageModeCopy : gitlab.string.ImageModeLink
}

export function imageModeHint (mode: GitlabImageMode): IntlString {
  return mode === 'copy' ? gitlab.string.ImageModeCopyHint : gitlab.string.ImageModeLinkHint
}
