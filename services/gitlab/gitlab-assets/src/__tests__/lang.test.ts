// SPDX-License-Identifier: EPL-2.0
import { makeLocalesTest } from '@hcengineering/platform'

it(
  'Locales are equal',
  makeLocalesTest((lang) => import(`../../lang/${lang}.json`))
)

const locales = ['cs', 'de', 'en', 'es', 'fr', 'it', 'ko', 'pl', 'pt', 'pt-br', 'ru', 'sp', 'tr', 'zh']

type Strings = Record<string, string>

async function stringsOf (lang: string): Promise<Strings> {
  return (await import(`../../lang/${lang}.json`)).string
}

let english: Strings
beforeAll(async () => {
  english = await stringsOf('en')
})

// The settings integration card renders the description without params; a placeholder would fail formatting.
it.each(locales)('GitlabDesc has no placeholders (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  expect(strings.GitlabDesc).not.toMatch(/[{}]/)
})

// SetupApp always passes these params; a hard-coded product name or scope list would drift from the pod.
it.each(locales)('setup strings take the title and scopes params (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  expect(strings.SetupNameAndRedirect).toContain('{title}')
  expect(strings.SetupNameAndRedirect).not.toContain('Huly')
  expect(strings.SetupConfidentialScopes).toContain('{scopes}')
  expect(strings.DisconnectEveryone).toBeTruthy()
  expect(strings.DisconnectEveryoneConfirm).not.toMatch(/[{}]/)
})

// The pod renders this activity message with exactly these params.
it.each(locales)('issue strings exist with their params (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  expect(strings.GitlabIssue).toBeTruthy()
  for (const param of ['{url}', '{number}', '{repository}', '{repoName}']) {
    expect(strings.IssueConnectedActivityInfo).toContain(param)
  }
})

const MERGE_REQUEST_KEYS = [
  'MergeRequest',
  'MergeRequests',
  'MergeRequestConnectedActivityInfo',
  'Draft',
  'MergedAt',
  'ClosedAt',
  'Commits',
  'Files',
  'SourceBranch',
  'TargetBranch',
  'MergeStatus',
  'MergeRequestState',
  'Reviewers',
  'StateOpened',
  'StateMerged',
  'StateClosed',
  'StateLocked',
  'ReadyToMerge',
  'Conflict',
  'Checking',
  'PipelinePending',
  'UnresolvedDiscussions',
  'NeedsApproval',
  'All',
  'Active',
  'Closed',
  'ChangedFiles',
  'WithoutRepository',
  'CreateInGitlab',
  'DiffUnavailable',
  'DiffTooLarge'
]

// The pod renders the activity message with exactly these params; the diff panel passes {files}.
it.each(locales)('merge request strings exist with their params (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  for (const key of MERGE_REQUEST_KEYS) {
    expect(strings[key]).toBeTruthy()
  }
  for (const param of ['{url}', '{number}', '{repository}', '{repoName}']) {
    expect(strings.MergeRequestConnectedActivityInfo).toContain(param)
  }
  expect(strings.ChangedFiles).toContain('{files}')
})

const REVIEW_KEYS = [
  'ApprovedBy',
  'Approve',
  'RevokeApproval',
  'ConnectToApprove',
  'Review',
  'ReviewThread',
  'ReviewComment',
  'ReviewComments',
  'ReviewApproved',
  'ReviewUnapproved',
  'ReviewRequestedChanges',
  'ReviewReviewed',
  'CommentedOnDiff',
  'ResolveThread',
  'UnresolveThread',
  'ResolvedBy',
  'Outdated'
]

// The thread presenter always passes {path}
it.each(locales)('review strings exist with their params (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  for (const key of REVIEW_KEYS) expect(strings[key]).toBeTruthy()
  expect(strings.CommentedOnDiff).toContain('{path}')
})

const SYNC_ERROR_KEYS = ['SyncError', 'Retry', 'ReviewNotSent']

it.each(locales)('sync error strings exist (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  for (const key of SYNC_ERROR_KEYS) expect(strings[key]).toBeTruthy()
})

const IMAGE_MODE_KEYS = ['ImageMode', 'ImageModeLink', 'ImageModeCopy', 'ImageModeLinkHint', 'ImageModeCopyHint']

// The image mode setting is translated in every locale, never left in English
it.each(locales.filter((it) => it !== 'en'))('image mode strings are translated (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  for (const key of IMAGE_MODE_KEYS) {
    expect(strings[key]).toBeTruthy()
    expect(strings[key]).not.toBe(english[key])
  }
})

const IMAGE_VIEWER_KEYS = ['ImageNoAccess', 'ImageNotConnected', 'ImageUnavailable', 'GitlabImages']

// The image viewer placeholders are translated in every locale, never left in English
it.each(locales.filter((it) => it !== 'en'))('image viewer strings are translated (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  for (const key of [...IMAGE_VIEWER_KEYS, 'OpenInGitlab']) expect(strings[key]).toBeTruthy()
  for (const key of IMAGE_VIEWER_KEYS) expect(strings[key]).not.toBe(english[key])
})

// The issue header passes {count}
it.each(locales)('GitlabImages takes the count param (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  expect(strings.GitlabImages).toContain('{count}')
})

const CLIENT_ERROR_KEYS = ['LinkFailed', 'UnlinkFailed', 'NotConfigured', 'AuthorizeLinkInvalid', 'RemoveAppConfirm']

// Setup and error strings are real translations, never English copies
it.each(locales.filter((it) => it !== 'en'))('setup and error strings are translated (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  for (const key of [
    ...CLIENT_ERROR_KEYS,
    'ApplicationId',
    'ApplicationSecret',
    'SetupNameAndRedirect',
    'SyncErrorMessage',
    'UnlinkConfirm',
    'IntegrationRepositories'
  ]) {
    expect(strings[key]).toBeTruthy()
    expect(strings[key]).not.toBe(english[key])
  }
})

// The components always pass these params
it.each(locales)('error and header strings take their params (%s)', async (lang) => {
  const strings = await stringsOf(lang)
  expect(strings.SyncErrorMessage).toContain('{message}')
  for (const param of ['{host}', '{login}']) expect(strings.IntegrationRepositories).toContain(param)
  for (const param of ['{repository}', '{project}']) expect(strings.UnlinkConfirm).toContain(param)
  for (const key of CLIENT_ERROR_KEYS) expect(strings[key]).not.toMatch(/[{}]/)
})
