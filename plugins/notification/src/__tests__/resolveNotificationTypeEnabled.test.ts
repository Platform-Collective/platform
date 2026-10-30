// SPDX-License-Identifier: EPL-2.0

import type { Ref } from '@hcengineering/core'
import { resolveNotificationTypeEnabled, type NotificationProvider, type NotificationType } from '..'

const provider = 'test:provider:Inbox' as Ref<NotificationProvider>
const otherProvider = 'test:provider:Push' as Ref<NotificationProvider>
const typeId = 'test:type:Assigned' as Ref<NotificationType>

const enabledType = { _id: typeId, defaultEnabled: true }
const disabledType = { _id: typeId, defaultEnabled: false }

describe('resolveNotificationTypeEnabled', () => {
  it('falls back to the type default when nothing is set', () => {
    expect(resolveNotificationTypeEnabled(enabledType, provider, undefined, undefined, [])).toBe(true)
    expect(resolveNotificationTypeEnabled(disabledType, provider, undefined, undefined, [])).toBe(false)
  })

  it('uses provider model defaults before the type default', () => {
    const defaults = [{ provider, enabledTypes: [typeId] }]
    expect(resolveNotificationTypeEnabled(disabledType, provider, undefined, undefined, defaults)).toBe(true)
    expect(resolveNotificationTypeEnabled(disabledType, otherProvider, undefined, undefined, defaults)).toBe(false)
  })

  it('uses the workspace default before model defaults', () => {
    const defaults = [{ provider, enabledTypes: [typeId] }]
    expect(resolveNotificationTypeEnabled(enabledType, provider, undefined, { enabled: false }, defaults)).toBe(false)
    expect(resolveNotificationTypeEnabled(disabledType, provider, undefined, { enabled: true }, [])).toBe(true)
  })

  it('uses the user setting before the workspace default', () => {
    expect(resolveNotificationTypeEnabled(disabledType, provider, { enabled: true }, { enabled: false }, [])).toBe(true)
    expect(resolveNotificationTypeEnabled(enabledType, provider, { enabled: false }, { enabled: true }, [])).toBe(false)
  })
})
