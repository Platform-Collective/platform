// SPDX-License-Identifier: EPL-2.0

import core from '@hcengineering/core'
import type { Builder } from '@hcengineering/model'
import rating from '@hcengineering/rating'
import serverCore from '@hcengineering/server-core'
import serverRating from '@hcengineering/server-rating'

export { serverRatingId } from '@hcengineering/server-rating'

export function createModel (builder: Builder): void {
  for (const objectClass of [rating.class.DocRating, rating.class.PersonRating, rating.class.DocReaction]) {
    builder.createDoc(serverCore.class.TxValidator, core.space.Model, {
      validator: serverRating.validator.ValidateRatings,
      objectClass,
      includeSystem: true,
      includeDerived: true
    })
  }
}
