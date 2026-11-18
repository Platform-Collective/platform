// SPDX-License-Identifier: EPL-2.0

import core, { MeasureMetricsContext, TxFactory, type SessionData } from '@hcengineering/core'
import rating, { ReactionKind, type DocReaction, type PersonRating } from '@hcengineering/rating'
import type { TxValidatorControl } from '@hcengineering/server-core'
import { validateRatings } from './index'

const factory = new TxFactory(core.account.System)
const context = new MeasureMetricsContext('test', {}) as MeasureMetricsContext & { contextData: SessionData }

function control (current: DocReaction[] = []): TxValidatorControl {
  return {
    ctx: context,
    findAllUnfiltered: async () => current,
    current: async () => current[0]
  } as unknown as TxValidatorControl
}

function reaction (value: number = 1): DocReaction {
  return {
    _id: 'reaction' as DocReaction['_id'],
    _class: rating.class.DocReaction,
    space: core.space.Workspace,
    modifiedBy: core.account.System,
    modifiedOn: 0,
    attachedTo: 'target' as DocReaction['attachedTo'],
    attachedToClass: core.class.Doc,
    collection: 'reactions',
    reactionType: ReactionKind.Emoji,
    emoji: '👍',
    value
  }
}

describe('validateRatings', () => {
  it('rejects direct rating modifications', async () => {
    const tx = factory.createTxUpdateDoc(
      rating.class.PersonRating,
      core.space.Workspace,
      'rating' as PersonRating['_id'],
      {}
    )
    await expect(validateRatings([tx], control())).rejects.toThrow('Direct modifications of ratings are not allowed.')
  })

  it('rejects duplicate reactions using the existing query semantics', async () => {
    const existing = reaction()
    const tx = factory.createTxCreateDoc(rating.class.DocReaction, core.space.Workspace, {
      ...reaction(),
      reactionType: ReactionKind.Emoji,
      emoji: '👍',
      value: 1
    })
    await expect(validateRatings([tx], control([existing]))).rejects.toThrow('Duplicate emoji reaction is not allowed.')
  })

  it('allows a distinct reaction', async () => {
    const tx = factory.createTxCreateDoc(rating.class.DocReaction, core.space.Workspace, {
      ...reaction(),
      emoji: '🎉',
      value: 2
    })
    await expect(validateRatings([tx], control([reaction()]))).resolves.toBeUndefined()
  })

  it('rejects reaction type changes', async () => {
    const tx = factory.createTxUpdateDoc(rating.class.DocReaction, core.space.Workspace, reaction()._id, {
      reactionType: ReactionKind.Star
    })
    await expect(validateRatings([tx], control([reaction()]))).rejects.toThrow(
      'Modifications of reaction type are not allowed.'
    )
  })

  it.each([undefined, -1, 11])('rejects invalid reaction value %s', async (value) => {
    const tx = factory.createTxUpdateDoc(rating.class.DocReaction, core.space.Workspace, reaction()._id, { value })
    await expect(validateRatings([tx], control([reaction()]))).rejects.toThrow(
      'Reaction value modification is required.'
    )
  })

  it('allows a valid value update and reaction removal', async () => {
    const update = factory.createTxUpdateDoc(rating.class.DocReaction, core.space.Workspace, reaction()._id, {
      value: 5
    })
    const remove = factory.createTxRemoveDoc(rating.class.DocReaction, core.space.Workspace, reaction()._id)
    await expect(validateRatings([update, remove], control([reaction()]))).resolves.toBeUndefined()
  })
})
