// SPDX-License-Identifier: EPL-2.0

import core, { toRank } from '@hcengineering/core'
import type { Class, Doc, Hierarchy, Ref } from '@hcengineering/core'
import { isRequiredValueEmpty } from '@hcengineering/presentation'
import type { KeyedAttribute } from '@hcengineering/presentation'
import type { TaskType } from '@hcengineering/task'
import tracker from '@hcengineering/tracker'

export interface CreateIssueAttribute extends KeyedAttribute {
  _class: Ref<Class<Doc>>
  mixin: boolean
}

function collectAttributes (
  hierarchy: Hierarchy,
  _class: Ref<Class<Doc>>,
  to: Ref<Class<Doc>>
): CreateIssueAttribute[] {
  return Array.from(hierarchy.getAllAttributes(_class, to))
    .filter(
      ([, attr]) =>
        (attr.isCustom === true || attr.required === true) &&
        attr.hidden !== true &&
        attr.readonly !== true &&
        attr.automationOnly !== true &&
        !hierarchy.isDerived(attr.type._class, core.class.Collection)
    )
    .map(([key, attr]) => ({ key, attr, _class, mixin: hierarchy.isMixin(_class) }))
    .sort((a, b) => {
      const rankA = a.attr.rank ?? toRank(a.attr._id) ?? ''
      const rankB = b.attr.rank ?? toRank(b.attr._id) ?? ''
      return rankA.localeCompare(rankB)
    })
}

export function getTaskTypeAttributes (
  hierarchy: Hierarchy,
  taskType?: Pick<TaskType, 'targetClass'>
): CreateIssueAttribute[] {
  if (taskType === undefined) return []
  const targetClass = hierarchy.findClass(taskType.targetClass)
  if (targetClass === undefined) return []
  return collectAttributes(hierarchy, targetClass._id, tracker.class.Issue)
}

export function getCreateIssueAttributes (
  hierarchy: Hierarchy,
  taskType?: Pick<TaskType, 'targetClass'>
): CreateIssueAttribute[] {
  return [
    ...collectAttributes(hierarchy, tracker.class.Issue, core.class.AttachedDoc),
    ...getTaskTypeAttributes(hierarchy, taskType)
  ]
}

export function getCreateIssueAttributeObject (
  hierarchy: Hierarchy,
  draft: Record<string, unknown>,
  attribute: CreateIssueAttribute
): Doc | Record<string, unknown> {
  return attribute.mixin ? hierarchy.as(draft as unknown as Doc, attribute._class) : draft
}

function getDraftValue (attribute: CreateIssueAttribute, draft: Record<string, unknown>): unknown {
  if (!attribute.mixin) return draft[attribute.key]
  const values = draft[attribute._class]
  return typeof values === 'object' && values !== null
    ? (values as Record<string, unknown>)[attribute.key]
    : undefined
}

export function setCreateIssueAttributeValue<T> (
  draft: T,
  attribute: CreateIssueAttribute,
  value: unknown
): T {
  if (!attribute.mixin) return { ...draft, [attribute.key]: value }
  const result: Record<string, unknown> = { ...(draft as Record<string, unknown>) }
  const current = result[attribute._class]
  result[attribute._class] = {
    ...(typeof current === 'object' && current !== null ? current : {}),
    [attribute.key]: value
  }
  return result as T
}

function hasDraftValue (attribute: CreateIssueAttribute, draft: Record<string, unknown>): boolean {
  if (!attribute.mixin) return attribute.key in draft
  const values = draft[attribute._class]
  return typeof values === 'object' && values !== null && attribute.key in values
}

/**
 * Collects the values to save for the given attributes. Draft values win over `original` values
 * (for example the values of a duplicated issue), and a value cleared in the draft is not restored from `original`.
 */
export function getCreateIssueAttributeValues (
  attributes: CreateIssueAttribute[],
  draft: Record<string, unknown>,
  original: Record<string, unknown> = {}
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...original }
  for (const attribute of attributes) {
    const value = getDraftValue(attribute, draft)
    if (value !== undefined) {
      values[attribute.key] = value
    } else if (
      attribute.attr.defaultValue != null &&
      (original[attribute.key] === undefined || hasDraftValue(attribute, draft))
    ) {
      values[attribute.key] = structuredClone(attribute.attr.defaultValue)
    } else if (hasDraftValue(attribute, draft)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete values[attribute.key]
    }
  }
  return values
}

/**
 * What an untouched dialog already contains: the selected task type and the default attribute values.
 * Used as the "empty" reference so that opening and closing the dialog does not keep a draft.
 */
export function getUntouchedCreateIssueDraft (
  attributes: CreateIssueAttribute[],
  kind: Ref<TaskType> | undefined
): Record<string, unknown> {
  return fillCreateIssueAttributeDefaults(attributes, { kind: kind ?? '' })
}

/**
 * Stores the mixin values to save, or removes the mixin when no value is left
 * (for example when every value copied from a duplicated issue was cleared).
 */
export function setCreateIssueMixinValues (
  mixins: Map<Ref<Class<Doc>>, Record<string, unknown>>,
  mixin: Ref<Class<Doc>>,
  values: Record<string, unknown>
): void {
  if (Object.keys(values).length > 0) mixins.set(mixin, values)
  else mixins.delete(mixin)
}

export function fillCreateIssueAttributeDefaults<T> (attributes: CreateIssueAttribute[], draft: T): T {
  let result = draft
  for (const attribute of attributes) {
    if (
      getDraftValue(attribute, result as Record<string, unknown>) === undefined &&
      attribute.attr.defaultValue != null
    ) {
      result = setCreateIssueAttributeValue(result, attribute, structuredClone(attribute.attr.defaultValue))
    }
  }
  return result
}

export function isRequiredAttributeFilled (
  attribute: CreateIssueAttribute,
  draft: Record<string, unknown>
): boolean {
  if (attribute.attr.required !== true) return true
  const draftValue = getDraftValue(attribute, draft)
  return !isRequiredValueEmpty(attribute.attr, draftValue !== undefined ? draftValue : attribute.attr.defaultValue)
}

export function areRequiredAttributesFilled (
  attributes: CreateIssueAttribute[],
  draft: Record<string, unknown>
): boolean {
  return attributes.every((attribute) => isRequiredAttributeFilled(attribute, draft))
}

function withoutKey (values: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([name]) => name !== key))
}

export function removeChangedTaskTypeValues<T> (
  draft: T,
  previousAttributes: CreateIssueAttribute[],
  nextAttributes: CreateIssueAttribute[]
): T {
  let result = draft as Record<string, unknown>
  for (const previous of previousAttributes) {
    const next = nextAttributes.find(
      (attribute) => attribute.key === previous.key && attribute.attr._id === previous.attr._id
    )
    const value = getDraftValue(previous, result)
    if (next !== undefined && value !== undefined) {
      result = setCreateIssueAttributeValue(result, next, value)
    }
    if (next === undefined || next._class !== previous._class) {
      if (previous.mixin) {
        const current = result[previous._class]
        if (typeof current === 'object' && current !== null) {
          const values = withoutKey(current as Record<string, unknown>, previous.key)
          if (Object.keys(values).length > 0) result[previous._class] = values
          else result = withoutKey(result, previous._class)
        }
      } else {
        result = withoutKey(result, previous.key)
      }
    }
  }
  return result as T
}
