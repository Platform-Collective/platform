// SPDX-License-Identifier: EPL-2.0

import { validateRatings } from '@hcengineering/server-rating'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default async () => ({
  validator: {
    ValidateRatings: validateRatings
  }
})
