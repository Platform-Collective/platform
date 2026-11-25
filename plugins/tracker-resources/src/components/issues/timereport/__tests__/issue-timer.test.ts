// SPDX-License-Identifier: EPL-2.0

import type { Data, DocumentUpdate, TxOperations } from '@hcengineering/core'
import type { IssueTimer } from '@hcengineering/tracker'
import {
  discardIssueTimer,
  formatElapsedTime,
  getElapsedTime,
  getIssueTimerWarnings,
  getReportHours,
  getStoppedTimerHours,
  migrateStoredIssueTimer,
  readStoredIssueTimer,
  saveReportOnce,
  startIssueTimer,
  stopIssueTimer
} from '../issue-timer'

describe('issue timer duration', () => {
  it('uses timestamps so elapsed time survives reloads and suspended tabs', () => {
    expect(getElapsedTime(1000, 3662000)).toBe(3661000)
    expect(getElapsedTime(2000, 1000)).toBe(0)
    expect(getElapsedTime(NaN, 1000)).toBe(0)
  })

  it.each([
    [0, 0],
    [-1000, 0],
    [NaN, 0],
    [Infinity, 0],
    [1, 0.017],
    [60000, 0.017],
    [89999, 0.017],
    [90000, 0.033],
    [3600000, 1],
    [5400000, 1.5]
  ])('rounds %s milliseconds to %s report hours', (elapsed, hours) => {
    expect(getReportHours(elapsed)).toBe(hours)
  })

  it('formats elapsed seconds without wrapping after a day', () => {
    expect(formatElapsedTime(0)).toBe('00:00:00')
    expect(formatElapsedTime(3661999)).toBe('01:01:01')
    expect(formatElapsedTime(90000000)).toBe('25:00:00')
  })
})

describe('issue timer review warnings', () => {
  const start = new Date(2026, 0, 15, 8, 0, 0).getTime()

  it('warns only after ten hours', () => {
    expect(getIssueTimerWarnings(start, start + 10 * 3600000)).toEqual([])
    expect(getIssueTimerWarnings(start, start + 10 * 3600000 + 1)).toEqual(['long'])
  })

  it('warns when the timer crosses local midnight', () => {
    const startedAt = new Date(2026, 0, 15, 23, 30, 0).getTime()
    const stoppedAt = new Date(2026, 0, 16, 0, 15, 0).getTime()
    expect(getIssueTimerWarnings(startedAt, stoppedAt)).toEqual(['pastMidnight'])
  })

  it('reports both warnings for a long timer that crosses midnight', () => {
    const startedAt = new Date(2026, 0, 15, 20, 0, 0).getTime()
    const stoppedAt = new Date(2026, 0, 16, 7, 0, 0).getTime()
    expect(getIssueTimerWarnings(startedAt, stoppedAt)).toEqual(['long', 'pastMidnight'])
  })
})

interface TimerState {
  timer: IssueTimer | undefined
}

interface TimerQuery {
  _id?: string
  reportId?: string
  stoppedAt?: { $exists: boolean }
}

function makeTimer (reportId: string = 'report', issueId: string = 'issue'): IssueTimer {
  const timer: IssueTimer = {
    _id: 'account' as IssueTimer['_id'],
    _class: 'tracker:class:IssueTimer' as IssueTimer['_class'],
    space: 'personal-space' as IssueTimer['space'],
    issueId: issueId as IssueTimer['issueId'],
    identifier: 'TEST-1',
    reportId: reportId as IssueTimer['reportId'],
    startedAt: 1000,
    modifiedOn: 0,
    modifiedBy: 'user' as IssueTimer['modifiedBy']
  }
  return timer
}

function timerData (timer: IssueTimer): Data<IssueTimer> {
  return {
    issueId: timer.issueId,
    identifier: timer.identifier,
    reportId: timer.reportId,
    startedAt: timer.startedAt,
    stoppedAt: timer.stoppedAt
  }
}

function matchesQuery (timer: IssueTimer | undefined, query: TimerQuery): boolean {
  if (timer === undefined) return false
  if (query._id !== undefined && timer._id !== query._id) return false
  if (query.reportId !== undefined && timer.reportId !== query.reportId) return false
  if (query.stoppedAt?.$exists === false && timer.stoppedAt !== undefined) return false
  return true
}

