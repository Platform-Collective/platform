// SPDX-License-Identifier: EPL-2.0
import { expansionAfter } from '../thread-expansion'

describe('expansionAfter', () => {
  it('collapses on resolve and expands on reopen, wherever it happened', () => {
    expect(expansionAfter({ expanded: true, resolved: false }, true)).toEqual({ expanded: false, resolved: true })
    expect(expansionAfter({ expanded: false, resolved: true }, false)).toEqual({ expanded: true, resolved: false })
  })

  it("keeps the user's choice while the state stays the same", () => {
    const opened = { expanded: true, resolved: true }
    expect(expansionAfter(opened, true)).toBe(opened)
  })
})
