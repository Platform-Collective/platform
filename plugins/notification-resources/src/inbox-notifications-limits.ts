// SPDX-License-Identifier: EPL-2.0

export interface InboxNotificationsLimits {
  activity: number
  other: number
}

const INITIAL_INBOX_NOTIFICATIONS_LIMITS: InboxNotificationsLimits = {
  activity: 1000,
  other: 500
}

export function getInitialInboxNotificationsLimits (): InboxNotificationsLimits {
  return { ...INITIAL_INBOX_NOTIFICATIONS_LIMITS }
}

export function getNextInboxNotificationsLimits (limits: InboxNotificationsLimits): InboxNotificationsLimits {
  return {
    activity: limits.activity + INITIAL_INBOX_NOTIFICATIONS_LIMITS.activity,
    other: limits.other + INITIAL_INBOX_NOTIFICATIONS_LIMITS.other
  }
}
