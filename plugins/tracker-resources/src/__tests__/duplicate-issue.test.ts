// SPDX-License-Identifier: EPL-2.0

import chunter from '@hcengineering/chunter'
import core, { type Account, AccountRole, setCurrentAccount } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import task from '@hcengineering/task'
import { type Issue } from '@hcengineering/tracker'
import { canChangeDoc } from '@hcengineering/view-resources'
import { canMarkIssueDuplicate, canShowMarkIssueDuplicate, markIssueDuplicate } from '../duplicate-issue'
import { updateIssueRelation } from '../issues'
import tracker from '../plugin'
import { canEditIssue } from '../utils'

jest.mock('@hcengineering/contact-resources', () => ({ permissionsStore: {} }))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/view-resources', () => ({ canChangeDoc: jest.fn() }))
jest.mock('svelte/store', () => ({ get: () => ({}) }))
jest.mock('../utils', () => ({ canEditIssue: jest.fn() }))
jest.mock('../issues', () => ({ updateIssueRelation: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  translate: async (key: string, params: Record<string, string>) => {
    const { string: strings } = jest.requireActual('../../../tracker-assets/lang/en.json')
    return strings[key.split(':').pop() ?? ''].replace('{issue}', () => params.issue)
  }
}))

const duplicate = {
  _id: 'duplicate',
  _class: tracker.class.Issue,
  space: 'project',
  kind: 'kind',
  identifier: 'TEST-7',
  status: 'open',
  modifiedOn: 1
} as unknown as Issue
const original: Issue = {
  ...duplicate,
  _id: 'original' as Issue['_id'],
  space: 'other-project' as Issue['space'],
  identifier: 'OTHER-42'
}
const canceled = { _id: 'canceled', category: task.statusCategory.Lost }
const ops = {
  match: jest.fn(),
  update: jest.fn(),
  addCollection: jest.fn(),
  commit: jest.fn()
}
const client = { findOne: jest.fn(), findAll: jest.fn(), apply: jest.fn() }
let documents: Map<string, unknown>

beforeEach(() => {
  jest.clearAllMocks()
  documents = new Map<string, unknown>([
    [duplicate._id, duplicate],
    [original._id, original],
    ['project', { type: 'workflow' }],
    ['kind', { parent: 'workflow', statuses: ['canceled'] }],
    ['open', { _id: 'open', category: task.statusCategory.Active }],
    ['done', { _id: 'done', category: task.statusCategory.Won }],
    ['canceled', canceled]
  ])
  client.findOne.mockImplementation(async (_class, query: { _id: string }) => documents.get(query._id))
  client.findAll.mockImplementation(async (_class) =>
    _class === core.class.Status
      ? [canceled]
      : [
          { attachedTo: duplicate._id, collaborator: 'alice' },
          { attachedTo: duplicate._id, collaborator: 'bob' },
          { attachedTo: duplicate._id, collaborator: 'bob' },
          { attachedTo: original._id, collaborator: 'alice' }
        ]
  )
  client.apply.mockReturnValue(ops)
  ops.commit.mockResolvedValue({ result: true })
  jest.mocked(getClient).mockReturnValue(client as unknown as ReturnType<typeof getClient>)
  const account: Partial<Account> = { role: AccountRole.User }
  setCurrentAccount(account as Account)
  jest.mocked(canChangeDoc).mockReturnValue(true)
  jest.mocked(canEditIssue).mockResolvedValue(true)
})

