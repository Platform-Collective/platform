// SPDX-License-Identifier: EPL-2.0
import { parseDiff } from '@hcengineering/diffview-resources'
import { findHunk, parsePatch } from '../hunk'

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
  'diff --git a/src/c.ts b/src/c.ts',
  '--- a/src/c.ts',
  '+++ b/src/c.ts',
  '@@ -1,2 +1,2 @@',
  ' k',
  '-x',
  '\\ No newline at end of file',
  '+y',
  '\\ No newline at end of file',
  ''
].join('\n')

const hunkAt = (path: string, line: number | null, oldLine: number | null): string =>
  findHunk(parsePatch(PATCH), path, line, oldLine)

describe('findHunk over a large file', () => {
  // More changed lines than the diff view parses by default
  const CHANGES = 10010
  const LARGE = [
    'diff --git a/big.ts b/big.ts',
    '--- a/big.ts',
    '+++ b/big.ts',
    `@@ -0,0 +1,${CHANGES} @@`,
    ...Array.from({ length: CHANGES }, (_, n) => `+line ${n + 1}`),
    ''
  ].join('\n')

  it('finds the hunk of a file too large for the diff view', () => {
    expect(findHunk(parsePatch(LARGE), 'big.ts', 2, null)).toBe(
      [`@@ -0,0 +1,${CHANGES} @@`, '+line 1', '+line 2'].join('\n')
    )
    expect(findHunk(parseDiff(LARGE), 'big.ts', 2, null)).toBe('')
  })
})

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

  it('leaves out the no-newline marker, which diff2html drops', () => {
    expect(hunkAt('src/c.ts', null, 2)).toBe(['@@ -1,2 +1,2 @@', ' k', '-x'].join('\n'))
    expect(hunkAt('src/c.ts', 2, null)).toBe(['@@ -1,2 +1,2 @@', ' k', '-x', '+y'].join('\n'))
  })

  it('returns nothing for an unknown file or a line outside every hunk', () => {
    expect(hunkAt('src/d.ts', 1, null)).toBe('')
    expect(hunkAt('src/a.ts', 40, null)).toBe('')
  })
})
