// SPDX-License-Identifier: EPL-2.0

import type { FieldValues } from './types'

/**
 * Built-in placeholders resolved from the printed document and print context.
 * Any document attribute can also be referenced as `{{attr:<attributeKey>}}`.
 * @public
 */
export const BUILTIN_FIELDS = [
  'title',
  'identifier',
  'version',
  'status',
  'author',
  'modifiedBy',
  'createdOn',
  'modifiedOn',
  'space',
  'className',
  'workspace',
  'printedBy',
  'printDate'
] as const

/** @public */
export type BuiltinField = (typeof BUILTIN_FIELDS)[number]

/**
 * Placeholders that are resolved by the PDF renderer per page; only valid in header and footer bands.
 * @public
 */
export const PAGE_FIELDS = ['pageNumber', 'totalPages'] as const

/** @public */
export const ATTRIBUTE_FIELD_PREFIX = 'attr:'

/**
 * Fields added for a single print, with values typed in the print preview: `{{custom:Client}}`.
 * @public
 */
export const CUSTOM_FIELD_PREFIX = 'custom:'

const FIELD_PATTERN = /\{\{\s*([A-Za-z0-9_:.-]+)\s*\}\}/g

/**
 * @public
 */
export function fieldPlaceholder (key: string): string {
  return `{{${key}}}`
}

/**
 * List placeholder keys used in the text.
 * @public
 */
export function extractFields (text: string): string[] {
  const result = new Set<string>()
  for (const match of text.matchAll(FIELD_PATTERN)) {
    result.add(match[1])
  }
  return Array.from(result)
}

/**
 * Split text into literal and placeholder chunks, so callers can render each part separately.
 * @public
 */
export function splitFields (text: string): Array<{ text: string, field?: string }> {
  const result: Array<{ text: string, field?: string }> = []
  let last = 0
  for (const match of text.matchAll(FIELD_PATTERN)) {
    const index = match.index ?? 0
    if (index > last) {
      result.push({ text: text.slice(last, index) })
    }
    result.push({ text: match[0], field: match[1] })
    last = index + match[0].length
  }
  if (last < text.length) {
    result.push({ text: text.slice(last) })
  }
  return result
}

/**
 * Replace placeholders with values. Unknown placeholders become empty, page fields are kept for the renderer.
 * @public
 */
export function substituteFields (text: string, values: FieldValues): string {
  return text.replace(FIELD_PATTERN, (placeholder: string, key: string) => {
    if ((PAGE_FIELDS as readonly string[]).includes(key)) {
      return placeholder
    }
    return values[key] ?? ''
  })
}
