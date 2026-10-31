// SPDX-License-Identifier: EPL-2.0
import { safeHttpUrl } from '../safe-url'

describe('safeHttpUrl', () => {
  it('keeps http and https URLs', () => {
    expect(safeHttpUrl('https://gitlab.com/g/r/-/issues/1')).toBe('https://gitlab.com/g/r/-/issues/1')
    expect(safeHttpUrl('HTTP://gitlab.local/g/r')).toBe('HTTP://gitlab.local/g/r')
    expect(safeHttpUrl('  https://gitlab.com/g/r  ')).toBe('https://gitlab.com/g/r')
  })

  it('refuses any other scheme and empty values', () => {
    for (const url of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,x',
      '//evil.example',
      'vbscript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      '\u0001https://x',
      'https://',
      '',
      null,
      undefined
    ]) {
      expect(safeHttpUrl(url)).toBeUndefined()
    }
  })
})