function createClient (state: TimerState): TxOperations {
  const client = {
    findOne: async (_class: string, query: TimerQuery) => (matchesQuery(state.timer, query) ? state.timer : undefined),
    apply: () => {
      const matches: TimerQuery[] = []
      const notMatches: TimerQuery[] = []
      let action: () => void = () => {}
      const ops = {
        match: (_class: string, query: TimerQuery) => {
          matches.push(query)
          return ops
        },
        notMatch: (_class: string, query: TimerQuery) => {
          notMatches.push(query)
          return ops
        },
        createDoc: async (
          _class: IssueTimer['_class'],
          space: IssueTimer['space'],
          data: Data<IssueTimer>,
          id: IssueTimer['_id']
        ) => {
          action = () => {
            const created: IssueTimer = {
              ...data,
              _id: id,
              _class,
              space,
              modifiedOn: 0,
              modifiedBy: 'user' as IssueTimer['modifiedBy']
            }
            state.timer = created
          }
          return id
        },
        update: async (current: IssueTimer, update: DocumentUpdate<IssueTimer>) => {
          action = () => {
            if (state.timer?._id === current._id) {
              state.timer = { ...state.timer, ...(update as Pick<IssueTimer, 'stoppedAt'>) }
            }
          }
        },
        remove: async (current: IssueTimer) => {
          action = () => {
            if (state.timer?._id === current._id) state.timer = undefined
          }
        },
        commit: async () => {
          await Promise.resolve()
          if (!matches.every((query) => matchesQuery(state.timer, query))) return { result: false }
          if (notMatches.some((query) => matchesQuery(state.timer, query))) return { result: false }
          action()
          return { result: true }
        }
      }
      return ops
    }
  }
  return client as unknown as TxOperations
}

async function start (client: TxOperations, timer: IssueTimer): Promise<boolean> {
  return await startIssueTimer(client, timer.space, timer._id, timerData(timer))
}

