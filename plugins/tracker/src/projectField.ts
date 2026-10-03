//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Doc, Ref } from '@hcengineering/core'
import type { Project } from './index'

/**
 * Custom field kinds, mirroring GitHub's `ProjectV2CustomFieldType`.
 * @public
 */
export enum ProjectFieldType {
  Text = 'text',
  Number = 'number',
  Date = 'date',
  SingleSelect = 'singleSelect',
  MultiSelect = 'multiSelect',
  Iteration = 'iteration'
}

/**
 * @public
 */
export interface ProjectFieldOption {
  // Stable id stored in issue.customFields; never changes when the label is renamed
  value: string
  label: string
  color?: number
  description?: string
}

/**
 * User-defined field of a tracker project. Values live in `Issue.customFields[key]`.
 * @public
 */
export interface ProjectField extends Doc {
  space: Ref<Project>
  label: string
  // Slug, unique per project
  key: string
  type: ProjectFieldType
  position: number
  description?: string
  // Not supported for Date fields (GitHub parity)
  defaultValue?: string | number | null
  // SingleSelect / MultiSelect only
  options?: ProjectFieldOption[]
}

/**
 * Value kinds stored in `Issue.customFields`.
 * @public
 */
export type ProjectFieldValue = string | number | string[] | null

/** @public */
export const MAX_PROJECT_FIELDS = 50
/** @public */
export const MAX_PROJECT_FIELD_OPTIONS = 50

/**
 * Turn a label into a camelCase key, e.g. "Story points" -> "storyPoints".
 * Returns an empty string when the label has no alphanumerics.
 * @public
 */
export function slugifyFieldLabel (label: string): string {
  const words = label
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
  if (words.length === 0) return ''
  const [first, ...rest] = words
  const slug = [first.toLowerCase(), ...rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())].join('')
  // Keys must not start with a digit so they stay usable as property names
  return /^\d/.test(slug) ? `f${slug}` : slug
}

/**
 * Pick a key based on the label that does not collide with `taken`.
 * @public
 */
export function generateFieldKey (label: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = slugifyFieldLabel(label)
  if (base === '') return ''
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}${i}`)) i++
  return `${base}${i}`
}

/**
 * @public
 */
export type ProjectFieldValidationError =
  | 'emptyLabel'
  | 'duplicateLabel'
  | 'tooManyFields'
  | 'tooManyOptions'
  | 'duplicateOption'
  | 'emptyOption'
  | 'optionsRequired'
  | 'defaultNotAllowed'
  | 'invalidDefault'

/**
 * Validate a field definition against the other fields of the same project.
 * `existing` must not include the field being edited.
 * @public
 */
export function validateProjectField (
  field: Pick<ProjectField, 'label' | 'type' | 'options' | 'defaultValue'>,
  existing: Array<Pick<ProjectField, 'label'>>
): ProjectFieldValidationError | undefined {
  const label = field.label.trim()
  if (label === '') return 'emptyLabel'
  if (existing.length >= MAX_PROJECT_FIELDS) return 'tooManyFields'
  if (existing.some((f) => f.label.trim().toLowerCase() === label.toLowerCase())) return 'duplicateLabel'

  const isSelect = field.type === ProjectFieldType.SingleSelect || field.type === ProjectFieldType.MultiSelect
  if (isSelect) {
    const options = field.options ?? []
    if (options.length === 0) return 'optionsRequired'
    if (options.length > MAX_PROJECT_FIELD_OPTIONS) return 'tooManyOptions'
    const seen = new Set<string>()
    for (const o of options) {
      const l = o.label.trim().toLowerCase()
      if (l === '') return 'emptyOption'
      if (seen.has(l)) return 'duplicateOption'
      seen.add(l)
    }
  }

  const def = field.defaultValue
  if (def !== undefined && def !== null) {
    switch (field.type) {
      case ProjectFieldType.Text:
        if (typeof def !== 'string') return 'invalidDefault'
        break
      case ProjectFieldType.Number:
        if (typeof def !== 'number' || !Number.isFinite(def)) return 'invalidDefault'
        break
      case ProjectFieldType.SingleSelect:
        if (typeof def !== 'string' || !(field.options ?? []).some((o) => o.value === def)) return 'invalidDefault'
        break
      default:
        return 'defaultNotAllowed'
    }
  }
  return undefined
}

/**
 * Coerce an arbitrary stored value to the shape the field type expects.
 * Returns `null` for anything that does not fit, so stale values (e.g. a removed
 * select option) never crash a presenter.
 * @public
 */
export function normalizeFieldValue (field: Pick<ProjectField, 'type' | 'options'>, value: unknown): ProjectFieldValue {
  if (value === undefined || value === null) return null
  switch (field.type) {
    case ProjectFieldType.Text:
      return typeof value === 'string' ? value : null
    case ProjectFieldType.Number:
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    case ProjectFieldType.Date:
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    case ProjectFieldType.SingleSelect:
      return typeof value === 'string' && (field.options ?? []).some((o) => o.value === value) ? value : null
    case ProjectFieldType.MultiSelect: {
      if (!Array.isArray(value)) return null
      const valid = new Set((field.options ?? []).map((o) => o.value))
      const kept = value.filter((v): v is string => typeof v === 'string' && valid.has(v))
      return kept.length > 0 ? kept : null
    }
    case ProjectFieldType.Iteration:
      return typeof value === 'string' ? value : null
  }
}

/**
 * Read one field value from an issue's `customFields` record.
 * @public
 */
export function getFieldValue (
  customFields: Record<string, unknown> | undefined,
  field: Pick<ProjectField, 'key' | 'type' | 'options'>
): ProjectFieldValue {
  return normalizeFieldValue(field, customFields?.[field.key])
}

/**
 * Return the part of `fields` that exceeds the per-project limit, oldest kept.
 * Used by the server to drop fields created by a client that bypassed the UI check.
 * @public
 */
export function overLimitFields<T extends Pick<ProjectField, 'position'> & { _id: unknown, createdOn?: number }> (
  fields: T[]
): T[] {
  if (fields.length <= MAX_PROJECT_FIELDS) return []
  const sorted = [...fields].sort((a, b) => (a.createdOn ?? 0) - (b.createdOn ?? 0))
  return sorted.slice(MAX_PROJECT_FIELDS)
}
