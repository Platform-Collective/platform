// SPDX-License-Identifier: EPL-2.0

import chunter from '@hcengineering/chunter'
import { type Class, type Doc, type Ref } from '@hcengineering/core'
import { type DocNotifyContext, type DocNotifyLevel } from '@hcengineering/notification'

import { getDocNotifyLevelValues } from './notifyLevelOptions'

function context (
  objectClass: Ref<Class<Doc>>,
  notifyLevel?: DocNotifyLevel
): Pick<DocNotifyContext, 'objectClass' | 'notifyLevel'> {
  return { objectClass, notifyLevel }
}

describe('getDocNotifyLevelValues', () => {
  it('offers all levels for channels and checks the current level', () => {
    const values = getDocNotifyLevelValues(context(chunter.class.Channel, 'mentions'))

    expect(values.map(({ id }) => id)).toEqual(['all', 'mentions', 'none'])
    expect(values.filter(({ isSelected }) => isSelected === true).map(({ id }) => id)).toEqual(['mentions'])
  })

  it('offers only all and none for direct messages', () => {
    const values = getDocNotifyLevelValues(context(chunter.class.DirectMessage))

    expect(values.map(({ id }) => id)).toEqual(['all', 'none'])
    expect(values.filter(({ isSelected }) => isSelected === true).map(({ id }) => id)).toEqual(['all'])
  })

  it('shows a saved mentions-only direct message level without changing its meaning', () => {
    const values = getDocNotifyLevelValues(context(chunter.class.DirectMessage, 'mentions'))

    expect(values.map(({ id }) => id)).toEqual(['all', 'mentions', 'none'])
    expect(values.filter(({ isSelected }) => isSelected === true).map(({ id }) => id)).toEqual(['mentions'])
  })
})
