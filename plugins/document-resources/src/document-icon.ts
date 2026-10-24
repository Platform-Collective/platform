// SPDX-License-Identifier: EPL-2.0

import type { DocumentUpdate } from '@hcengineering/core'
import type { Document } from '@hcengineering/document'
import type { IconProps } from '@hcengineering/view'

/** Convert an icon picker result into a document update, ignoring popup cancellation. */
export function getDocumentIconUpdate (result: IconProps | null | undefined): DocumentUpdate<Document> | undefined {
  if (result === undefined || result === null) return undefined

  if (result.icon === undefined && result.color === undefined) {
    return { $unset: { icon: true, color: true } }
  }

  return { icon: result.icon, color: result.color }
}
