// SPDX-License-Identifier: EPL-2.0

import core, { TxOperations, type Client, type Ref } from '@hcengineering/core'
import love, {
  MeetingStatus,
  RecordingState,
  RoomAccess,
  TranscriptionState,
  type Floor,
  type MeetingMinutes
} from '@hcengineering/love'
import { Builder } from '@hcengineering/model'
import { TAttachedDoc, TAttribute, TClass, TCollection, TDoc, TObj, TType } from '@hcengineering/model-core'
import { TFloor, TMeetingMinutes } from '../index'

it('declares the floor meetings collection so reparenting and deletion maintain its counter', () => {
  const builder = new Builder()
  builder.createModel(TObj, TDoc, TClass, TAttribute, TType, TCollection, TFloor)

  expect(builder.hierarchy.findAttribute(love.class.Floor, 'meetings')).toMatchObject({
    attributeOf: love.class.Floor,
    type: { _class: core.class.Collection, of: love.class.MeetingMinutes }
  })
})

it('keeps generic updates and deletion of floor minutes collection-aware', async () => {
  const builder = new Builder()
  builder.createModel(TObj, TDoc, TClass, TAttribute, TType, TAttachedDoc, TCollection, TFloor, TMeetingMinutes)
  const tx = jest.fn().mockResolvedValue({})
  const client = new TxOperations(
    { getHierarchy: () => builder.hierarchy, tx } as unknown as Client,
    core.account.System
  )
  const minute: MeetingMinutes = {
    _id: 'minute' as Ref<MeetingMinutes>,
    _class: love.class.MeetingMinutes,
    space: core.space.Workspace,
    modifiedBy: core.account.System,
    modifiedOn: 0,
    attachedTo: 'floor' as Ref<Floor>,
    attachedToClass: love.class.Floor,
    collection: 'meetings',
    title: 'Finished meeting',
    description: null,
    status: MeetingStatus.Finished,
    recordingState: RecordingState.Finished,
    transcriptionState: TranscriptionState.Finished,
    access: RoomAccess.Open,
    language: 'en'
  }

  await client.update(minute, { title: 'Updated notes' })
  await client.remove(minute)

  expect(tx).toHaveBeenCalledTimes(2)
  expect(tx.mock.calls[0][0]).toMatchObject({
    _class: core.class.TxUpdateDoc,
    objectId: minute._id,
    attachedTo: minute.attachedTo,
    attachedToClass: love.class.Floor,
    collection: 'meetings',
    operations: { title: 'Updated notes' }
  })
  expect(tx.mock.calls[1][0]).toMatchObject({
    _class: core.class.TxRemoveDoc,
    objectId: minute._id,
    attachedTo: minute.attachedTo,
    attachedToClass: love.class.Floor,
    collection: 'meetings'
  })
})
