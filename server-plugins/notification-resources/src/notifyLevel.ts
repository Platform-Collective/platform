// SPDX-License-Identifier: EPL-2.0

import { type AccountUuid, type Class, type Doc, type Markup, type Ref, type Space } from '@hcengineering/core'
import { type DocNotifyContext, type DocNotifyLevel } from '@hcengineering/notification'
import { extractReferences, markupToJSON } from '@hcengineering/text-core'

export type NotifyLevelContext = Pick<DocNotifyContext, 'objectId' | 'user' | 'space' | 'notifyLevel'>

export interface NotifyLevelReceiver {
  account: AccountUuid
  space: Ref<Space>
}

/**
 * Decides whether a notification may be created for a receiver, given the
 * receiver's notification level for the document (unset means 'all').
 */
export function shouldNotifyForLevel (level: DocNotifyLevel | undefined, isMention: boolean): boolean {
  switch (level) {
    case 'none':
      return false
    case 'mentions':
      return isMention
    default:
      return true
  }
}

/**
 * Returns the receiver's notification level for a document.
 *
 * Only the receiver's own context (same user, stored in the receiver's
 * personal space) is taken into account.
 */
export function selectReceiverNotifyLevel (
  contexts: Array<NotifyLevelContext | undefined>,
  objectId: Ref<Doc>,
  receiver: NotifyLevelReceiver
): DocNotifyLevel | undefined {
  for (const context of contexts) {
    if (context === undefined || context.notifyLevel === undefined) continue
    if (context.objectId !== objectId) continue
    if (context.user !== receiver.account || context.space !== receiver.space) continue
    return context.notifyLevel
  }
  return undefined
}

/**
 * Checks all levels that apply to a notification (e.g. the thread's own level
 * and the level of the channel that contains the thread). Every level has to
 * allow the notification. Mention detection is only evaluated when needed.
 */
export function isAllowedByNotifyLevels (levels: Array<DocNotifyLevel | undefined>, isMention: () => boolean): boolean {
  const restrictive = levels.filter((level) => level !== undefined && level !== 'all')
  if (restrictive.length === 0) return true
  const mentioned = isMention()
  return restrictive.every((level) => shouldNotifyForLevel(level, mentioned))
}

export interface PersistedParentMessage {
  _id: Ref<Doc>
  _class: Ref<Class<Doc>>
  attachedTo?: Ref<Doc>
}

export interface NotifyLevelSource {
  // Loads the persisted activity message with this id (by id only, from the
  // activity domain), or undefined if the document is not an activity message.
  findParentMessage: (objectId: Ref<Doc>) => Promise<PersistedParentMessage | undefined>
  // True if a persisted message of this class can contain a thread whose
  // notifications follow the level of the document the message belongs to.
  isThreadParent: (parentClass: Ref<Class<Doc>>) => boolean
  // Loads contexts of a document that have a restricting notification level.
  findRestrictedContexts: (objectId: Ref<Doc>) => Promise<NotifyLevelContext[]>
}

/**
 * Collects every notification level that applies to a notification for the
 * given document: the receiver's own level and, when the document is a thread
 * parent message, the receiver's level of the channel that contains it.
 *
 * The parent is resolved by id and its persisted class and attachedTo are
 * used; the class or channel claimed by the notification source is ignored.
 */
export async function getApplicableNotifyLevels (
  source: NotifyLevelSource,
  objectId: Ref<Doc>,
  receiver: NotifyLevelReceiver,
  knownContexts: Array<NotifyLevelContext | undefined>
): Promise<Array<DocNotifyLevel | undefined>> {
  const levels: Array<DocNotifyLevel | undefined> = [selectReceiverNotifyLevel(knownContexts, objectId, receiver)]

  const parent = await source.findParentMessage(objectId)
  if (parent === undefined || parent._id !== objectId || !source.isThreadParent(parent._class)) return levels
  const channelId = parent.attachedTo
  if (channelId == null || channelId === objectId) return levels

  const channelContexts = await source.findRestrictedContexts(channelId)
  levels.push(selectReceiverNotifyLevel(channelContexts, channelId, receiver))
  return levels
}

/**
 * Returns true if the markup contains a reference to one of the given ids
 * (a person, or a group mention like @everyone / @here).
 */
export function isMentionedInMarkup (markup: Markup | undefined, targets: string[]): boolean {
  if (markup == null || markup === '' || targets.length === 0) return false
  try {
    return extractReferences(markupToJSON(markup)).some((ref) => targets.includes(ref.objectId))
  } catch {
    return false
  }
}
