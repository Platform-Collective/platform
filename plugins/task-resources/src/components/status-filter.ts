// SPDX-License-Identifier: EPL-2.0

import type { IdMap, Ref, Status } from '@hcengineering/core'

export function getTaskTypeStatuses (statusIds: Ref<Status>[], statusStore: IdMap<Status>): Status[] {
  return statusIds.map((id) => statusStore.get(id)).filter((status): status is Status => status !== undefined)
}
