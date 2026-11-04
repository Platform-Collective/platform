// SPDX-License-Identifier: EPL-2.0

import core from '@hcengineering/core'
import type { AttachedData, Ref, Status, TxOperations } from '@hcengineering/core'
import { createMarkup } from '@hcengineering/presentation'
import tags from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'
import type { Issue, IssueDraft, IssueParentInfo, Project } from '@hcengineering/tracker'
import { saveSubIssues } from '../save-sub-issues'

jest.mock('@hcengineering/presentation', () => ({ createMarkup: jest.fn() }), { virtual: true })
jest.mock('@hcengineering/tracker', () => ({
  __esModule: true,
  default: { class: { Project: 'tracker:class:Project', Issue: 'tracker:class:Issue' } }
}))
jest.mock('@hcengineering/tags', () => ({
  __esModule: true,
  default: { class: { TagReference: 'tags:class:TagReference' } }
}))
jest.mock('@hcengineering/text', () => ({ isEmptyMarkup: (markup: string) => markup === '' }))

const project = {
  _id: 'project',
  identifier: 'TEST',
  defaultIssueStatus: 'default-status',
  sequence: 0
} as unknown as Project
const parentId = 'parent' as Ref<Issue>
const parents: IssueParentInfo[] = [{ parentId, parentTitle: 'Parent', space: project._id, identifier: 'TEST-100' }]
const upload = jest.mocked(createMarkup)

function drafts (count: number): IssueDraft[] {
  return Array.from({ length: count }, (_, index) => ({
    _id: `child-${index}` as Ref<Issue>,
    title: ` Child ${index} `,
    description: `description-${index}`,
    status: index === 0 ? ('custom-status' as IssueDraft['status']) : undefined,
    priority: 0,
    assignee: null,
    component: null,
    milestone: null,
    space: project._id,
    startDate: 123,
    dueDate: null,
    estimation: 2,
    kind: 'kind' as IssueDraft['kind'],
    labels: [{ title: 'Label', color: 1, tag: 'tag' } as unknown as IssueDraft['labels'][number]],
    subIssues: []
  }))
}

interface MockClientResult {
  client: {
    updateDoc: jest.Mock
    apply: jest.Mock
    addCollection: jest.Mock
  }
  operations: {
    addCollection: jest.Mock
    commit: jest.Mock
  }
  txClient: TxOperations
}

function mockClient (): MockClientResult {
  let sequence = 100
  const operations = {
    addCollection: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue({ result: true })
  }
  const client = {
    updateDoc: jest.fn(async (_class, _space, _id, update: { $inc: { sequence: number } }) => {
      sequence += update.$inc.sequence
      return { object: { sequence } }
    }),
    apply: jest.fn(() => operations),
    addCollection: jest.fn().mockResolvedValue(undefined)
  }
  return { client, operations, txClient: client as unknown as TxOperations }
}

beforeEach(() => {
  upload.mockReset()
  upload.mockImplementation(async (_doc, markup) => `blob-${markup}` as Awaited<ReturnType<typeof createMarkup>>)
})

it('does no work for an empty template', async () => {
  const { client, txClient } = mockClient()
  await saveSubIssues(txClient, project, [], parents, parentId)
  expect(client.updateDoc).not.toHaveBeenCalled()
  expect(client.apply).not.toHaveBeenCalled()
  expect(upload).not.toHaveBeenCalled()
})

it('reserves 29 numbers once and commits children and labels in draft order', async () => {
  const { client, operations, txClient } = mockClient()
  const children = drafts(29)
  await saveSubIssues(txClient, project, children, parents, parentId)

  expect(client.updateDoc).toHaveBeenCalledTimes(1)
  expect(client.updateDoc).toHaveBeenCalledWith(
    tracker.class.Project,
    core.space.Space,
    project._id,
    { $inc: { sequence: 29 } },
    true
  )
  expect(client.addCollection).not.toHaveBeenCalled()
  expect(client.apply).toHaveBeenCalledTimes(1)
  expect(operations.commit).toHaveBeenCalledTimes(1)
  expect(operations.addCollection).toHaveBeenCalledTimes(58)
  children.forEach((child, index) => {
    expect(operations.addCollection.mock.calls[index * 2]).toEqual([
      tracker.class.Issue,
      project._id,
      parentId,
      tracker.class.Issue,
      'subIssues',
      expect.objectContaining({
        title: `Child ${index}`,
        number: 101 + index,
        identifier: `TEST-${101 + index}`,
        description: `blob-description-${index}`,
        status: index === 0 ? 'custom-status' : 'default-status',
        parents,
        assignee: child.assignee,
        component: child.component,
        milestone: child.milestone,
        priority: child.priority,
        kind: child.kind,
        startDate: child.startDate,
        estimation: child.estimation
      }),
      child._id
    ])
    expect(operations.addCollection.mock.calls[index * 2 + 1]).toEqual([
      tags.class.TagReference,
      project._id,
      child._id,
      tracker.class.Issue,
      'labels',
      child.labels[0]
    ])
    expect(upload.mock.calls[index][0]).toMatchObject({ objectId: child._id, objectAttr: 'description' })
  })
})

