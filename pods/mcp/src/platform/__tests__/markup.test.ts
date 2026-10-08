// SPDX-License-Identifier: EPL-2.0

import { fromMarkup, toMarkup } from '../markup'

describe('markup conversion', () => {
  it('round-trips Markdown through the stored rich-text format', () => {
    const stored = toMarkup('# Title\n\nSome **bold** text\n\n- one\n- two')

    expect(stored).toContain('"type":"doc"')
    const back = fromMarkup(stored)
    expect(back).toContain('# Title')
    expect(back).toContain('**bold**')
    expect(back).toContain('one')
  })

  it('never returns ProseMirror JSON to the agent', () => {
    expect(fromMarkup(toMarkup('plain text'))).not.toContain('"type"')
  })

  it('returns non-markup text unchanged instead of throwing', () => {
    expect(fromMarkup('just a legacy string')).toBe('just a legacy string')
  })

  it('treats an empty blob as an empty description', () => {
    expect(fromMarkup('')).toBe('')
    expect(fromMarkup('   ')).toBe('')
  })
})
