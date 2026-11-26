// SPDX-License-Identifier: EPL-2.0

import { canSaveLink } from './link-validation'

describe('canSaveLink without URL.canParse', () => {
  const canParseDescriptor = Object.getOwnPropertyDescriptor(URL, 'canParse')

  beforeEach(() => {
    Object.defineProperty(URL, 'canParse', { configurable: true, value: undefined })
  })

  afterEach(() => {
    if (canParseDescriptor !== undefined) {
      Object.defineProperty(URL, 'canParse', canParseDescriptor)
    } else {
      Reflect.deleteProperty(URL, 'canParse')
    }
  })

  it('allows removing a link', () => {
    expect(canSaveLink('')).toBe(true)
  })

  it.each([
    'https://example.com/path?q=value#section',
    'http://example.com',
    'mailto:user@example.com',
    'ftp://example.com'
  ])('accepts the absolute URL %s', (link) => {
    expect(canSaveLink(link)).toBe(true)
  })

  it.each(['not a URL', 'https://', 'https://[invalid', 'example.com', '/relative/path', '   '])(
    'rejects the invalid or relative URL %s',
    (link) => {
      expect(canSaveLink(link)).toBe(false)
    }
  )

  it('validates successive edits without interrupting updates', () => {
    const edits = ['https://example.com', 'https://', 'https://example.org', '']
    expect(edits.map(canSaveLink)).toEqual([true, false, true, true])
  })
})
