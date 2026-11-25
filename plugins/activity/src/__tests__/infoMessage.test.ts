// SPDX-License-Identifier: EPL-2.0

import { translateCB, type IntlString } from '@hcengineering/platform'
import { createActivityInfoMessageReference, translateActivityInfoMessage } from '../infoMessage'

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

it('renders legacy string references from validated individual values', () => {
  const legacy =
    '<span data-type="reference" data-id="issue-id" data-objectclass="tracker:class:Issue" data-label="TEST-42">@TEST-42</span>'
  expect(translate('Duplicate of {issue}' as IntlString, { issue: legacy })).toBe(`Duplicate of ${legacy}`)
})

it('keeps newly written references compatible with legacy string readers', () => {
  const reference = createActivityInfoMessageReference({
    id: 'issue-"id"',
    objectClass: 'tracker:class:Issue',
    label: 'T<&-42'
  })
  expect(reference).toBe(
    '<span data-type="reference" data-id="issue-&quot;id&quot;" data-objectclass="tracker:class:Issue" data-label="T&lt;&amp;-42">@T&lt;&amp;-42</span>'
  )
  expect(translate('Duplicate of {issue}' as IntlString, { issue: reference })).toBe(`Duplicate of ${reference}`)
})

it('does not trust markup flags or malformed references in stored props', () => {
  const injected = '<img src=x onerror="alert(1)">'
  expect(
    translate('Duplicate of {issue}' as IntlString, {
      issue: { __activityInfoMessageMarkup: injected }
    })
  ).toBe('Duplicate of [object Object]')
  const malformed =
    '<span data-type="reference" data-id="issue-id" data-objectclass="tracker:class:Issue" data-label="TEST-42" onclick="alert(1)">@TEST-42</span>'
  expect(translate('Duplicate of {issue}' as IntlString, { issue: malformed })).toBe(
    'Duplicate of &lt;span data-type=&quot;reference&quot; data-id=&quot;issue-id&quot; ' +
      'data-objectclass=&quot;tracker:class:Issue&quot; data-label=&quot;TEST-42&quot; ' +
      'onclick=&quot;alert(1)&quot;&gt;@TEST-42&lt;/span&gt;'
  )
})
