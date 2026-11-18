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

describe('handleIssueTitleKeyDown with an Enter callback', () => {
  it.each([
    [{ key: 'Enter' }, true],
    [{ key: 'Enter', isComposing: true }, false],
    [{ key: 'Enter', ctrlKey: true }, false],
    [{ key: 'Enter', metaKey: true }, false],
    [{ key: 'Enter', shiftKey: true }, false],
    [{ key: 'Enter', altKey: true }, false],
    [{ key: 'a' }, false],
    [{ key: 'Tab' }, false]
  ])('calls the callback for %j: %s', (init, called) => {
    const onEnter = jest.fn()

    handleIssueTitleKeyDown(
      {
        isComposing: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault: jest.fn(),
        ...init
      },
      onEnter
    )

    expect(onEnter).toHaveBeenCalledTimes(called ? 1 : 0)
  })

  it('still blocks the line break when a modifier is held', () => {
    const preventDefault = jest.fn()

    handleIssueTitleKeyDown(
      {
        key: 'Enter',
        isComposing: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        preventDefault
      },
      jest.fn()
    )

    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})
