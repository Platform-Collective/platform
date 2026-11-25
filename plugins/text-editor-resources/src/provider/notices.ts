// SPDX-License-Identifier: EPL-2.0

import {
  CONTENT_NOTICE_KEY,
  CONTENT_NOTICE_MAP,
  type CollaborationNotice,
  parseCollaborationNotice
} from '@hcengineering/collaborator-client'
import { type Doc as YDoc, type YMapEvent } from 'yjs'

export function observeContentNotices (
  ydoc: YDoc,
  isSynced: () => boolean,
  callback: (notice: CollaborationNotice) => void
): () => void {
  const notices = ydoc.getMap<unknown>(CONTENT_NOTICE_MAP)
  const observer = (event: YMapEvent<unknown>): void => {
    if (!isSynced() || !event.keysChanged.has(CONTENT_NOTICE_KEY)) return
    const notice = parseCollaborationNotice(notices.get(CONTENT_NOTICE_KEY))
    if (notice !== undefined) callback(notice)
  }

  notices.observe(observer)
  return () => {
    notices.unobserve(observer)
  }
}
