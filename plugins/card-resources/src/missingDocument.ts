// SPDX-License-Identifier: EPL-2.0

import type { Card } from '@hcengineering/card'
import type { Ref } from '@hcengineering/core'
import { getResourceC } from '@hcengineering/platform'
import workbench from '@hcengineering/workbench'

export function handleMissingCardDocument (objectId: Ref<Card>, isCurrent: () => boolean, fallback: () => void): void {
  getResourceC(workbench.function.HandleMissingTabDocument, (handleMissingTabDocument) => {
    if (!isCurrent()) return
    if (handleMissingTabDocument?.(objectId) === true) return
    fallback()
  })
}
