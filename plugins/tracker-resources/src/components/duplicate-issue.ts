// SPDX-License-Identifier: EPL-2.0

import type { AnyAttribute, Doc, Hierarchy, Mixin, Ref } from '@hcengineering/core'
import type { TaskType } from '@hcengineering/task'
import type { Issue } from '@hcengineering/tracker'

interface DuplicateIssueCustomFields {
  attributes: Record<string, unknown>
  mixins: Map<Ref<Mixin<Doc>>, Record<string, unknown>>
}

/** Copy user-defined fields without carrying over issue or integration metadata. */
export function getDuplicateIssueCustomFields (
  hierarchy: Hierarchy,
  originalIssue?: Issue,
  kind: Ref<TaskType> | undefined = originalIssue?.kind
): DuplicateIssueCustomFields {
  const result: DuplicateIssueCustomFields = { attributes: {}, mixins: new Map() }
  if (originalIssue === undefined || originalIssue.kind !== kind) return result

  function copyAttributes (object: Doc, attributes: Map<string, AnyAttribute>): Record<string, unknown> {
    const values = object as unknown as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, attribute] of attributes) {
      if (attribute.isCustom === true && values[key] !== undefined) {
        result[key] = values[key]
      }
    }
    return result
  }

  result.attributes = copyAttributes(originalIssue, hierarchy.getAllAttributes(originalIssue._class))
  for (const mixin of hierarchy.findAllMixins(originalIssue)) {
    const attributes = copyAttributes(hierarchy.as(originalIssue, mixin), hierarchy.getOwnAttributes(mixin))
    if (Object.keys(attributes).length > 0) {
      result.mixins.set(mixin, attributes)
    }
  }
  return result
}
