// SPDX-License-Identifier: EPL-2.0

import core, { type Doc, type Ref } from '@hcengineering/core'

import { getActionPopupValue } from '../actionContext'

function document (id: string): Doc {
  return {
    _id: id as Ref<Doc>,
    _class: core.class.Doc,
    space: core.space.Model,
    modifiedBy: core.account.System,
    modifiedOn: 0
  }
}

describe('getActionPopupValue', () => {
  it('passes a single focused document as a single action context', () => {
    const focus = document('focused')

    expect(getActionPopupValue([focus])).toBe(focus)
  })

  it('passes a single selected document as a single action context', () => {
    const selected = document('selected')

    expect(getActionPopupValue([selected])).toBe(selected)
  })

  it('preserves multiple selected documents', () => {
    const docs = [document('first'), document('second')]

    expect(getActionPopupValue(docs)).toBe(docs)
  })
})
