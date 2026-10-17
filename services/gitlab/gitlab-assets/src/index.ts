// SPDX-License-Identifier: EPL-2.0

import { loadMetadata } from '@hcengineering/platform'
import gitlab from '@hcengineering/gitlab'

const icons = require('../assets/icons.svg') as string // eslint-disable-line
loadMetadata(gitlab.icon, {
  Gitlab: `${icons}#gitlab`,
  GitlabRepository: `${icons}#repository`,
  MergeRequest: `${icons}#mergeRequest`,
  MergeRequestMerged: `${icons}#mergeRequestMerged`,
  MergeRequestClosed: `${icons}#mergeRequestClosed`,
  Image: `${icons}#image`
})
