// SPDX-License-Identifier: EPL-2.0

import type { PersonId, Ref, Space } from '@hcengineering/core'
import {
  findWorkspaceNotificationTypeSetting,
  getWorkspaceNotificationTypeSettingId,
  type NotificationProvider,
  type NotificationType,
  type WorkspaceNotificationTypeSetting
} from '..'

const provider = 'test:provider:Inbox' as Ref<NotificationProvider>
const otherProvider = 'test:provider:Push' as Ref<NotificationProvider>
const type = 'test:type:Assigned' as Ref<NotificationType>
const otherType = 'test:type:Mentioned' as Ref<NotificationType>

function setting (
  _id: string,
  attachedTo: Ref<NotificationProvider>,
  t: Ref<NotificationType>,
  enabled: boolean,
  modifiedOn: number
): WorkspaceNotificationTypeSetting {
  return {
    _id: _id as Ref<WorkspaceNotificationTypeSetting>,
    _class: 'notification:class:WorkspaceNotificationTypeSetting' as any,
    space: 'core:space:Workspace' as Ref<Space>,
    modifiedBy: 'owner' as PersonId,
    modifiedOn,
    attachedTo,
    type: t,
    enabled
  }
}

describe('workspace notification type setting identity', () => {
  it('derives one deterministic id per provider and type', () => {
    expect(getWorkspaceNotificationTypeSettingId(provider, type)).toBe(
      getWorkspaceNotificationTypeSettingId(provider, type)
    )
    const ids = new Set([
      getWorkspaceNotificationTypeSettingId(provider, type),
      getWorkspaceNotificationTypeSettingId(provider, otherType),
      getWorkspaceNotificationTypeSettingId(otherProvider, type),
      getWorkspaceNotificationTypeSettingId(otherProvider, otherType)
    ])
    expect(ids.size).toBe(4)
  })

  it('returns undefined when no setting matches the provider and type', () => {
    const settings = [setting('a', otherProvider, type, true, 1), setting('b', provider, otherType, true, 1)]
    expect(findWorkspaceNotificationTypeSetting(settings, provider, type)).toBeUndefined()
  })

  it('prefers the document with the deterministic id over other duplicates, in any order', () => {
    const canonical = setting(getWorkspaceNotificationTypeSettingId(provider, type), provider, type, false, 1)
    const newer = setting('random-newer', provider, type, true, 5)
    expect(findWorkspaceNotificationTypeSetting([newer, canonical], provider, type)).toBe(canonical)
    expect(findWorkspaceNotificationTypeSetting([canonical, newer], provider, type)).toBe(canonical)
  })

  it('picks duplicates without the deterministic id independent of their order', () => {
    const older = setting('b-older', provider, type, false, 1)
    const newer = setting('c-newer', provider, type, true, 5)
    const tie = setting('a-tie', provider, type, false, 5)
    expect(findWorkspaceNotificationTypeSetting([older, newer], provider, type)).toBe(newer)
    expect(findWorkspaceNotificationTypeSetting([newer, older], provider, type)).toBe(newer)
    expect(findWorkspaceNotificationTypeSetting([newer, tie, older], provider, type)).toBe(tie)
    expect(findWorkspaceNotificationTypeSetting([older, tie, newer], provider, type)).toBe(tie)
  })
})
