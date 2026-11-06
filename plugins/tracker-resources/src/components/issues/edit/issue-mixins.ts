// SPDX-License-Identifier: EPL-2.0

import { ClassifierKind } from '@hcengineering/core'
import type { Class, Doc, Mixin } from '@hcengineering/core'

/** Include the selected task type's fields even before their first values are stored. */
export function getIssueMixins (mixins: Mixin<Doc>[], taskTypeClass?: Class<Doc>): Mixin<Doc>[] {
  const result = new Map(mixins.map((mixin) => [mixin._id, mixin]))
  if (taskTypeClass?.kind === ClassifierKind.MIXIN) {
    result.set(taskTypeClass._id, taskTypeClass)
  }
  return Array.from(result.values())
}
