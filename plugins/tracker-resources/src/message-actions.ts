// SPDX-License-Identifier: EPL-2.0

import type { ActivityMessage } from '@hcengineering/activity'
import attachment from '@hcengineering/attachment'
import chunter, { type ChatMessage } from '@hcengineering/chunter'
import { getMessageLink } from '@hcengineering/chunter-resources/src/navigation'
import type { MessageActionFunction, MessageActionVisibilityTester } from '@hcengineering/communication'
import { MessageType } from '@hcengineering/communication-types'
import { isBlobAttachment } from '@hcengineering/communication-shared'
import { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
import { inboxId } from '@hcengineering/inbox'
import { getMetadata, setPlatformStatus, translate, unknownError } from '@hcengineering/platform'
import presentation, { getClient } from '@hcengineering/presentation'
import { jsonToMarkup } from '@hcengineering/text'
import { markdownToMarkup } from '@hcengineering/text-markdown'
import { getCurrentResolvedLocation, locationToUrl, showPopup } from '@hcengineering/ui'
import { encodeObjectURI } from '@hcengineering/view'

import { getMessageAttachmentData, getMessageIssueData, isMessageBlobId } from './message-issue'
import tracker from './plugin'

function canCreateIssue (): boolean {
  return hasAccountRole(getCurrentAccount(), AccountRole.User)
}

export async function canCreateIssueFromMessage (doc?: ActivityMessage | ActivityMessage[]): Promise<boolean> {
  const message = Array.isArray(doc) ? undefined : doc
  return (
    message !== undefined &&
    canCreateIssue() &&
    getClient().getHierarchy().isDerived(message._class, chunter.class.ChatMessage)
  )
}

export const canCreateIssueFromCommunicationMessage: MessageActionVisibilityTester = (message) => {
  return canCreateIssue() && message.type === MessageType.Text
}

export async function createIssueFromMessage (message: ChatMessage): Promise<void> {
  if (!(await canCreateIssueFromMessage(message))) return

  try {
    const client = getClient()
    const [sourceUrl, sourceLabel, fallbackTitle, attachments] = await Promise.all([
      getMessageLink(message),
      translate(tracker.string.SourceMessage, {}),
      translate(tracker.string.NewIssue, {}),
      client.findAll(attachment.class.Attachment, { attachedTo: message._id })
    ])

    showPopup(
      tracker.component.CreateIssue,
      {
        shouldSaveDraft: false,
        initialData: getMessageIssueData(message.message, sourceUrl, sourceLabel, fallbackTitle),
        initialAttachments: attachments.filter((file) => isMessageBlobId(file.file)).map(getMessageAttachmentData)
      },
      'top'
    )
  } catch (err: unknown) {
    await setPlatformStatus(unknownError(err))
  }
}

export const createIssueFromCommunicationMessage: MessageActionFunction = async (message, card) => {
  if (!canCreateIssueFromCommunicationMessage(message)) return

  try {
    const location = getCurrentResolvedLocation()
    const frontUrl = getMetadata(presentation.metadata.FrontUrl) ?? window.location.origin
    const sourceUrl =
      frontUrl.replace(/\/$/, '') +
      locationToUrl({
        path: [...location.path.slice(0, 2), inboxId, encodeObjectURI(card._id, card._class)],
        query: { message: encodeURIComponent(`${message.id}:${message.created.toISOString()}`) }
      })
    const [sourceLabel, fallbackTitle] = await Promise.all([
      translate(tracker.string.SourceMessage, {}),
      translate(tracker.string.NewIssue, {})
    ])

    showPopup(
      tracker.component.CreateIssue,
      {
        shouldSaveDraft: false,
        initialData: getMessageIssueData(
          jsonToMarkup(markdownToMarkup(message.content)),
          sourceUrl,
          sourceLabel,
          fallbackTitle
        ),
        initialAttachments: message.attachments
          .filter(isBlobAttachment)
          .filter((file) => isMessageBlobId(file.params.blobId))
          .map((file) => ({
            file: file.params.blobId,
            name: file.params.fileName,
            type: file.mimeType,
            size: file.params.size,
            metadata: file.params.metadata,
            lastModified: (file.modified ?? file.created).getTime()
          }))
      },
      'top'
    )
  } catch (err: unknown) {
    await setPlatformStatus(unknownError(err))
  }
}