it('links both issues, comments on both, cancels the duplicate and unions subscribers in one batch', async () => {
  await markIssueDuplicate(duplicate._id, original._id)

  expect(canEditIssue).toHaveBeenCalledWith(duplicate)
  expect(canEditIssue).toHaveBeenCalledWith(original)
  expect(updateIssueRelation).toHaveBeenCalledWith(ops, duplicate, original, 'relations', '$push')
  expect(updateIssueRelation).toHaveBeenCalledWith(ops, original, duplicate, 'relations', '$push')
  expect(ops.update).toHaveBeenCalledWith(duplicate, { status: 'canceled' })
  expect(ops.update).toHaveBeenCalledTimes(1)
  const comments = ops.addCollection.mock.calls.filter((call) => call[0] === chunter.class.ChatMessage)
  const reference = (issue: Issue): unknown => ({
    type: 'reference',
    attrs: { id: issue._id, label: issue.identifier, objectclass: issue._class }
  })
  expect(comments.map((call) => [call[1], call[2], call[4], JSON.parse(call[5].message).content[0].content])).toEqual([
    ['project', duplicate._id, 'comments', [{ type: 'text', text: 'Duplicate of ' }, reference(original)]],
    [
      'other-project',
      original._id,
      'comments',
      [reference(duplicate), { type: 'text', text: ' was marked as duplicate of this issue' }]
    ]
  ])
  expect(ops.addCollection).toHaveBeenCalledWith(
    core.class.Collaborator,
    original.space,
    original._id,
    original._class,
    'collaborators',
    { collaborator: 'bob' }
  )
  expect(ops.addCollection).toHaveBeenCalledTimes(3)
  expect(ops.match).toHaveBeenCalledWith(tracker.class.Issue, { _id: duplicate._id, modifiedOn: 1 })
  expect(ops.match).toHaveBeenCalledWith(tracker.class.Issue, { _id: original._id, modifiedOn: 1 })
  expect(ops.commit).toHaveBeenCalledTimes(1)
})

it.each([duplicate._id, original._id])('does not write when issue %s cannot be edited', async (deniedId) => {
  jest.mocked(canEditIssue).mockImplementation(async (issue) => issue?._id !== deniedId)
  await expect(markIssueDuplicate(duplicate._id, original._id)).rejects.toThrow('edit both issues')
  expect(client.apply).not.toHaveBeenCalled()
})

it('honors space permissions even when the tracker guest rules allow editing', async () => {
  jest.mocked(canChangeDoc).mockReturnValue(false)
  await expect(markIssueDuplicate(duplicate._id, original._id)).rejects.toThrow('edit both issues')
  expect(client.apply).not.toHaveBeenCalled()
})

it('rejects read-only guests and non-single selections', async () => {
  const account: Partial<Account> = { role: AccountRole.ReadOnlyGuest }
  setCurrentAccount(account as Account)
  expect(await canMarkIssueDuplicate(duplicate)).toBe(false)
  expect(await canMarkIssueDuplicate(undefined)).toBe(false)
  expect(await canMarkIssueDuplicate([duplicate, original])).toBe(false)
})

it('does not write when the task type has no allowed canceled status', async () => {
  documents.set('kind', { parent: 'workflow', statuses: ['open'] })
  await expect(markIssueDuplicate(duplicate._id, original._id)).rejects.toThrow('no canceled status')
  expect(client.apply).not.toHaveBeenCalled()
})

it('does not write when the task type belongs to a different project workflow', async () => {
  documents.set('kind', { parent: 'different-workflow', statuses: ['canceled'] })
  await expect(markIssueDuplicate(duplicate._id, original._id)).rejects.toThrow('no canceled status')
  expect(client.apply).not.toHaveBeenCalled()
})

it('does not add existing related links again', async () => {
  documents.set(duplicate._id, { ...duplicate, relations: [{ _id: original._id, _class: original._class }] })
  documents.set(original._id, { ...original, relations: [{ _id: duplicate._id, _class: duplicate._class }] })
  await markIssueDuplicate(duplicate._id, original._id)
  expect(updateIssueRelation).not.toHaveBeenCalled()
  expect(ops.commit).toHaveBeenCalledTimes(1)
})

it('reports a rejected batch instead of claiming success', async () => {
  ops.commit.mockResolvedValue({ result: false })
  await expect(markIssueDuplicate(duplicate._id, original._id)).rejects.toThrow('Refresh and try again')
})

it('rejects self-selection or an issue removed while the picker was open', async () => {
  await expect(markIssueDuplicate(duplicate._id, duplicate._id)).rejects.toThrow('Could not mark')
  documents.delete(original._id)
  await expect(markIssueDuplicate(duplicate._id, original._id)).rejects.toThrow('Could not mark')
  expect(client.apply).not.toHaveBeenCalled()
})

it.each([
  ['open', true],
  ['done', true],
  ['canceled', false]
])('shows the action for an issue in status %s: %s', async (status, visible) => {
  expect(await canShowMarkIssueDuplicate({ ...duplicate, status } as unknown as Issue)).toBe(visible)
})

it('hides the action when the issue cannot be edited', async () => {
  jest.mocked(canEditIssue).mockResolvedValue(false)
  expect(await canShowMarkIssueDuplicate(duplicate)).toBe(false)
})
