//
// Copyright © 2026 Platform Collective.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { type AccountDB } from '@hcengineering/account'
import { type MeasureContext } from '@hcengineering/core'
import {
  type ConsumerControl,
  type ConsumerHandle,
  type ConsumerMessage,
  type PlatformQueue,
  QueueTopic,
  type WorkspaceMemberUnreadMessage
} from '@hcengineering/server-core'

// Stable consumer group so the WorkspaceMemberUnread topic is a work queue:
// every message is handled by exactly one account-service instance, and Kafka
// spreads the partitions across instances instead of each instance seeing all.
export const WORKSPACE_MEMBER_UNREAD_GROUP = 'account-service-workspace-member-unread'

/**
 * Handles one cross-workspace unread message: raise `has_unread` for every
 * member the message names, in the message's workspace, in a single statement.
 * Exported for unit testing without a live queue.
 */
export function createWorkspaceMemberUnreadHandler (
  db: AccountDB
): (
    ctx: MeasureContext,
    msg: ConsumerMessage<WorkspaceMemberUnreadMessage>,
    control: ConsumerControl
  ) => Promise<void> {
  return async (ctx, msg, _control) => {
    const accounts = msg.value?.accounts
    if (accounts === undefined || accounts.length === 0) return

    await db.setWorkspaceMembersUnread(accounts, msg.workspace, true)
    ctx.info('cross-workspace unread: applied', { workspace: msg.workspace, accounts: accounts.length })
  }
}

/**
 * Subscribes account-service to the cross-workspace unread queue produced by the
 * notification trigger, replacing the trigger's per-receiver account RPC with a
 * single bulk DB write per notification batch. Returns the consumer handle so the
 * caller can close it on shutdown.
 */
export function startWorkspaceMemberUnreadConsumer (
  ctx: MeasureContext,
  queue: PlatformQueue,
  db: AccountDB
): ConsumerHandle {
  return queue.createConsumer<WorkspaceMemberUnreadMessage>(
    ctx,
    QueueTopic.WorkspaceMemberUnread,
    WORKSPACE_MEMBER_UNREAD_GROUP,
    createWorkspaceMemberUnreadHandler(db)
  )
}
