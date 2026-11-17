//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import activity, { type DocAttributeUpdates, type DocUpdateMessage } from '@hcengineering/activity'
import { type Class, type Doc, type Ref } from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import type * as ActivityMessagesUtils from '../activityMessagesUtils'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/view-resources', () => ({}))

Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null },
  configurable: true
})

const { combineActivityMessages } = jest.requireActual<typeof ActivityMessagesUtils>('../activityMessagesUtils')

function createAttributeUpdate (set: (string | null)[], prevValue: string | undefined): DocAttributeUpdates {
  return {
    attrKey: 'startDate',
    attrClass: 'core:class:TypeDate' as Ref<Class<Doc>>,
    set,
    prevValue,
    added: [],
    removed: [],
    isMixin: false
  }
}

function createMessage (
  id: string,
  createdOn: number,
  action: 'update' | 'create' | 'remove',
  attributeUpdates?: DocAttributeUpdates,
  objectId?: string
): DocUpdateMessage {
  return {
    _id: id as Ref<DocUpdateMessage>,
    _class: activity.class.DocUpdateMessage,
    space: 'space:default' as Ref<Doc>,
    attachedTo: 'issue:1' as Ref<Doc>,
    attachedToClass: 'tracker:class:Issue' as Ref<Class<Doc>>,
    objectId: action === 'update' ? ('issue:1' as Ref<Doc>) : ((objectId ?? `label:${id}`) as Ref<Doc>),
    objectClass: 'tracker:class:Issue' as Ref<Class<Doc>>,
    action,
    updateCollection: action === 'update' ? undefined : 'labels',
    attributeUpdates,
    createdOn,
    createdBy: 'person:me' as Ref<Doc>,
    modifiedOn: createdOn,
    modifiedBy: 'person:me' as Ref<Doc>
  } as unknown as DocUpdateMessage
}

beforeEach(() => {
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => ({ isDerived: () => false })
  })
})

describe('combineActivityMessages history preservation', () => {
  it('keeps set, reset, and an identical later set as three activity entries', () => {
    const setStartDate = createAttributeUpdate(['2026-10-19'], undefined)
    const resetStartDate = createAttributeUpdate([null], '2026-10-19')
    const messages = [
      createMessage('set-first', 1_000, 'update', setStartDate),
      createMessage('reset', 2_000, 'update', resetStartDate),
      createMessage('set-again', 3_000, 'update', setStartDate)
    ]

    expect(combineActivityMessages(messages).map(({ _id }) => _id)).toEqual(['set-first', 'reset', 'set-again'])
  })

  it('combines consecutive attribute value updates within the merge window', () => {
    const messages = [
      createMessage('set-first', 1_000, 'update', createAttributeUpdate(['2026-10-19'], undefined)),
      createMessage('set-second', 2_000, 'update', createAttributeUpdate(['2026-10-20'], '2026-10-19'))
    ]

    const combined = combineActivityMessages(messages)

    expect(combined.map(({ _id }) => _id)).toEqual(['set-second'])
    expect(combined[0]).toMatchObject({
      attributeUpdates: createAttributeUpdate(['2026-10-20'], undefined),
      combinedMessagesIds: ['set-first', 'set-second']
    })
  })

  it('combines labels created one at a time within the merge window', () => {
    const messages = [
      createMessage('label-added-first', 1_000, 'create'),
      createMessage('label-added-second', 2_000, 'create')
    ]

    const combined = combineActivityMessages(messages)

    expect(combined.map(({ _id }) => _id)).toEqual(['label-added-second'])
    expect(combined[0]).toMatchObject({
      previousMessages: [{ _id: 'label-added-first' }],
      combinedMessagesIds: ['label-added-first', 'label-added-second']
    })
  })

  it('cancels label creation and removal within the merge window', () => {
    const messages = [
      createMessage('label-added', 1_000, 'create', undefined, 'label:shared'),
      createMessage('label-removed', 2_000, 'remove', undefined, 'label:shared')
    ]

    expect(combineActivityMessages(messages)).toEqual([])
  })
})
