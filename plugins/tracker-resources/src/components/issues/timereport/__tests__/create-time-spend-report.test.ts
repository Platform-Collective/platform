// SPDX-License-Identifier: EPL-2.0

import core, { Hierarchy, TxOperations } from '@hcengineering/core'
import type { AttachedData, Client, Ref, Space } from '@hcengineering/core'
import type { Issue, TimeSpendReport } from '@hcengineering/tracker'
import tracker from '../../../../plugin'
import {
  createTimeSpendReportOnce,
  saveTimeSpendReport,
  type SaveTimeSpendReportOptions
} from '../create-time-spend-report'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn(), handleEvent: jest.fn() } }))

interface FakeServer {
  reports: Set<string>
  reportedTime: number
  scopes: string[]
}

function createClient (server: FakeServer): TxOperations {
  const client = {
    findOne: async (_class: string, query: { _id: string }) =>
      server.reports.has(query._id) ? { _id: query._id } : undefined,
    apply: (scope: string) => {
      server.scopes.push(scope)
      const notMatches: Array<{ _id: string }> = []
      const pending: Array<{ id: string, value: number }> = []
      const ops = {
        notMatch: (_class: string, query: { _id: string }) => {
          notMatches.push(query)
          return ops
        },
        addCollection: async (
          _class: string,
          space: string,
          attachedTo: string,
          attachedToClass: string,
          collection: string,
          data: { value: number },
          id: string
        ) => {
          pending.push({ id, value: data.value })
          return id
        },
        commit: async () => {
          await Promise.resolve()
          if (notMatches.some((query) => server.reports.has(query._id))) return { result: false }
          for (const { id, value } of pending) {
            server.reports.add(id)
            server.reportedTime += value
          }
          return { result: true }
        }
      }
      return ops
    }
  }
  return client as unknown as TxOperations
}

const issue: NonNullable<SaveTimeSpendReportOptions['target']> = {
  _id: 'issue' as Ref<Issue>,
  _class: tracker.class.Issue,
  space: 'project' as Ref<Space>,
  identifier: 'TEST-1'
}
const data: AttachedData<TimeSpendReport> = { employee: null, date: 0, value: 2, description: '' }

describe('conditional time report creation', () => {
  let server: FakeServer

  beforeEach(() => {
    server = { reports: new Set(), reportedTime: 0, scopes: [] }
  })

  it('creates the report once when two dialogs submit concurrently and adds the time once', async () => {
    const client = createClient(server)
    const reportId = 'report' as Ref<TimeSpendReport>
    const results = await Promise.all([
      createTimeSpendReportOnce(client, issue, data, reportId),
      createTimeSpendReportOnce(client, issue, data, reportId)
    ])
    expect(results.sort()).toEqual([false, true])
    expect(server.reports.size).toBe(1)
    expect(server.reportedTime).toBe(2)
    expect(server.scopes).toEqual(['tracker:time-report:report', 'tracker:time-report:report'])
  })

  it('reports an existing report as not created on a later submission', async () => {
    const client = createClient(server)
    const reportId = 'report' as Ref<TimeSpendReport>
    await expect(createTimeSpendReportOnce(client, issue, data, reportId)).resolves.toBe(true)
    await expect(createTimeSpendReportOnce(client, issue, data, reportId)).resolves.toBe(false)
    expect(server.reportedTime).toBe(2)
  })
})

describe('time report write failures', () => {
  const offline = new Error('Offline')
  const tx = jest.fn(async () => {
    throw offline
  })
  const findOne = jest.fn(async () => undefined)
  const hierarchy = new Hierarchy()
  const transport: Partial<Client> = { tx, findOne, getHierarchy: () => hierarchy }
  const client = new TxOperations(transport as Client, core.account.System)
  const onAlreadySaved = jest.fn(async () => {})
  const onSaveFailed = jest.fn(async () => {})
  const options = { target: issue, data, onAlreadySaved, onSaveFailed }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('handles a manual create failure without repeating the write', async () => {
    await saveTimeSpendReport(client, options)

    expect(onSaveFailed).toHaveBeenCalledTimes(1)
    expect(tx).toHaveBeenCalledTimes(1)
  })

  it('handles a manual edit failure without repeating the write', async () => {
    const value: TimeSpendReport = {
      ...data,
      _id: 'report' as Ref<TimeSpendReport>,
      _class: tracker.class.TimeSpendReport,
      space: issue.space,
      attachedTo: issue._id,
      attachedToClass: issue._class,
      collection: 'reports',
      modifiedOn: 0,
      modifiedBy: core.account.System,
      value: 1
    }
    await saveTimeSpendReport(client, { ...options, value })

    expect(onSaveFailed).toHaveBeenCalledTimes(1)
    expect(tx).toHaveBeenCalledTimes(1)
  })

  it('propagates a failed timer write to the dialog without repeating it', async () => {
    await expect(saveTimeSpendReport(client, { ...options, reportId: 'report' as Ref<TimeSpendReport> })).rejects.toBe(
      offline
    )

    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(tx).toHaveBeenCalledTimes(1)
  })

  it('does not treat an unconfirmed timer write as an existing report', async () => {
    const reportId = 'report' as Ref<TimeSpendReport>
    const commit = jest.fn(async () => ({}))
    const transport: Partial<Client> = { tx: commit, findOne }
    const client = new TxOperations(transport as Client, core.account.System)

    await expect(saveTimeSpendReport(client, { ...options, reportId })).rejects.toThrow(
      'The timer transaction could not be confirmed'
    )

    expect(commit).toHaveBeenCalledTimes(1)
    expect(onAlreadySaved).not.toHaveBeenCalled()
  })
})
