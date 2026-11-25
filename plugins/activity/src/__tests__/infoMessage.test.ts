// SPDX-License-Identifier: EPL-2.0

import { translateCB, type IntlString } from '@hcengineering/platform'
import { createActivityInfoMessageMarkup, translateActivityInfoMessage } from '../infoMessage'

jest.mock('@hcengineering/platform', () => ({ translateCB: jest.fn() }), { virtual: true })

function translate (message: IntlString, props: Record<string, unknown>): string {
  let result = ''
  jest.mocked(translateCB).mockImplementationOnce((_message, params, _language, callback) => {
    let translated: string = message
    for (const [name, value] of Object.entries(params)) {
      translated = translated.replaceAll(`{${name}}`, String(value))
    }
    callback(translated)
  })
  translateActivityInfoMessage(message, props, 'en', (value) => {
    result = value
  })
  return result
}

it('escapes translated parameters before rendering them as HTML', () => {
  const section = '<span data-type="reference">Overview & "Operations"</span>'
  expect(translate('Section locked: {section}; again: {section}' as IntlString, { section })).toBe(
    'Section locked: &lt;span data-type=&quot;reference&quot;&gt;Overview &amp; &quot;Operations&quot;&lt;/span&gt;; ' +
      'again: &lt;span data-type=&quot;reference&quot;&gt;Overview &amp; &quot;Operations&quot;&lt;/span&gt;'
  )
})

it('preserves only parameters explicitly marked as pre-escaped markup', () => {
  const reference = createActivityInfoMessageMarkup('<span data-type="reference" data-label="TEST-42">@TEST-42</span>')
  expect(translate('Duplicate of {issue}' as IntlString, { issue: reference })).toBe(
    'Duplicate of <span data-type="reference" data-label="TEST-42">@TEST-42</span>'
  )
})
