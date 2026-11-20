// SPDX-License-Identifier: EPL-2.0

import { createTimeSpendReportOnce } from '../create-time-spend-report'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleEvent: jest.fn() } }))
jest.mock('@hcengineering/tracker', () => ({ TrackerEvents: { IssueTimeSpentAdded: 'IssueTimeSpentAdded' } }))
jest.mock('../../../../plugin', () => ({
  __esModule: true,
  default: { class: { TimeSpendReport: 'tracker:class:TimeSpendReport' } }
}))

interface FakeServer {
  reports: Set<string>
  reportedTime: number
  scopes: string[]
}

/** Mock client whose apply honours notMatch atomically per commit, and whose trigger adds the reported hours. */
function createClient (server: FakeServer): any {
  return {
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
          if (notMatches.some((q) => server.reports.has(q._id))) return { result: false }
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
}

describe('conditional time report creation', () => {
  const issue = { _id: 'issue', _class: 'tracker:class:Issue', space: 'project', identifier: 'TEST-1' } as any
  const data = { employee: null, date: 0, value: 2, description: '' } as any
  let server: FakeServer

  beforeEach(() => {
    server = { reports: new Set(), reportedTime: 0, scopes: [] }
  })

  it('creates the report once when two dialogs submit concurrently and adds the time once', async () => {
    const client = createClient(server)
    const results = await Promise.all([
      createTimeSpendReportOnce(client, issue, data, 'report' as any),
      createTimeSpendReportOnce(client, issue, data, 'report' as any)
    ])
    expect(results.sort()).toEqual([false, true])
    expect(server.reports.size).toBe(1)
    expect(server.reportedTime).toBe(2)
    expect(server.scopes).toEqual(['tracker:time-report:report', 'tracker:time-report:report'])
  })

  it('reports an existing report as not created on a later submission', async () => {
    const client = createClient(server)
    await expect(createTimeSpendReportOnce(client, issue, data, 'report' as any)).resolves.toBe(true)
    await expect(createTimeSpendReportOnce(client, issue, data, 'report' as any)).resolves.toBe(false)
    expect(server.reportedTime).toBe(2)
  })
})