it('bounds concurrent uploads and preserves numbering when uploads finish out of order', async () => {
  jest.useFakeTimers()
  try {
    let active = 0
    let peak = 0
    upload.mockImplementation(async (_doc, markup) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, markup === 'description-0' ? 50 : 10))
      active--
      return `blob-${markup}` as Awaited<ReturnType<typeof createMarkup>>
    })
    const { operations, txClient } = mockClient()
    const saving = saveSubIssues(txClient, project, drafts(29), parents, parentId)
    await jest.runAllTimersAsync()
    await saving
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(4)
    const issues = operations.addCollection.mock.calls.filter((call) => call[4] === 'subIssues')
    expect(issues.map((call) => (call[5] as AttachedData<Issue>).number)).toEqual(
      Array.from({ length: 29 }, (_, index) => 101 + index)
    )
    expect(issues[0][5].description).toBe('blob-description-0')
  } finally {
    jest.useRealTimers()
  }
})

it('reserves disjoint ranges for concurrent saves without using the cached project sequence', async () => {
  const { client, operations, txClient } = mockClient()
  await Promise.all([
    saveSubIssues(txClient, project, drafts(29), parents, parentId),
    saveSubIssues(txClient, project, drafts(29), parents, parentId)
  ])
  const numbers = operations.addCollection.mock.calls
    .filter((call) => call[4] === 'subIssues')
    .map((call) => (call[5] as AttachedData<Issue>).number)
  expect(client.updateDoc).toHaveBeenCalledTimes(2)
  expect(new Set(numbers).size).toBe(58)
  expect(numbers.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 58 }, (_, index) => 101 + index))
})

it('skips empty descriptions and labels and retains the task type status fallback', async () => {
  const { operations, txClient } = mockClient()
  const children = drafts(1)
  children[0].description = ''
  children[0].labels = []
  children[0].status = undefined
  await saveSubIssues(txClient, { ...project, defaultIssueStatus: undefined }, children, parents, parentId, [
    { _id: 'fallback-status' } as unknown as Status
  ])
  expect(upload).not.toHaveBeenCalled()
  expect(operations.addCollection).toHaveBeenCalledTimes(1)
  expect(operations.addCollection.mock.calls[0][5]).toMatchObject({ description: null, status: 'fallback-status' })
})

it('propagates upload failures without committing partial children', async () => {
  const { client, operations, txClient } = mockClient()
  upload
    .mockResolvedValueOnce('first-blob' as Awaited<ReturnType<typeof createMarkup>>)
    .mockRejectedValueOnce(new Error('Upload failed'))
  await expect(saveSubIssues(txClient, project, drafts(29), parents, parentId)).rejects.toThrow('Upload failed')
  expect(client.addCollection).not.toHaveBeenCalled()
  expect(operations.commit).not.toHaveBeenCalled()
  expect(operations.addCollection).not.toHaveBeenCalled()
})

it('propagates a rejected batch commit', async () => {
  const { operations, txClient } = mockClient()
  operations.commit.mockResolvedValue({ result: false })
  await expect(saveSubIssues(txClient, project, drafts(1), parents, parentId)).rejects.toThrow()
})

it('propagates sequence reservation failures before uploads or child writes', async () => {
  const { client, operations, txClient } = mockClient()
  client.updateDoc.mockRejectedValue(new Error('Reservation failed'))
  await expect(saveSubIssues(txClient, project, drafts(29), parents, parentId)).rejects.toThrow('Reservation failed')
  expect(upload).not.toHaveBeenCalled()
  expect(operations.addCollection).not.toHaveBeenCalled()
})

it('saves 29 described and labelled children within eight upload waves and two database round trips', async () => {
  jest.useFakeTimers()
  try {
    const { client, operations, txClient } = mockClient()
    const delay = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const reserve = client.updateDoc.getMockImplementation()!
    client.updateDoc.mockImplementation(async (...args) => {
      await delay()
      return await reserve(...args)
    })
    client.addCollection.mockImplementation(delay)
    operations.commit.mockImplementation(async () => {
      await delay()
      return { result: true }
    })
    upload.mockImplementation(async (_doc, markup) => {
      await delay()
      return `blob-${markup}` as Awaited<ReturnType<typeof createMarkup>>
    })
    const start = Date.now()
    const saving = saveSubIssues(txClient, project, drafts(29), parents, parentId)
    await jest.runAllTimersAsync()
    await saving
    expect(Date.now() - start).toBeLessThanOrEqual(100)
  } finally {
    jest.useRealTimers()
  }
})
