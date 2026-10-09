// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import { GitlabApiError } from '../gitlab/api'
import type { GitlabMergeRequestDiff } from '../gitlab/types'
import { assembleUnifiedDiff, countPatchFiles, countPatchLines, fetchMergeRequestPatch } from '../sync/patch'

function file (overrides: Partial<GitlabMergeRequestDiff>): GitlabMergeRequestDiff {
  return {
    old_path: 'src/a.ts', new_path: 'src/a.ts', a_mode: '100644', b_mode: '100644',
    diff: '@@ -1 +1 @@\n-a\n+b\n', new_file: false, renamed_file: false, deleted_file: false,
    ...overrides
  }
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
    expect(patch.split('\n').filter((it) => !it.startsWith('index ')).join('\n')).toBe([
      'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-a', '+b',
      'diff --git a/n.ts b/n.ts', 'new file mode 100644', '--- /dev/null', '+++ b/n.ts', '@@ -0,0 +1 @@', '+x',
      'diff --git a/d.ts b/d.ts', 'deleted file mode 100644', '--- a/d.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-x',
      'diff --git a/old.ts b/new.ts', 'rename from old.ts', 'rename to new.ts',
      ''
    ].join('\n'))
    expect(countPatchFiles(patch)).toBe(4)
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

describe('countPatchLines', () => {
  it('counts added and removed lines inside hunks only', () => {
    const patch = assembleUnifiedDiff([
      file({}),
      // A removed line whose text starts with '-- ' reads '--- x' inside the hunk; it is one removed line
      file({ old_path: 'b.ts', new_path: 'b.ts', diff: '@@ -1,2 +1 @@\n--- x\n-y\n+z\n context\n' }),
      file({ old_path: 'old.ts', new_path: 'new.ts', renamed_file: true, diff: '' })
    ])
    expect(countPatchLines(patch)).toEqual({ additions: 2, deletions: 3 })
  })

  it('counts nothing in an empty or header-only patch', () => {
    expect(countPatchLines('')).toEqual({ additions: 0, deletions: 0 })
    expect(countPatchLines('diff --git a/x b/x\nBinary files a/x and b/x differ\n')).toEqual({ additions: 0, deletions: 0 })
  })
})

describe('fetchMergeRequestPatch', () => {
  it('uses the raw diff when GitLab has it', async () => {
    const api = { getMergeRequestRawDiffs: jest.fn(async () => 'raw'), listMergeRequestDiffs: jest.fn() }
    expect(await fetchMergeRequestPatch(api as any, 42, 3)).toBe('raw')
    expect(api.listMergeRequestDiffs).not.toHaveBeenCalled()
  })

  it('assembles the per-file diffs on a GitLab without raw_diffs (404)', async () => {
    const api = {
      getMergeRequestRawDiffs: jest.fn(async () => { throw new GitlabApiError(404, 'not found') }),
      listMergeRequestDiffs: jest.fn(async () => [file({})])
    }
    expect(await fetchMergeRequestPatch(api as any, 42, 3)).toBe(assembleUnifiedDiff([file({})]))
    expect(api.listMergeRequestDiffs).toHaveBeenCalledWith(42, 3)
  })

  it('does not hide other errors behind the fallback', async () => {
    const api = {
      getMergeRequestRawDiffs: jest.fn(async () => { throw new GitlabApiError(500, 'boom') }),
      listMergeRequestDiffs: jest.fn()
    }
    await expect(fetchMergeRequestPatch(api as any, 42, 3)).rejects.toThrow('boom')
    expect(api.listMergeRequestDiffs).not.toHaveBeenCalled()
  })
})
