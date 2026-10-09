//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { calcSørensenDiceCoefficient, normalizeMarkdown } from '../compare'

describe('calcSørensenDiceCoefficient', () => {
  it('returns zero for nullish inputs', () => {
    expect(calcSørensenDiceCoefficient(null as unknown as string, 'text')).toBe(0)
    expect(calcSørensenDiceCoefficient('text', undefined as unknown as string)).toBe(0)
  })

  it('returns one for identical strings after whitespace is removed', () => {
    expect(calcSørensenDiceCoefficient('hello world', 'helloworld')).toBe(1)
    expect(calcSørensenDiceCoefficient('', '  \n\t')).toBe(1)
  })

  it('returns zero when either distinct normalized string is shorter than two characters', () => {
    expect(calcSørensenDiceCoefficient('a', 'b')).toBe(0)
    expect(calcSørensenDiceCoefficient('a', 'ab')).toBe(0)
  })

  it('calculates the coefficient from shared bigrams', () => {
    expect(calcSørensenDiceCoefficient('night', 'nacht')).toBe(0.25)
    expect(calcSørensenDiceCoefficient('night', 'nacht')).toBe(calcSørensenDiceCoefficient('nacht', 'night'))
  })

  it('counts repeated bigrams no more often than they occur in both strings', () => {
    expect(calcSørensenDiceCoefficient('aaaa', 'aa')).toBe(0.5)
    expect(calcSørensenDiceCoefficient('abc', 'xyz')).toBe(0)
  })
})

describe('normalizeMarkdown', () => {
  it('returns an empty string for nullish and non-string inputs', () => {
    expect(normalizeMarkdown(null as unknown as string)).toBe('')
    expect(normalizeMarkdown(undefined as unknown as string)).toBe('')
    expect(normalizeMarkdown(123 as unknown as string)).toBe('')
    expect(normalizeMarkdown({} as unknown as string)).toBe('')
  })

  it('normalizes line endings and removes empty lines and trailing whitespace', () => {
    expect(normalizeMarkdown('line1  \r\n  \rline2   \n\nline3')).toBe('line1\nline2\nline3')
  })

  it('sorts HTML attributes and normalizes void elements to self-closing tags', () => {
    expect(normalizeMarkdown('<img width="100" src="test.jpg" alt="test">')).toBe(
      '<img alt="test" src="test.jpg" width="100" />'
    )
    expect(normalizeMarkdown('<input type="checkbox" checked>')).toBe('<input checked type="checkbox" />')
  })

  it('keeps non-void tags open and preserves their normalized attributes', () => {
    expect(normalizeMarkdown("<div dataid=42 class='test'>")).toBe('<div class="test" dataid="42">')
  })

  it('normalizes markdown containing text and HTML tags', () => {
    const source = 'Text before\r\n<img alt="test" src="image.jpg">  \n\nText after   '
    const expected = 'Text before\n<img alt="test" src="image.jpg" />\nText after'

    expect(normalizeMarkdown(source)).toBe(expected)
  })
})
