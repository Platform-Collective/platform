// SPDX-License-Identifier: EPL-2.0

import {
  discardIssueTimer,
  formatElapsedTime,
  getElapsedTime,
  getReportHours,
  getStoppedTimerHours,
  readIssueTimer,
  saveReportOnce,
  startIssueTimer,
  stopIssueTimer,
  withIssueTimerLock
} from '../issue-timer'
import type { RunningIssueTimer } from '../issue-timer'

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

describe('persisted issue timer', () => {
  const key = 'workspace:user'
  const timer: RunningIssueTimer = {
    issueId: 'issue',
    identifier: 'TEST-1',
    reportId: 'report',
    startedAt: 1000
  }
  let values: Map<string, string>
  let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

  beforeEach(() => {
    values = new Map()
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    }
  })

  it('restores the running timer and prevents replacing it with another issue', () => {
    expect(startIssueTimer(storage, key, timer)).toBe(true)
    expect(readIssueTimer(storage, key)).toEqual(timer)
    expect(startIssueTimer(storage, key, { ...timer, issueId: 'another' })).toBe(false)
    expect(readIssueTimer(storage, key)).toEqual(timer)
    expect(startIssueTimer(storage, 'workspace:other-user', { ...timer, issueId: 'another' })).toBe(true)
  })

  it('discards a timer for an unavailable issue and allows starting another timer', () => {
    startIssueTimer(storage, key, timer)
    discardIssueTimer(storage, key, timer.reportId)
    expect(readIssueTimer(storage, key)).toBeUndefined()
    expect(startIssueTimer(storage, key, { ...timer, issueId: 'another', reportId: 'next-report' })).toBe(true)
  })

  it('does not discard a replacement timer from a stale control', () => {
    const replacement = { ...timer, reportId: 'next-report' }
    startIssueTimer(storage, key, replacement)
    discardIssueTimer(storage, key, timer.reportId)
    expect(readIssueTimer(storage, key)).toEqual(replacement)
  })

  it('can discard a stopped timer whose report was not saved', () => {
    startIssueTimer(storage, key, timer)
    stopIssueTimer(storage, key, timer.reportId, 3601000)
    discardIssueTimer(storage, key, timer.reportId)
    expect(readIssueTimer(storage, key)).toBeUndefined()
    expect(startIssueTimer(storage, key, { ...timer, reportId: 'next-report' })).toBe(true)
  })

  it('refuses to start while a stopped timer still awaits its report', () => {
    startIssueTimer(storage, key, timer)
    stopIssueTimer(storage, key, timer.reportId, 3601000)
    expect(startIssueTimer(storage, key, { ...timer, issueId: 'another', reportId: 'next-report' })).toBe(false)
  })

  it.each(['invalid json', '{}', '{"startedAt":-1}', 'null'])('ignores invalid saved data: %s', (value) => {
    values.set(key, value)
    expect(readIssueTimer(storage, key)).toBeUndefined()
  })

  it('freezes the elapsed duration when stopped and keeps the timer until the report is saved', () => {
    startIssueTimer(storage, key, timer)
    const stopped = stopIssueTimer(storage, key, timer.reportId, 3601000)
    expect(stopped).toEqual({ ...timer, stoppedAt: 3601000 })
    expect(readIssueTimer(storage, key)).toEqual({ ...timer, stoppedAt: 3601000 })
    expect(getStoppedTimerHours(stopped as RunningIssueTimer)).toBe(1)
    discardIssueTimer(storage, key, timer.reportId)
    expect(readIssueTimer(storage, key)).toBeUndefined()
  })

  it('keeps the first stop time when stopping again, e.g. after the report popup was cancelled', () => {
    startIssueTimer(storage, key, timer)
    stopIssueTimer(storage, key, timer.reportId, 3601000)
    expect(stopIssueTimer(storage, key, timer.reportId, 7201000)).toEqual({ ...timer, stoppedAt: 3601000 })
  })

  it('reports long durations unchanged so the user can correct them in the report popup', () => {
    startIssueTimer(storage, key, timer)
    const stopped = stopIssueTimer(storage, key, timer.reportId, timer.startedAt + 13 * 3600000)
    expect(getStoppedTimerHours(stopped as RunningIssueTimer)).toBe(13)
  })

  it('ignores a stop for a timer that another tab saved or replaced', () => {
    expect(stopIssueTimer(storage, key, timer.reportId, 3601000)).toBeUndefined()
    const replacement = { ...timer, reportId: 'next-report' }
    startIssueTimer(storage, key, replacement)
    expect(stopIssueTimer(storage, key, timer.reportId, 3601000)).toBeUndefined()
    expect(readIssueTimer(storage, key)).toEqual(replacement)
  })

  it('stops by the stored report ID even when the stored identifier is stale', () => {
    const movedTimer = { ...timer, identifier: 'OLD-1' }
    startIssueTimer(storage, key, movedTimer)
    expect(stopIssueTimer(storage, key, movedTimer.reportId, 3601000)).toEqual({ ...movedTimer, stoppedAt: 3601000 })
  })

  it('reports zero hours for a zero-duration timer', () => {
    startIssueTimer(storage, key, timer)
    const stopped = stopIssueTimer(storage, key, timer.reportId, timer.startedAt)
    expect(getStoppedTimerHours(stopped as RunningIssueTimer)).toBe(0)
  })

  it('serializes overlapping changes so only one stop wins', async () => {
    startIssueTimer(storage, key, timer)
    let finish: () => void = () => {}
    const results: Array<RunningIssueTimer | undefined> = []
    const first = withIssueTimerLock(key, async () => {
      results.push(stopIssueTimer(storage, key, timer.reportId, 3601000))
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      discardIssueTimer(storage, key, timer.reportId)
    })
    const second = withIssueTimerLock(key, async () => {
      results.push(stopIssueTimer(storage, key, timer.reportId, 7201000))
    })
    await Promise.resolve()
    expect(results).toHaveLength(1)
    finish()
    await Promise.all([first, second])
    expect(results).toEqual([{ ...timer, stoppedAt: 3601000 }, undefined])
    expect(readIssueTimer(storage, key)).toBeUndefined()
  })

  it('releases the lock after a failed action', async () => {
    await expect(
      withIssueTimerLock(key, async () => {
        throw new Error('Offline')
      })
    ).rejects.toThrow('Offline')
    startIssueTimer(storage, key, timer)
    await withIssueTimerLock(key, async () => {
      discardIssueTimer(storage, key, timer.reportId)
    })
    expect(readIssueTimer(storage, key)).toBeUndefined()
  })
})

describe('saving a timer report once', () => {
  // Mocked server: a scoped apply with notMatch checks and inserts atomically, and the trigger adds to the total.
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
    // Both dialogs see no report before either creates it.
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
