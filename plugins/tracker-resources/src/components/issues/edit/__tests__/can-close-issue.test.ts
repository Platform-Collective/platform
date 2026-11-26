// SPDX-License-Identifier: EPL-2.0

import type { Issue } from '@hcengineering/tracker'
import { canCloseIssue } from '../can-close-issue'

const issue = { title: 'Issue' } as unknown as Issue

describe('closing an issue panel', () => {
  it('allows closing before the issue or editor has loaded', () => {
    expect(canCloseIssue(undefined)).toBe(true)
  })

  it.each([undefined, null])('allows closing after the description editor is unmounted (%s)', (descriptionBox) => {
    expect(canCloseIssue(undefined, descriptionBox)).toBe(true)
  })

  it('allows closing a deleted issue before the focused editor is unmounted', () => {
    const isFocused = jest.fn(() => true)

    expect(canCloseIssue(undefined, { isFocused })).toBe(true)
    expect(isFocused).not.toHaveBeenCalled()
  })

  it.each([undefined, null])(
    'allows closing while the issue exists but its editor is not mounted (%s)',
    (descriptionBox) => {
      expect(canCloseIssue(issue, descriptionBox)).toBe(true)
    }
  )

  it('keeps an existing issue open while the description is focused', () => {
    expect(canCloseIssue(issue, { isFocused: () => true })).toBe(false)
  })

  it('allows closing an existing issue when the description is not focused', () => {
    expect(canCloseIssue(issue, { isFocused: () => false })).toBe(true)
  })
})
