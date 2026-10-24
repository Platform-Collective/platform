// SPDX-License-Identifier: EPL-2.0

import { resolveAssigneeSelection } from './assignee-selection'

describe('resolveAssigneeSelection', () => {
  const alice = { _id: 'alice' }
  const bob = { _id: 'bob' }

  it('returns the picked person when it is not the current assignee', () => {
    expect(resolveAssigneeSelection(bob, 'alice', true)).toBe(bob)
  })

  it('returns the picked person when nothing is assigned yet', () => {
    expect(resolveAssigneeSelection(alice, undefined, true)).toBe(alice)
    expect(resolveAssigneeSelection(alice, null, true)).toBe(alice)
  })

  it('returns null to clear the assignee when the current assignee is picked again', () => {
    expect(resolveAssigneeSelection(alice, 'alice', true)).toBeNull()
  })

  it('keeps the current assignee when deselect is not allowed', () => {
    expect(resolveAssigneeSelection(alice, 'alice', false)).toBe(alice)
  })

  it('returns undefined (cancel) when no row was picked', () => {
    expect(resolveAssigneeSelection(undefined, 'alice', true)).toBeUndefined()
    expect(resolveAssigneeSelection(undefined, undefined, true)).toBeUndefined()
  })
})
