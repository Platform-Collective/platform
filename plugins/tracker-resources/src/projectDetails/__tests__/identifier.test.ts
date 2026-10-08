//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { freeIdentifier } from '../identifier'

describe('freeIdentifier', () => {
  it('numbers the copy of a project', () => {
    expect(freeIdentifier('TSK', new Set(['TSK']))).toBe('TSK2')
  })

  it('skips the identifiers that are taken', () => {
    expect(freeIdentifier('TSK', new Set(['TSK', 'TSK2', 'TSK3']))).toBe('TSK4')
  })

  it('shortens a long base to stay within five characters', () => {
    expect(freeIdentifier('ABCDE', new Set(['ABCDE']))).toBe('ABCD2')
    const taken = new Set(['ABCDE', ...Array.from({ length: 8 }, (_, i) => `ABCD${i + 2}`)])
    expect(freeIdentifier('ABCDE', taken)).toBe('ABC10')
  })

  it('cleans the base like the identifier field does', () => {
    expect(freeIdentifier('my-p', new Set())).toBe('MY_P2')
  })
})
