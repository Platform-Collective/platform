// SPDX-License-Identifier: EPL-2.0

import { mergeIds } from '@hcengineering/platform'
import { type Ref } from '@hcengineering/core'
import { type ChatMessageViewlet } from '@hcengineering/chunter'
import { type ChannelProvider, type SocialIdentityProvider } from '@hcengineering/contact'
import { gitlabId } from '@hcengineering/gitlab'
import gitlab from '@hcengineering/gitlab-resources/src/plugin'
import { type Viewlet } from '@hcengineering/view'

export default mergeIds(gitlabId, gitlab, {
  ids: {
    GitlabSocialIdentityProvider: '' as Ref<SocialIdentityProvider>,
    GitlabMergeRequestChatMessageViewlet: '' as Ref<ChatMessageViewlet>
  },
  channelProvider: {
    Gitlab: '' as Ref<ChannelProvider>
  },
  viewlet: {
    MergeRequests: '' as Ref<Viewlet>
  }
})
