// SPDX-License-Identifier: EPL-2.0

import type { AttachedData, Ref, Space, TxOperations } from '@hcengineering/core'
import { executeCardAction } from '@hcengineering/presentation/src/card-error'
import { setPlatformStatus } from '@hcengineering/platform'
import type { Issue, TimeSpendReport } from '@hcengineering/tracker'
import tracker from '../../../../plugin'
import {
  createTimeSpendReportOnce,
  saveTimeSpendReport,
  type SaveTimeSpendReportOptions
} from '../create-time-spend-report'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn(), handleEvent: jest.fn() } }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  setPlatformStatus: jest.fn()
}))

interface FakeServer {
  reports: Set<string>
  reportedTime: number
  scopes: string[]
  failNextWrite: boolean
}

function createClient (server: FakeServer): TxOperations {
  const client = {
    findOne: async (_class: string, query: { _id: string }) =>
      server.reports.has(query._id) ? { _id: query._id } : undefined,
    addCollection: async (
      _class: string,
      space: string,
      attachedTo: string,
      attachedToClass: string,
      collection: string,
      data: { value: number },
      id?: string
    ) => {
      if (server.failNextWrite) {
        server.failNextWrite = false
        throw new Error('Offline')
      }
      const reportId = id ?? 'manual-report'
      server.reports.add(reportId)
      server.reportedTime += data.value
      return reportId
    },
    update: async () => {
      if (server.failNextWrite) {
        server.failNextWrite = false
        throw new Error('Offline')
      }
      return {}
    },
    apply: (scope: string) => {
      server.scopes.push(scope)
      const notMatches: Array<{ _id: string }> = []
      const pending: Array<{ id: string; value: number }> = []
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
          if (server.failNextWrite) {
            server.failNextWrite = false
            throw new Error('Offline')
          }
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

async function flushAction (): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('conditional time report creation', () => {
  let server: FakeServer

  beforeEach(() => {
    server = { reports: new Set(), reportedTime: 0, scopes: [], failNextWrite: false }
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

describe('time report dialog action failures', () => {
  let server: FakeServer
  let onAlreadySaved: jest.Mock
  let onSaveFailed: jest.Mock
  let onProcessing: jest.Mock
  let onClose: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    server = { reports: new Set(), reportedTime: 0, scopes: [], failNextWrite: true }
    onAlreadySaved = jest.fn(async () => {})
    onSaveFailed = jest.fn(async () => {})
    onProcessing = jest.fn()
    onClose = jest.fn()
  })

  async function runDialogAction (options: Partial<SaveTimeSpendReportOptions>, retryOnError: boolean): Promise<void> {
    const client = createClient(server)
    executeCardAction(
      async () => {
        await saveTimeSpendReport(client, {
          target: issue,
          data,
          onAlreadySaved: async () => {
            onAlreadySaved()
          },
          onSaveFailed: async () => {
            onSaveFailed()
          },
          ...options
        })
      },
      retryOnError,
      { onProcessing, onClose }
    )
    await flushAction()
  }

  it('shows a manual create failure and closes without repeating the write', async () => {
    await runDialogAction({}, false)

    expect(onSaveFailed).toHaveBeenCalledTimes(1)
    expect(onProcessing.mock.calls).toEqual([[true], [false]])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(setPlatformStatus).not.toHaveBeenCalled()
    expect(server.reportedTime).toBe(0)
  })

  it('shows a manual edit failure and closes without repeating the write', async () => {
    const value: TimeSpendReport = {
      ...data,
      _id: 'report' as Ref<TimeSpendReport>,
      _class: tracker.class.TimeSpendReport,
      space: issue.space,
      attachedTo: issue._id,
      attachedToClass: issue._class,
      collection: 'reports',
      modifiedOn: 0,
      modifiedBy: 'user' as TimeSpendReport['modifiedBy'],
      value: 1
    }
    await runDialogAction({ value }, false)

    expect(onSaveFailed).toHaveBeenCalledTimes(1)
    expect(onProcessing.mock.calls).toEqual([[true], [false]])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(setPlatformStatus).not.toHaveBeenCalled()
  })

  it('keeps a failed timer report open for a safe manual retry', async () => {
    await runDialogAction({ reportId: 'report' as Ref<TimeSpendReport> }, true)

    expect(onSaveFailed).not.toHaveBeenCalled()
    expect(onProcessing.mock.calls).toEqual([[true], [false]])
    expect(onClose).not.toHaveBeenCalled()
    expect(setPlatformStatus).toHaveBeenCalledTimes(1)
    expect(server.scopes).toEqual(['tracker:time-report:report'])
    expect(server.reportedTime).toBe(0)
  })
})
