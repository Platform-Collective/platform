// SPDX-License-Identifier: EPL-2.0

import { DEFAULT_IMAGE_MODE, type GitlabImageMode } from '@hcengineering/gitlab'
import { type IntlString } from '@hcengineering/platform'
import gitlab from './plugin'

const ALL_IMAGE_MODES: GitlabImageMode[] = ['link', 'copy']

/** The choices of the integration's image mode, the default first. */
export const IMAGE_MODES: GitlabImageMode[] = [
  DEFAULT_IMAGE_MODE,
  ...ALL_IMAGE_MODES.filter((mode) => mode !== DEFAULT_IMAGE_MODE)
]

export function imageModeLabel (mode: GitlabImageMode): IntlString {
  return mode === 'copy' ? gitlab.string.ImageModeCopy : gitlab.string.ImageModeLink
}

export function imageModeHint (mode: GitlabImageMode): IntlString {
  return mode === 'copy' ? gitlab.string.ImageModeCopyHint : gitlab.string.ImageModeLinkHint
}
