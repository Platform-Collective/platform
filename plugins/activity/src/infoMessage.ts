// SPDX-License-Identifier: EPL-2.0

import { translateCB, type IntlString } from '@hcengineering/platform'

export interface ActivityInfoMessageReference {
  readonly id: string
  readonly objectClass: string
  readonly label: string
}

// These persisted message IDs use the legacy string format for their issue parameter.
const DUPLICATE_MESSAGES = new Set<string>(['tracker:string:DuplicateOf', 'tracker:string:MarkedAsDuplicateOfThis'])
const referencePattern =
  /^<span data-type="reference" data-id="([^"]*)" data-objectclass="([^"]*)" data-label="([^"]*)">@\3<\/span>$/

function escapeValue (value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function unescapeValue (value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
}

/** Serialize a reference in the legacy string format using separately escaped values. */
export function createActivityInfoMessageReference (reference: ActivityInfoMessageReference): string {
  const id = escapeValue(reference.id)
  const objectClass = escapeValue(reference.objectClass)
  const label = escapeValue(reference.label)
  return `<span data-type="reference" data-id="${id}" data-objectclass="${objectClass}" data-label="${label}">@${label}</span>`
}

function parseReference (value: string): ActivityInfoMessageReference | undefined {
  const match = referencePattern.exec(value)
  if (match === null) return undefined
  return {
    id: unescapeValue(match[1]),
    objectClass: unescapeValue(match[2]),
    label: unescapeValue(match[3])
  }
}

function escapeParam (value: unknown, isReference: boolean): string {
  if (isReference && typeof value === 'string') {
    const reference = parseReference(value)
    if (reference !== undefined) return createActivityInfoMessageReference(reference)
  }
  return escapeValue(String(value))
}

/** Translate an info message with parameters safe for HTML rendering. */
export function translateActivityInfoMessage (
  message: IntlString,
  props: Record<string, unknown> | undefined,
  language: string | undefined,
  resolve: (value: string) => void
): void {
  const isDuplicateMessage = DUPLICATE_MESSAGES.has(message)
  const escapedProps = Object.fromEntries(
    Object.entries(props ?? {}).map(([name, value]) => [
      name,
      escapeParam(value, isDuplicateMessage && name === 'issue')
    ])
  )
  translateCB(message, escapedProps, language, resolve)
}