describe('persisted issue timer', () => {
  let state: TimerState
  let client: TxOperations
  let timer: IssueTimer

  beforeEach(() => {
    state = { timer: undefined }
    client = createClient(state)
    timer = makeTimer()
  })

  it('stores the timer in the personal space and prevents another device replacing it', async () => {
    const otherDevice = createClient(state)
    expect(await start(client, timer)).toBe(true)
    expect(state.timer).toMatchObject({ ...timerData(timer), space: 'personal-space' })
    const otherTimer = makeTimer()
    otherTimer.issueId = 'another' as IssueTimer['issueId']
    expect(await start(otherDevice, otherTimer)).toBe(false)
    expect(state.timer?.issueId).toBe('issue')
  })

  it('freezes and retains the elapsed time until the report is saved', async () => {
    await start(client, timer)
    const stopped = await stopIssueTimer(client, timer._id, timer.reportId, 3601000)
    expect(stopped).toMatchObject({ stoppedAt: 3601000 })
    expect(state.timer?.stoppedAt).toBe(3601000)
    expect(getStoppedTimerHours(stopped as IssueTimer)).toBe(1)
    expect(await discardIssueTimer(client, stopped as IssueTimer)).toBe(true)
    expect(state.timer).toBeUndefined()
  })

  it('keeps the first stop time when another device stops the timer again', async () => {
    await start(client, timer)
    const otherDevice = createClient(state)
    const results = await Promise.all([
      stopIssueTimer(client, timer._id, timer.reportId, 3601000),
      stopIssueTimer(otherDevice, timer._id, timer.reportId, 7201000)
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(state.timer?.stoppedAt).toBe(3601000)
    expect(await stopIssueTimer(otherDevice, timer._id, timer.reportId, 7201000)).toMatchObject({
      stoppedAt: 3601000
    })
  })

  it('ignores a stop for a timer that was saved or replaced', async () => {
    expect(await stopIssueTimer(client, timer._id, timer.reportId, 3601000)).toBeUndefined()
    await start(client, makeTimer('next-report'))
    expect(await stopIssueTimer(client, timer._id, timer.reportId, 3601000)).toBeUndefined()
    expect(state.timer?.reportId).toBe('next-report')
  })

  it('does not discard a replacement timer from a stale control', async () => {
    state.timer = makeTimer('next-report')
    expect(await discardIssueTimer(client, timer)).toBe(false)
    expect(state.timer?.reportId).toBe('next-report')
  })

  it('reports zero hours for a zero-duration timer', async () => {
    await start(client, timer)
    const stopped = await stopIssueTimer(client, timer._id, timer.reportId, timer.startedAt)
    expect(getStoppedTimerHours(stopped as IssueTimer)).toBe(0)
  })
})

describe('legacy browser timer migration', () => {
  interface MemoryStorage {
    getItem: (key: string) => string | null
    removeItem: (key: string) => void
    has: (key: string) => boolean
  }

  function createStorage (value: string): MemoryStorage {
    const values = new Map([['legacy', value]])
    return {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => {
        values.delete(key)
      },
      has: (key) => values.has(key)
    }
  }

  it('moves a locally running timer into the personal timer document', async () => {
    const state: TimerState = { timer: undefined }
    const stored = makeTimer()
    const storage = createStorage(JSON.stringify(timerData(stored)))

    await migrateStoredIssueTimer(createClient(state), storage, 'legacy', stored.space, stored._id)

    expect(state.timer).toMatchObject({ ...timerData(stored), space: stored.space })
    expect(state.timer?.stoppedAt).toBeUndefined()
    expect(storage.has('legacy')).toBe(false)
  })

  it('retains the stopped time of a locally stopped timer', async () => {
    const state: TimerState = { timer: undefined }
    const stored = makeTimer()
    stored.stoppedAt = 3601000
    const storage = createStorage(JSON.stringify(timerData(stored)))

    await migrateStoredIssueTimer(createClient(state), storage, 'legacy', stored.space, stored._id)

    expect(state.timer?.stoppedAt).toBe(3601000)
    expect(storage.has('legacy')).toBe(false)
  })

  it('keeps the synchronized timer when another device already migrated one', async () => {
    const state: TimerState = { timer: makeTimer('remote-report') }
    const stored = makeTimer('legacy-report')
    const storage = createStorage(JSON.stringify(timerData(stored)))

    await migrateStoredIssueTimer(createClient(state), storage, 'legacy', stored.space, stored._id)

    expect(state.timer?.reportId).toBe('remote-report')
    expect(storage.has('legacy')).toBe(false)
  })

  it('ignores malformed legacy data', () => {
    expect(readStoredIssueTimer(createStorage('{broken'), 'legacy')).toBeUndefined()
    expect(readStoredIssueTimer(createStorage('{"issueId":"issue"}'), 'legacy')).toBeUndefined()
  })
})

describe('saving a timer report once', () => {
  let reports: Set<string>
  let reportedTime: number
  let create: jest.Mock

  function exists (id: string): () => Promise<boolean> {
    return async () => reports.has(id)
  }

  function save (id: string): () => Promise<boolean> {
    return async () => await create(id)
  }

  beforeEach(() => {
    reports = new Set()
    reportedTime = 0
    create = jest.fn(async (id: string) => {
      if (reports.has(id)) return false
      reports.add(id)
      reportedTime += 1
      return true
    })
  })

  it('treats a second dialog submitting the same report afterwards as already saved', async () => {
    await expect(saveReportOnce(exists('report'), save('report'))).resolves.toBe('created')
    await expect(saveReportOnce(exists('report'), save('report'))).resolves.toBe('exists')
    expect(create).toHaveBeenCalledTimes(1)
    expect(reports.size).toBe(1)
    expect(reportedTime).toBe(1)
  })

  it('adds the time once when two dialogs submit concurrently', async () => {
    let releaseChecks: () => void = () => {}
    const checksDone = new Promise<void>((resolve) => {
      releaseChecks = resolve
    })
    let checks = 0
    const racingExists = async (): Promise<boolean> => {
      const found = reports.has('report')
      if (++checks === 2) releaseChecks()
      if (checks <= 2) await checksDone
      return found
    }
    const results = await Promise.all([
      saveReportOnce(racingExists, save('report')),
      saveReportOnce(racingExists, save('report'))
    ])
    expect(results.sort()).toEqual(['created', 'exists'])
    expect(create).toHaveBeenCalledTimes(2)
    expect(reports.size).toBe(1)
    expect(reportedTime).toBe(1)
  })

  it('rejects a failed save so the dialog stays open, and a retry adds the time once', async () => {
    create.mockRejectedValueOnce(new Error('Offline'))
    await expect(saveReportOnce(exists('report'), save('report'))).rejects.toThrow('Offline')
    expect(reports.size).toBe(0)
    await expect(saveReportOnce(exists('report'), save('report'))).resolves.toBe('created')
    expect(reports.size).toBe(1)
    expect(reportedTime).toBe(1)
  })

  it('treats a lost response after a successful save as saved', async () => {
    create.mockImplementationOnce(async (id: string) => {
      reports.add(id)
      reportedTime += 1
      throw new Error('Connection closed')
    })
    await expect(saveReportOnce(exists('report'), save('report'))).resolves.toBe('exists')
    expect(reportedTime).toBe(1)
  })

  it('keeps the original error when the existence check after a failure also fails', async () => {
    let calls = 0
    const flakyExists = async (): Promise<boolean> => {
      if (++calls > 1) throw new Error('Still offline')
      return false
    }
    create.mockRejectedValueOnce(new Error('Offline'))
    await expect(saveReportOnce(flakyExists, save('report'))).rejects.toThrow('Offline')
  })
})
