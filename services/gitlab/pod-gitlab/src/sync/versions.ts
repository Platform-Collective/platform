// SPDX-License-Identifier: EPL-2.0

import type { DocumentUpdate } from '@hcengineering/core'
import type { DocSyncInfo } from '@hcengineering/gitlab'

/** Stored in DocSyncInfo.needSync when a document is in sync. Bumping it re-syncs everything. */
export const GITLAB_SYNC_VERSION = 'v1'

/** The DocSyncInfo update of a document that is in sync; spread it, never mutate it. */
export const SYNC_DONE: Readonly<DocumentUpdate<DocSyncInfo>> = Object.freeze({ needSync: GITLAB_SYNC_VERSION })
