// SPDX-License-Identifier: EPL-2.0

import { handleIssueTitleKeyDown, normalizeIssueTitle } from './issue-title'

describe('normalizeIssueTitle', () => {
  it.each([
    ['  Issue title  ', 'Issue title'],
    ['First line\nsecond line', 'First line second line'],
    ['First line\r\nsecond line', 'First line second line'],
    ['First line\rsecond line', 'First line second line'],
    ['First line\n\nsecond line', 'First line second line'],
    ['First line\u2028second line\u2029third line', 'First line second line third line'],
    ['\n  \r\n', ''],
    ['', ''],
    ['Keep  spaces\tand Unicode: 日本語', 'Keep  spaces\tand Unicode: 日本語']
  ])('normalizes %j to %j', (title, expected) => {
    expect(normalizeIssueTitle(title)).toBe(expected)
  })

  it('preserves the full title regardless of its length', () => {
    const title = 'A long issue title that should wrap at narrow widths. '.repeat(100).trim()
    expect(normalizeIssueTitle(title)).toBe(title)
  })
})

describe('handleIssueTitleKeyDown', () => {
  it.each([
    ['Enter', false, true],
    ['Enter', true, false],
    ['a', false, false],
    ['Tab', false, false],
    ['Escape', false, false]
  ])('handles %s with composition %s', (key, isComposing, prevented) => {
    const preventDefault = jest.fn()

    handleIssueTitleKeyDown({ key, isComposing, preventDefault })

    expect(preventDefault).toHaveBeenCalledTimes(prevented ? 1 : 0)
  })
})
