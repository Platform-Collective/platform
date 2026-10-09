// SPDX-License-Identifier: EPL-2.0
import { extractHunk } from '../hunk'

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

describe('extractHunk', () => {
  it('cuts the hunk after the commented new line', () => {
    expect(extractHunk(PATCH, 'src/a.ts', 12, null)).toBe(
      ['@@ -10,4 +10,5 @@ export function f () {', ' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4'].join('\n')
    )
  })

  it('finds a removed line by its old number', () => {
    expect(extractHunk(PATCH, 'src/a.ts', null, 11)).toBe(['@@ -10,4 +10,5 @@ export function f () {', ' const a = 1', '-const b = 2'].join('\n'))
  })

  it('looks in the right file', () => {
    expect(extractHunk(PATCH, 'src/b.ts', 1, null)).toBe(['@@ -1 +1 @@', '-x', '+y'].join('\n'))
  })

  it('returns nothing for an unknown file or a line outside every hunk', () => {
    expect(extractHunk(PATCH, 'src/c.ts', 1, null)).toBe('')
    expect(extractHunk(PATCH, 'src/a.ts', 40, null)).toBe('')
  })
})
