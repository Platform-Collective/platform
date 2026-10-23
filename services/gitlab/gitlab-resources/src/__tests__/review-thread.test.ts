// SPDX-License-Identifier: EPL-2.0
import { type Blob, type PersonId, type Ref } from '@hcengineering/core'
import { type DiffFile } from '@hcengineering/diffview'
import { parseDiff } from '@hcengineering/diffview-resources'
import { createHunkLoader, resolveChange, threadLocation } from '../review-thread'

const PATCH = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-x', '+y'].join('\n')
const FILE = 'blob' as Ref<Blob>
const request = { file: FILE, path: 'a.ts', line: 1, oldLine: null, outdated: false }

function deferred (): {
  promise: Promise<DiffFile[]>
  resolve: (files: DiffFile[]) => void
  reject: (err: Error) => void
} {
  let release: (files: DiffFile[]) => void = () => {}
  let fail: (err: Error) => void = () => {}
  const promise = new Promise<DiffFile[]>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { promise, resolve: release, reject: fail }
}

describe('threadLocation', () => {
  it('names the new line, else the old line, else the file', () => {
    expect(threadLocation({ path: 'a.ts', oldPath: 'o.ts', line: 3, oldLine: 2 })).toBe('a.ts:3')
    expect(threadLocation({ path: 'a.ts', oldPath: 'o.ts', line: null, oldLine: 2 })).toBe('o.ts:2')
    expect(threadLocation({ path: 'a.ts', oldPath: 'o.ts', line: null, oldLine: null })).toBe('a.ts')
  })
})

describe('resolveChange', () => {
  it('reopens a resolved thread and resolves an open one by the given person', () => {
    expect(resolveChange(true, 'me' as PersonId)).toEqual({ isResolved: false, resolvedBy: null })
    expect(resolveChange(false, 'me' as PersonId)).toEqual({ isResolved: true, resolvedBy: 'me' })
  })
})

describe('createHunkLoader', () => {
  it('cuts the hunk for the newest request', async () => {
    const load = createHunkLoader(async () => parseDiff(PATCH))
    expect(await load(request)).toBe(['@@ -1 +1 @@', '-x', '+y'].join('\n'))
  })

  it('shows nothing for an outdated thread or a missing diff', async () => {
    const load = createHunkLoader(async () => parseDiff(PATCH))
    expect(await load({ ...request, outdated: true })).toBe('')
    expect(await load({ ...request, file: undefined })).toBe('')
  })

  it('drops a slower answer once the thread turned outdated (same diff)', async () => {
    const files = deferred()
    const load = createHunkLoader(async () => await files.promise)
    const first = load(request)
    expect(await load({ ...request, outdated: true })).toBe('')
    files.resolve(parseDiff(PATCH))
    expect(await first).toBeUndefined()
  })

  it('drops a slower failure, so it cannot clear a newer hunk', async () => {
    const failing = deferred()
    let calls = 0
    const load = createHunkLoader(async () => (++calls === 1 ? await failing.promise : parseDiff(PATCH)))
    const first = load(request)
    expect(await load({ ...request, line: 1 })).not.toBe('')
    failing.reject(new Error('HTTP 500'))
    expect(await first).toBeUndefined()
  })

  it('shows nothing when the newest request fails', async () => {
    const load = createHunkLoader(async () => {
      throw new Error('HTTP 500')
    })
    expect(await load(request)).toBe('')
  })
})
