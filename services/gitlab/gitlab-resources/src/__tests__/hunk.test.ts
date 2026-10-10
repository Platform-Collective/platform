// SPDX-License-Identifier: EPL-2.0
import { findHunk, splitPatchFiles } from '../hunk'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,4 +10,5 @@ export function f () {',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
  ' return a',
  ' }',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -1 +1 @@',
  '-x',
  '+y',
  ''
].join('\n')

const hunkAt = (path: string, line: number | null, oldLine: number | null): string =>
  findHunk(splitPatchFiles(PATCH), path, line, oldLine)

describe('findHunk over a whole diff', () => {
  it('cuts the hunk after the commented new line', () => {
    expect(hunkAt('src/a.ts', 12, null)).toBe(
      ['@@ -10,4 +10,5 @@ export function f () {', ' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4'].join(
        '\n'
      )
    )
  })

  it('finds a removed line by its old number', () => {
    expect(hunkAt('src/a.ts', null, 11)).toBe(
      ['@@ -10,4 +10,5 @@ export function f () {', ' const a = 1', '-const b = 2'].join('\n')
    )
  })

  it('looks in the right file', () => {
    expect(hunkAt('src/b.ts', 1, null)).toBe(['@@ -1 +1 @@', '-x', '+y'].join('\n'))
  })

  it('returns nothing for an unknown file or a line outside every hunk', () => {
    expect(hunkAt('src/c.ts', 1, null)).toBe('')
    expect(hunkAt('src/a.ts', 40, null)).toBe('')
  })
})

describe('splitPatchFiles / findHunk', () => {
  it('splits a diff into its files once', () => {
    const files = splitPatchFiles(PATCH)
    expect(files.map((it) => it.header)).toEqual([
      'diff --git a/src/a.ts b/src/a.ts',
      'diff --git a/src/b.ts b/src/b.ts'
    ])
  })

  it('finds the literal hunk of each file and position', () => {
    const files = splitPatchFiles(PATCH)
    expect(findHunk(files, 'src/a.ts', 12, null)).toBe(
      ['@@ -10,4 +10,5 @@ export function f () {', ' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4'].join(
        '\n'
      )
    )
    expect(findHunk(files, 'src/a.ts', null, 11)).toBe(
      ['@@ -10,4 +10,5 @@ export function f () {', ' const a = 1', '-const b = 2'].join('\n')
    )
    expect(findHunk(files, 'src/b.ts', 1, null)).toBe(['@@ -1 +1 @@', '-x', '+y'].join('\n'))
    expect(findHunk(files, 'src/missing.ts', 1, null)).toBe('')
    expect(findHunk(files, 'src/a.ts', 40, null)).toBe('')
  })
})
