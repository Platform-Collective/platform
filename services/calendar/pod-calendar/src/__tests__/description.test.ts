// SPDX-License-Identifier: EPL-2.0

import { shouldPushDescriptionUpdate } from '../description'

const emptyDescription = '{"type":"doc","content":[{"type":"paragraph"}]}'
const oldDescription = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Old"}]}]}'
const newDescription = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"New"}]}]}'

describe('shouldPushDescriptionUpdate', () => {
  it('pushes a changed non-empty description', () => {
    expect(shouldPushDescriptionUpdate(newDescription, oldDescription)).toBe(true)
  })

  it('does not push equivalent or both empty descriptions', () => {
    expect(shouldPushDescriptionUpdate(oldDescription, oldDescription)).toBe(false)
    expect(shouldPushDescriptionUpdate(emptyDescription, '')).toBe(false)
  })
})
