// SPDX-License-Identifier: EPL-2.0
import { makeLocalesTest } from '@hcengineering/platform'

it(
  'Locales are equal',
  makeLocalesTest((lang) => import(`../../lang/${lang}.json`))
)

const locales = ['cs', 'de', 'en', 'es', 'fr', 'it', 'ko', 'pl', 'pt', 'pt-br', 'ru', 'sp', 'tr', 'zh']

// The settings integration card renders the description without params; a placeholder would fail formatting.
it.each(locales)('GitlabDesc has no placeholders (%s)', async (lang) => {
  const strings = (await import(`../../lang/${lang}.json`)).string
  expect(strings.GitlabDesc).not.toMatch(/[{}]/)
})

// SetupApp always passes these params; a hard-coded product name or scope list would drift from the pod.
it.each(locales)('setup strings take the title and scopes params (%s)', async (lang) => {
  const strings = (await import(`../../lang/${lang}.json`)).string
  expect(strings.SetupNameAndRedirect).toContain('{title}')
  expect(strings.SetupNameAndRedirect).not.toContain('Huly')
  expect(strings.SetupConfidentialScopes).toContain('{scopes}')
  expect(strings.DisconnectEveryone).toBeTruthy()
  expect(strings.DisconnectEveryoneConfirm).not.toMatch(/[{}]/)
})

// The pod renders this activity message with exactly these params.
it.each(locales)('issue strings exist with their params (%s)', async (lang) => {
  const strings = (await import(`../../lang/${lang}.json`)).string
  expect(strings.GitlabIssue).toBeTruthy()
  for (const param of ['{url}', '{number}', '{repository}', '{repoName}']) {
    expect(strings.IssueConnectedActivityInfo).toContain(param)
  }
})
