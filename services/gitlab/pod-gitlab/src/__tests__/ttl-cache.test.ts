// SPDX-License-Identifier: EPL-2.0
import { TtlCache } from '../ttl-cache'

function cache (now: { value: number }, maxSize = 10, maxEntries = 3): TtlCache<string> {
  return new TtlCache<string>({ ttlMs: 1000, maxEntries, maxSize, sizeOf: (it) => it.length, now: () => now.value })
}

describe('TtlCache', () => {
  it('returns a value until it expires', () => {
    const now = { value: 0 }
    const c = cache(now)
    c.set('a', 'xx')
    now.value = 999
    expect(c.get('a')).toBe('xx')
    now.value = 1000
    expect(c.get('a')).toBeUndefined()
  })

  it('evicts the least recently used entries beyond the entry and size limits', () => {
    const now = { value: 0 }
    const c = cache(now)
    c.set('a', '1')
    c.set('b', '2')
    c.set('c', '3')
    expect(c.get('a')).toBe('1')
    c.set('d', '4')
    expect(c.get('b')).toBeUndefined()
    // a was used after b and c: c goes when e pushes the size to the limit
    c.set('e', '1234567')
    expect(c.get('c')).toBeUndefined()
    expect(c.get('a')).toBe('1')
    expect(c.get('e')).toBe('1234567')
  })

  it('does not keep a value larger than the whole cache', () => {
    const c = cache({ value: 0 })
    c.set('big', 'x'.repeat(11))
    expect(c.get('big')).toBeUndefined()
  })
})
