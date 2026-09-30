/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

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
