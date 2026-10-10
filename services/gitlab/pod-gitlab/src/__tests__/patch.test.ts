// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import { GitlabApiError } from '../gitlab/api'
import type { GitlabMergeRequestDiff } from '../gitlab/types'
import { assembleUnifiedDiff, fetchMergeRequestPatch, PatchReader } from '../sync/patch'

function file (overrides: Partial<GitlabMergeRequestDiff>): GitlabMergeRequestDiff {
  return {
    old_path: 'src/a.ts',
    new_path: 'src/a.ts',
    a_mode: '100644',
    b_mode: '100644',
    diff: '@@ -1 +1 @@\n-a\n+b\n',
    new_file: false,
    renamed_file: false,
    deleted_file: false,
    ...overrides
  }
}

function summarize (patch: string): ReturnType<PatchReader['finish']> {
  const reader = new PatchReader()
  reader.push(patch)
  return reader.finish()
}

describe('assembleUnifiedDiff', () => {
  it('writes git headers for modified, new, deleted and renamed files', () => {
    const patch = assembleUnifiedDiff([
      file({}),
      file({ old_path: 'n.ts', new_path: 'n.ts', new_file: true, a_mode: '0', diff: '@@ -0,0 +1 @@\n+x\n' }),
      file({ old_path: 'd.ts', new_path: 'd.ts', deleted_file: true, b_mode: '0', diff: '@@ -1 +0,0 @@\n-x\n' }),
      file({ old_path: 'old.ts', new_path: 'new.ts', renamed_file: true, diff: '' })
    ])
    // Checksum lines are covered by the next test
    expect(
      patch
        .split('\n')
        .filter((it) => !it.startsWith('index '))
        .join('\n')
    ).toBe(
      [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        'diff --git a/n.ts b/n.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/n.ts',
        '@@ -0,0 +1 @@',
        '+x',
        'diff --git a/d.ts b/d.ts',
        'deleted file mode 100644',
        '--- a/d.ts',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-x',
        'diff --git a/old.ts b/new.ts',
        'rename from old.ts',
        'rename to new.ts',
        ''
      ].join('\n')
    )
    expect(summarize(patch).files).toBe(4)
  })

  it('gives each file version its own checksum, so viewed marks reset when a file changes', () => {
    const checksum = (patch: string): string | undefined => /^index [0-9a-f]+\.\.([0-9a-f]+)$/m.exec(patch)?.[1]
    const first = checksum(assembleUnifiedDiff([file({})]))
    expect(first).toEqual(expect.stringMatching(/^[0-9a-f]{7,}$/))
    expect(checksum(assembleUnifiedDiff([file({})]))).toBe(first)
    expect(checksum(assembleUnifiedDiff([file({ diff: '@@ -1 +1 @@\n-a\n+c\n' })]))).not.toBe(first)
  })

  it('records a mode change', () => {
    expect(assembleUnifiedDiff([file({ b_mode: '100755', diff: '' })])).toBe(
      'diff --git a/src/a.ts b/src/a.ts\nold mode 100644\nnew mode 100755\n'
    )
  })
})

