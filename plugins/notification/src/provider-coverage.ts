// SPDX-License-Identifier: EPL-2.0

import type { AccountUuid, Ref, Tx } from '@hcengineering/core'
import type { InboxNotification, NotificationProvider, NotificationType } from './index'

/**
 * Request-local coverage emitted by a summary producer. Never attach this to
 * transaction meta or document attributes: contextCache is not persisted or broadcast.
 * @public
 */
export interface NotificationProviderCoverage {
  /** The dedicated summary transaction that must be present in the trigger input. */
  summary: Ref<Tx>
  recipient: AccountUuid
  provider: Ref<NotificationProvider>
  /** The covering summary's type; its provider settings must allow delivery. */
  type: Ref<NotificationType>
  field: string
}

/** @public */
export const NOTIFICATION_PROVIDER_COVERAGE = 'notification:provider-coverage'

/** Source transaction id to explicit summary coverage, scoped to contextCache. @public */
export type NotificationProviderCoverageMap = Map<Ref<Tx>, NotificationProviderCoverage[]>

/** @public */
export const NOTIFICATION_PROVIDER_SUPPRESSIONS = 'notification:provider-suppressions'

/** Inbox notification id to intentionally covered providers, scoped to contextCache. @public */
export type NotificationProviderSuppressions = Map<Ref<InboxNotification>, Ref<NotificationProvider>[]>
