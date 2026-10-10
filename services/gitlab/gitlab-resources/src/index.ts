// SPDX-License-Identifier: EPL-2.0

import type { Integration } from '@hcengineering/account-client'
import { type Resources } from '@hcengineering/platform'
import Configure from './components/Configure.svelte'
import Connect from './components/Connect.svelte'
import ConnectApp from './components/ConnectApp.svelte'
import GitlabIcon from './components/GitlabIcon.svelte'
import IntegrationState from './components/IntegrationState.svelte'
import EditMergeRequest from './components/EditMergeRequest.svelte'
import GitlabIssueHeader from './components/GitlabIssueHeader.svelte'
import GitlabRepositoryPool from './components/GitlabRepositoryPool.svelte'
import MergeRequestState from './components/MergeRequestState.svelte'
import MergeRequests from './components/MergeRequests.svelte'
import GitlabIssuePresenter from './components/presenters/GitlabIssuePresenter.svelte'
import GitlabReviewPresenter from './components/presenters/GitlabReviewPresenter.svelte'
import GitlabReviewThreadPresenter from './components/presenters/GitlabReviewThreadPresenter.svelte'
import MergeRequestPresenter from './components/presenters/MergeRequestPresenter.svelte'
import MergeRequestStateValuePresenter from './components/presenters/MergeRequestStateValuePresenter.svelte'
import MergeStatusValuePresenter from './components/presenters/MergeStatusValuePresenter.svelte'
import TitlePresenter from './components/presenters/TitlePresenter.svelte'
import { showForRepositoryOnly, updateIssue } from './functions'
import { sendGLServiceRequest } from './utils'

export default async (): Promise<Resources> => ({
  component: {
    Connect,
    Configure,
    ConnectApp,
    GitlabIcon,
    IntegrationState,
    EditMergeRequest,
    MergeRequestState,
    MergeRequests,
    MergeRequestPresenter,
    MergeRequestStateValuePresenter,
    MergeStatusValuePresenter,
    TitlePresenter,
    GitlabIssueHeader,
    GitlabRepositoryPool,
    GitlabIssuePresenter,
    GitlabReviewPresenter,
    GitlabReviewThreadPresenter
  },
  handler: {
    DisconnectHandler: async (_integration: Integration) => {
      await sendGLServiceRequest('disconnect', {})
    }
  },
  function: {
    ShowForRepositoryOnly: showForRepositoryOnly,
    UpdateIssue: updateIssue
  }
})
