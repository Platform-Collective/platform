// SPDX-License-Identifier: EPL-2.0

import { Builder } from '@hcengineering/model'
import notification, { DOMAIN_WORKSPACE_NOTIFICATION } from '@hcengineering/notification'

import { TWorkspaceNotificationTypeSetting } from '..'

describe('WorkspaceNotificationTypeSetting model', () => {
  it('is stored in its own domain', () => {
    const builder = new Builder()
    builder.createModel(TWorkspaceNotificationTypeSetting)
    expect(builder.hierarchy.getDomain(notification.class.WorkspaceNotificationTypeSetting)).toBe(
      DOMAIN_WORKSPACE_NOTIFICATION
    )
  })
})
