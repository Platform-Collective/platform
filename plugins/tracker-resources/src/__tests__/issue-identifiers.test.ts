// SPDX-License-Identifier: EPL-2.0

import { SortingOrder, type Client } from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'
import { findIssueByIdentifier } from '../issue-identifiers'

const findOne = jest.fn()
const denied = { set: jest.fn() }
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: {},
  getClient: () => ({ findOne })
}))
jest.mock('@hcengineering/view-resources', () => ({
  accessDeniedStore: { set: (...args: unknown[]) => denied.set(...args) }
}))
jest.mock('svelte/store', () => ({ writable: () => ({ set: jest.fn() }) }))
jest.mock('@hcengineering/ui', () => ({
  getPanelURI: (...args: string[]) => encodeURIComponent(args.join('|'))
}))

import { generateIssueLocation, getIssueIdByIdentifier } from '../issues'

const client = { findOne } as unknown as Pick<Client, 'findOne'>
const issue = { _id: 'issue', _class: tracker.class.Issue, identifier: 'B-7', space: 'project-b' } as unknown as Issue

beforeEach(() => {
  findOne.mockReset()
  denied.set.mockClear()
})

it('prefers a current identifier over any alias', async () => {
  findOne.mockResolvedValueOnce(issue)
  expect(await findIssueByIdentifier(client, 'B-7')).toBe(issue)
  expect(findOne).toHaveBeenCalledTimes(1)
})

it('chooses the newest visible alias with a deterministic tie-breaker and checks access to its issue', async () => {
  findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ issue: issue._id }).mockResolvedValueOnce(issue)
  expect(await findIssueByIdentifier(client, 'A-1')).toBe(issue)
  expect(findOne.mock.calls).toEqual([
    [tracker.class.Issue, { identifier: 'A-1' }, { showArchived: true }],
    [
      tracker.class.IssueIdentifierAlias,
      { identifier: 'A-1' },
      {
        showArchived: true,
        sort: { createdOn: SortingOrder.Descending, _id: SortingOrder.Descending }
      }
    ],
    [tracker.class.Issue, { _id: issue._id }, { showArchived: true }]
  ])
})

it('returns undefined for an unknown identifier', async () => {
  findOne.mockResolvedValue(undefined)
  expect(await findIssueByIdentifier(client, 'UNKNOWN-1')).toBeUndefined()
  expect(findOne).toHaveBeenCalledTimes(2)
})

it.each(['deleted', 'inaccessible'])('does not try older aliases when the newest target is %s', async () => {
  findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ issue: 'missing' }).mockResolvedValueOnce(undefined)
  expect(await findIssueByIdentifier(client, 'A-1')).toBeUndefined()
  expect(findOne).toHaveBeenCalledTimes(3)
})

it.each(['A-1', 'B-7'])('resolves archived short URLs for %s to the current panel identifier', async (identifier) => {
  if (identifier === 'A-1') findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ issue: issue._id })
  findOne.mockResolvedValueOnce(issue)
  const result = await generateIssueLocation({ path: ['workbench', 'workspace', 'tracker', identifier] }, identifier)
  const fragment = encodeURIComponent(`${tracker.component.EditIssue}|B-7|${tracker.class.Issue}|content`)
  expect(result?.loc.fragment).toBe(fragment)
  expect(result?.defaultLocation.path).toEqual(['workbench', 'workspace', 'tracker', issue.space, 'issues'])
  expect(findOne.mock.calls.every((call) => call[2].showArchived === true)).toBe(true)
})

it.each(['A-1', 'B-7'])('decodes archived saved panel identifiers for %s', async (identifier) => {
  if (identifier === 'A-1') findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ issue: issue._id })
  findOne.mockResolvedValueOnce(issue)
  expect(await getIssueIdByIdentifier(identifier)).toBe(issue._id)
  expect(findOne.mock.calls.every((call) => call[2].showArchived === true)).toBe(true)
})

it('leaves object ID panel fragments on the existing path', async () => {
  expect(await getIssueIdByIdentifier('object-id')).toBeUndefined()
  expect(findOne).not.toHaveBeenCalled()
})

it('resolves reused identifiers by current issue, then newest alias, with a stable tie-breaker', async () => {
  const current = { ...issue, _id: 'current', identifier: 'A-1' } as unknown as Issue
  const older = { ...issue, _id: 'older', identifier: 'B-1' } as unknown as Issue
  const newer = { ...issue, _id: 'newer', identifier: 'C-1' } as unknown as Issue
  let issues = [current, older, newer]
  const aliases = [
    { _id: 'alias-1', identifier: 'A-1', issue: older._id, createdOn: 1 },
    { _id: 'alias-2', identifier: 'A-1', issue: newer._id, createdOn: 2 },
    { _id: 'alias-3', identifier: 'A-1', issue: older._id, createdOn: 2 }
  ]
  findOne.mockImplementation(async (cls, query, options) => {
    if (cls === tracker.class.Issue) {
      return issues.find((doc) =>
        query._id === undefined ? doc.identifier === query.identifier : doc._id === query._id
      )
    }
    const sorted = [...aliases]
    for (const [key, order] of Object.entries(options.sort).reverse()) {
      sorted.sort((a, b) => {
        const av = a[key as keyof typeof a]
        const bv = b[key as keyof typeof b]
        return (av < bv ? -1 : av > bv ? 1 : 0) * (order as number)
      })
    }
    return sorted.find((doc) => doc.identifier === query.identifier)
  })
  expect(await findIssueByIdentifier(client, 'A-1')).toBe(current)
  issues = [older, newer]
  expect(await findIssueByIdentifier(client, 'A-1')).toBe(older)
  aliases.pop()
  expect(await findIssueByIdentifier(client, 'A-1')).toBe(newer)
  issues = [older]
  expect(await findIssueByIdentifier(client, 'A-1')).toBeUndefined()
})
