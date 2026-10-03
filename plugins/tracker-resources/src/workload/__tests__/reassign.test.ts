//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { planReassign } from '../reassign'
import { UNASSIGNED_ROW } from '../rows'

describe('planReassign', () => {
  it('writes the person of the row the item was dropped on', () => {
    const plan = planReassign({ assignee: 'ann' }, 'bob', { readonly: false })
    expect(plan).toEqual({ ok: true, assignee: 'bob', patch: { assignee: 'bob' } })
  })

  it('assigns an unassigned item', () => {
    expect(planReassign({ assignee: null }, 'bob', { readonly: false })).toEqual({
      ok: true,
      assignee: 'bob',
      patch: { assignee: 'bob' }
    })
    expect(planReassign({}, 'bob', { readonly: false }).ok).toBe(true)
  })

  it('clears the assignee when the item is dropped on the unassigned row', () => {
    expect(planReassign({ assignee: 'ann' }, UNASSIGNED_ROW, { readonly: false })).toEqual({
      ok: true,
      assignee: null,
      patch: { assignee: null }
    })
  })

  it('changes nothing for the row the item is in', () => {
    expect(planReassign({ assignee: 'ann' }, 'ann', { readonly: false })).toEqual({ ok: false, reason: 'same' })
    expect(planReassign({ assignee: null }, UNASSIGNED_ROW, { readonly: false })).toEqual({ ok: false, reason: 'same' })
    expect(planReassign({}, UNASSIGNED_ROW, { readonly: false })).toEqual({ ok: false, reason: 'same' })
  })

  it('does not let a read-only viewer change anything', () => {
    expect(planReassign({ assignee: 'ann' }, 'bob', { readonly: true })).toEqual({ ok: false, reason: 'readonly' })
    expect(planReassign({ assignee: 'ann' }, 'ann', { readonly: true })).toEqual({ ok: false, reason: 'readonly' })
  })
})
