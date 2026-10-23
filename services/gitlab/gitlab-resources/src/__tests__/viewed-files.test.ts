// SPDX-License-Identifier: EPL-2.0
import { createSerialQueue, saveViewedFile, toggleViewed } from '../viewed-files'

describe('toggleViewed', () => {
  it('ticks a file version once, and unticks only that version', () => {
    const ticked = toggleViewed(toggleViewed([], 'a.ts', 's1', true), 'a.ts', 's1', true)
    expect(ticked).toEqual([{ fileName: 'a.ts', sha: 's1' }])
    const both = toggleViewed(ticked, 'a.ts', 's2', true)
    expect(toggleViewed(both, 'a.ts', 's1', false)).toEqual([{ fileName: 'a.ts', sha: 's2' }])
  })
})

describe('createSerialQueue', () => {
  it('starts a task only after the previous one finished', async () => {
    const serial = createSerialQueue()
    const events: string[] = []
    let releaseFirst: () => void = () => {}
    let firstStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const first = serial(async () => {
      events.push('first start')
      firstStarted()
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      events.push('first end')
    })
    const second = serial(async () => {
      events.push('second start')
    })
    await started
    // A macrotask runs every pending microtask: a broken queue would have started the second task by now
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['first start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first start', 'first end', 'second start'])
  })

  it('runs the next task after a failed one, and rejects only the failed call', async () => {
    const serial = createSerialQueue()
    const failed = serial(async () => {
      throw new Error('refused')
    })
    const next = jest.fn(async () => {})
    await expect(failed).rejects.toThrow('refused')
    await serial(next)
    expect(next).toHaveBeenCalledTimes(1)
  })
})

describe('saveViewedFile', () => {
  const mergeRequestFields = { _id: 'mr1', _class: 'gitlab:class:GitlabMergeRequest', space: 's1' }
  const mergeRequest = mergeRequestFields as never
  const author = 'person1' as never

  it("creates this user's review doc on the first tick", async () => {
    const client = {
      findOne: jest.fn(async () => undefined),
      update: jest.fn(),
      addCollection: jest.fn(async () => 'id')
    }
    await saveViewedFile(client as never, mergeRequest, author, { fileName: 'a.ts', sha: 's1', viewed: true })
    expect(client.addCollection).toHaveBeenCalledWith(
      expect.anything(),
      's1',
      'mr1',
      'gitlab:class:GitlabMergeRequest',
      'viewedFiles',
      { author: 'person1', files: [{ fileName: 'a.ts', sha: 's1' }] }
    )
    expect(client.update).not.toHaveBeenCalled()
  })

  it('updates the existing doc', async () => {
    const current = { files: [{ fileName: 'a.ts', sha: 's1' }] }
    const client = { findOne: jest.fn(async () => current), update: jest.fn(async () => {}), addCollection: jest.fn() }
    await saveViewedFile(client as never, mergeRequest, author, { fileName: 'a.ts', sha: 's1', viewed: false })
    expect(client.update).toHaveBeenCalledWith(current, { files: [] })
    expect(client.addCollection).not.toHaveBeenCalled()
  })
})
