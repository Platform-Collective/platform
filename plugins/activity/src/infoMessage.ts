// SPDX-License-Identifier: EPL-2.0

import { translateCB, type IntlString } from '@hcengineering/platform'

export interface ActivityInfoMessageMarkup {
  readonly __activityInfoMessageMarkup: string
}

/** Mark a parameter whose HTML has already been escaped by its producer. */
export function createActivityInfoMessageMarkup (value: string): ActivityInfoMessageMarkup {
  return { __activityInfoMessageMarkup: value }
}

function isMarkup (value: unknown): value is ActivityInfoMessageMarkup {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__activityInfoMessageMarkup' in value &&
    typeof value.__activityInfoMessageMarkup === 'string'
  )
}

function escapeParam (value: unknown): string {
  if (isMarkup(value)) return value.__activityInfoMessageMarkup
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Translate an info message with parameters safe for HTML rendering. */
export function translateActivityInfoMessage (
  message: IntlString,
  props: Record<string, any> | undefined,
  language: string | undefined,
  resolve: (value: string) => void
): void {
  const escapedProps = Object.fromEntries(
    Object.entries(props ?? {}).map(([name, value]) => [name, escapeParam(value)])
  )
  translateCB(message, escapedProps, language, resolve)
}
