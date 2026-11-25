//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021, 2022 Hardcore Engineering Inc.
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

import core, { type TxCreateDoc, type TxUpdateDoc } from '@hcengineering/core'
import { PlatformError, plugin, unknownStatus, type Plugin, type Resource } from '@hcengineering/platform'
import rating, { ReactionKind, type DocReaction } from '@hcengineering/rating'
import type { TxValidatorControl, TxValidatorFunc } from '@hcengineering/server-core'

/**
 * @public
 */
export const serverRatingId = 'server-rating' as Plugin

function reject (message: string): never {
  throw new PlatformError(unknownStatus(message))
}

export async function validateRatings (
  txes: Parameters<TxValidatorFunc>[0],
  control: TxValidatorControl
): Promise<void> {
  for (const tx of txes) {
    if (tx.objectClass === rating.class.DocRating || tx.objectClass === rating.class.PersonRating) {
      reject('Direct modifications of ratings are not allowed.')
    }
    if (tx.objectClass !== rating.class.DocReaction) continue

    switch (tx._class) {
      case core.class.TxCreateDoc:
        await validateNewReaction(tx as TxCreateDoc<DocReaction>, control)
        break
      case core.class.TxUpdateDoc:
        await validateReactionUpdate(tx as TxUpdateDoc<DocReaction>, control)
        break
    }
  }
}

async function validateNewReaction (create: TxCreateDoc<DocReaction>, control: TxValidatorControl): Promise<void> {
  const current = await control.findAllUnfiltered(control.ctx, rating.class.DocReaction, {
    attachedTo: create.attachedTo,
    attachedToClass: create.objectClass
  })
  if (
    current.some(
      (it) =>
        it.reactionType === create.attributes.reactionType &&
        (it.value === create.attributes.value ||
          (create.attributes.reactionType === ReactionKind.Emoji && it.emoji === create.attributes.emoji))
    )
  ) {
    reject('Duplicate emoji reaction is not allowed.')
  }
}

async function validateReactionUpdate (update: TxUpdateDoc<DocReaction>, control: TxValidatorControl): Promise<void> {
  if (update.operations.reactionType !== undefined) {
    reject('Modifications of reaction type are not allowed.')
  }
  const current = (
    await control.findAllUnfiltered(control.ctx, rating.class.DocReaction, {
      _id: update.objectId,
      _class: update.objectClass
    })
  ).shift()
  if (current === undefined) {
    reject('Reaction not found.')
  }
  if (update.operations.value === undefined || update.operations.value < 0 || update.operations.value > 10) {
    reject('Reaction value modification is required.')
  }
}

/**
 * @public
 */
export default plugin(serverRatingId, {
  validator: {
    ValidateRatings: '' as Resource<TxValidatorFunc>
  }
})
