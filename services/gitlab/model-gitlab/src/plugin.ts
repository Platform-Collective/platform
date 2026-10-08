// SPDX-License-Identifier: EPL-2.0

import { mergeIds } from '@hcengineering/platform'
import { type Ref } from '@hcengineering/core'
import { type ChannelProvider, type SocialIdentityProvider } from '@hcengineering/contact'
import { gitlabId } from '@hcengineering/gitlab'
import gitlab from '@hcengineering/gitlab-resources/src/plugin'

export default mergeIds(gitlabId, gitlab, {
  ids: {
    GitlabSocialIdentityProvider: '' as Ref<SocialIdentityProvider>
  },
  channelProvider: {
    Gitlab: '' as Ref<ChannelProvider>
  }
})
