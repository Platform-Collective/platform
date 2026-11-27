// SPDX-License-Identifier: EPL-2.0

import { addStringsLoader, type IntlString, type Plugin } from '@hcengineering/platform'
import { createActivityInfoMessageReference, translateActivityInfoMessage } from '../infoMessage'

const duplicateOf = 'tracker:string:DuplicateOf' as IntlString
const markedAsDuplicate = 'tracker:string:MarkedAsDuplicateOfThis' as IntlString
const otherIssueMessage = 'tracker:string:OtherIssueMessage' as IntlString
const sectionLocked = 'card:string:SectionLocked' as IntlString
const sectionUnlocked = 'card:string:SectionUnlocked' as IntlString
const legacy =
  '<span data-type="reference" data-id="issue-id" data-objectclass="tracker:class:Issue" data-label="TEST-42">@TEST-42</span>'
const escapedLegacy =
  '&lt;span data-type=&quot;reference&quot; data-id=&quot;issue-id&quot; ' +
  'data-objectclass=&quot;tracker:class:Issue&quot; data-label=&quot;TEST-42&quot;&gt;@TEST-42&lt;/span&gt;'

addStringsLoader('tracker' as Plugin, async (locale) => ({
  string: {
    DuplicateOf: locale === 'en-US' ? 'Duplicate of {issue}: {label}' : 'Duplicate of {issue}',
    MarkedAsDuplicateOfThis: '{issue} was marked as duplicate of this issue',
    OtherIssueMessage: 'Issue {issue}'
  }
}))
addStringsLoader('card' as Plugin, async () => ({
  string: { SectionLocked: 'Section {section} locked', SectionUnlocked: 'Section {section} unlocked' }
}))

async function translate (message: IntlString, props: Record<string, unknown>, language = 'en'): Promise<string> {
  return await new Promise((resolve) => {
    translateActivityInfoMessage(message, props, language, resolve)
  })
}

it('renders the same legacy value as a link in duplicate entries and as text in ordinary entries', async () => {
  await expect(translate(duplicateOf, { issue: legacy })).resolves.toBe(`Duplicate of ${legacy}`)
  await expect(translate(markedAsDuplicate, { issue: legacy })).resolves.toBe(
    `${legacy} was marked as duplicate of this issue`
  )
  await expect(translate(sectionLocked, { section: legacy })).resolves.toBe(`Section ${escapedLegacy} locked`)
  await expect(translate(sectionUnlocked, { section: legacy })).resolves.toBe(`Section ${escapedLegacy} unlocked`)
  await expect(translate(otherIssueMessage, { issue: legacy })).resolves.toBe(`Issue ${escapedLegacy}`)
})

it('escapes other parameters even in a duplicate message', async () => {
  await expect(translate(duplicateOf, { issue: legacy, label: legacy }, 'en-US')).resolves.toBe(
    `Duplicate of ${legacy}: ${escapedLegacy}`
  )
})

it('keeps newly written references compatible with legacy string readers', async () => {
  const reference = createActivityInfoMessageReference({
    id: 'issue-"id"',
    objectClass: 'tracker:class:Issue',
    label: 'T<&-42'
  })
  expect(reference).toBe(
    '<span data-type="reference" data-id="issue-&quot;id&quot;" data-objectclass="tracker:class:Issue" data-label="T&lt;&amp;-42">@T&lt;&amp;-42</span>'
  )
  await expect(translate(duplicateOf, { issue: reference })).resolves.toBe(`Duplicate of ${reference}`)
})

it('escapes malformed reference strings and treats stored objects as text', async () => {
  await expect(translate(duplicateOf, { issue: { __activityInfoMessageMarkup: legacy } })).resolves.toBe(
    'Duplicate of [object Object]'
  )
  await expect(translate(duplicateOf, { issue: `${legacy}\n` })).resolves.toBe(`Duplicate of ${escapedLegacy}\n`)
  const malformed = legacy.replace('>@TEST-42', ' class="extra">@TEST-42')
  await expect(translate(duplicateOf, { issue: malformed })).resolves.toBe(
    `Duplicate of ${escapedLegacy.replace('&gt;@TEST-42', ' class=&quot;extra&quot;&gt;@TEST-42')}`
  )
})
