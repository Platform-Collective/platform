// SPDX-License-Identifier: EPL-2.0

import { isPendingJoinInThisSession } from '../session'

describe('isPendingJoinInThisSession', () => {
  it.each([
    { pendingSessionId: 'session', currentSessionId: 'session', expected: true },
    { pendingSessionId: 'other-session', currentSessionId: 'session', expected: false },
    { pendingSessionId: null, currentSessionId: 'session', expected: false },
    { pendingSessionId: 'session', currentSessionId: undefined, expected: false }
  ])('returns $expected for pending $pendingSessionId and current $currentSessionId', ({
    pendingSessionId,
    currentSessionId,
    expected
  }) => {
    expect(isPendingJoinInThisSession(pendingSessionId, currentSessionId)).toBe(expected)
  })
})
