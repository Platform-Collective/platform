// SPDX-License-Identifier: EPL-2.0

import chunter from '@hcengineering/chunter'
import notification, { type DocNotifyContext, type DocNotifyLevel } from '@hcengineering/notification'
import { type IntlString } from '@hcengineering/platform'
import { type SelectPopupValueType } from '@hcengineering/ui'

const docNotifyLevels: Array<{ level: DocNotifyLevel, label: IntlString }> = [
  { level: 'all', label: notification.string.NotifyLevelAll },
  { level: 'mentions', label: notification.string.NotifyLevelMentions },
  { level: 'none', label: notification.string.NotifyLevelNone }
]

export function getDocNotifyLevelValues (
  object: Pick<DocNotifyContext, 'objectClass' | 'notifyLevel'>
): SelectPopupValueType[] {
  const isDirectMessage = object.objectClass === chunter.class.DirectMessage
  const current = isDirectMessage && object.notifyLevel === 'mentions' ? 'none' : (object.notifyLevel ?? 'all')

  return docNotifyLevels
    .filter(({ level }) => !isDirectMessage || level !== 'mentions')
    .map(({ level, label }) => ({
      id: level,
      label,
      isSelected: level === current
    }))
}