describe('PatchReader', () => {
  it('counts files and added and removed lines inside hunks only', () => {
    const patch = assembleUnifiedDiff([
      file({}),
      // A removed line whose text starts with '-- ' reads '--- x' inside the hunk; it is one removed line
      file({ old_path: 'b.ts', new_path: 'b.ts', diff: '@@ -1,2 +1 @@\n--- x\n-y\n+z\n context\n' }),
      file({ old_path: 'old.ts', new_path: 'new.ts', renamed_file: true, diff: '' })
    ])
    expect(summarize(patch)).toMatchObject({ files: 3, additions: 2, deletions: 3, patch, truncated: false })
  })

  it('counts nothing in an empty or header-only patch', () => {
    expect(summarize('')).toMatchObject({ files: 0, additions: 0, deletions: 0, patch: '' })
    expect(summarize('diff --git a/x b/x\nBinary files a/x and b/x differ\n')).toMatchObject({
      files: 1,
      additions: 0,
      deletions: 0
    })
  })

  it('counts lines split across chunks', () => {
    const reader = new PatchReader()
    for (const chunk of ['diff --g', 'it a/x b/x\n@', '@ -1 +1 @@\n-', 'a\n+b', '\n']) reader.push(chunk)
    expect(reader.finish()).toMatchObject({ files: 1, additions: 1, deletions: 1, bytes: 37 })
  })

  it('drops the text over the kept limit but keeps counting', () => {
    const reader = new PatchReader(20, 1000)
    reader.push('diff --git a/x b/x\n@@ -1 +1 @@\n')
    reader.push('+a\n+b\n-c\n')
    expect(reader.finish()).toMatchObject({ patch: undefined, files: 1, additions: 2, deletions: 1, truncated: false })
  })

  it('asks to stop reading after the read limit and reports the counts so far', () => {
    const reader = new PatchReader(10, 40)
    expect(reader.push('diff --git a/x b/x\n@@ -1 +1 @@\n+a\n')).toBe(true)
    expect(reader.push('+b\n+c\n+d\n+e\n')).toBe(false)
    expect(reader.finish()).toMatchObject({ patch: undefined, additions: 5, truncated: true })
  })

  it('keeps only the start of a very long line', () => {
    const reader = new PatchReader(10, 10_000_000)
    reader.push('diff --git a/x b/x\n@@ -1 +1 @@\n+')
    for (let i = 0; i < 100; i++) reader.push('x'.repeat(10_000))
    reader.push('\n-y\n')
    expect(reader.finish()).toMatchObject({ files: 1, additions: 1, deletions: 1 })
  })
})

describe('fetchMergeRequestPatch', () => {
  const streamed =
    (text: string) =>
      async (_projectId: number, _iid: number, onText: (text: string) => boolean): Promise<void> => {
        onText(text)
      }

  it('uses the raw diff when GitLab has it', async () => {
    const raw = 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n'
    const api = { readMergeRequestRawDiffs: jest.fn(streamed(raw)), listMergeRequestDiffPages: jest.fn() }
    expect(await fetchMergeRequestPatch(api as any, 42, 3)).toMatchObject({ patch: raw, files: 1, additions: 1 })
    expect(api.listMergeRequestDiffPages).not.toHaveBeenCalled()
  })

  it('assembles the per-file diffs on a GitLab without raw_diffs (404)', async () => {
    const api = {
      readMergeRequestRawDiffs: jest.fn(async () => {
        throw new GitlabApiError(404, 'not found')
      }),
      listMergeRequestDiffPages: jest.fn(async function * () {
        yield [file({})]
      })
    }
    expect((await fetchMergeRequestPatch(api as any, 42, 3)).patch).toBe(assembleUnifiedDiff([file({})]))
    expect(api.listMergeRequestDiffPages).toHaveBeenCalledWith(42, 3)
  })

  it('stops paging the per-file diffs once the read limit is passed', async () => {
    let pagesRead = 0
    const big = file({ diff: `@@ -1 +1 @@\n+${'x'.repeat(30 * 1024 * 1024)}\n` })
    const api = {
      readMergeRequestRawDiffs: jest.fn(async () => {
        throw new GitlabApiError(404, 'not found')
      }),
      listMergeRequestDiffPages: jest.fn(async function * () {
        for (let i = 0; i < 5; i++) {
          pagesRead++
          yield [big]
        }
      })
    }
    const summary = await fetchMergeRequestPatch(api as any, 42, 3)
    expect(summary).toMatchObject({ patch: undefined, truncated: true })
    expect(pagesRead).toBe(2)
  })

  it('does not hide other errors behind the fallback', async () => {
    const api = {
      readMergeRequestRawDiffs: jest.fn(async () => {
        throw new GitlabApiError(500, 'boom')
      }),
      listMergeRequestDiffPages: jest.fn()
    }
    await expect(fetchMergeRequestPatch(api as any, 42, 3)).rejects.toThrow('boom')
    expect(api.listMergeRequestDiffPages).not.toHaveBeenCalled()
  })
})
