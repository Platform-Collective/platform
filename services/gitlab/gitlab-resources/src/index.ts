// SPDX-License-Identifier: EPL-2.0

import type { Integration } from '@hcengineering/account-client'
import { type Resources } from '@hcengineering/platform'
import Configure from './components/Configure.svelte'
import Connect from './components/Connect.svelte'
import ConnectApp from './components/ConnectApp.svelte'
import GitlabIcon from './components/GitlabIcon.svelte'
import IntegrationState from './components/IntegrationState.svelte'
import { sendGLServiceRequest } from './utils'

export default async (): Promise<Resources> => ({
  component: {
    Connect,
    Configure,
    ConnectApp,
    GitlabIcon,
    IntegrationState
  },
  handler: {
    DisconnectHandler: async (_integration: Integration) => {
      await sendGLServiceRequest('disconnect', {})
    }
  }
})
