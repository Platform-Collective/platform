// SPDX-License-Identifier: EPL-2.0

import { getResource } from '@hcengineering/platform'
import serverRating, { validateRatings } from '@hcengineering/server-rating'
import { registerServerPlugins } from './serverPlugins'

describe('server plugin resources', () => {
  it('resolves the rating validator through the registered server module', async () => {
    registerServerPlugins()
    await expect(getResource(serverRating.validator.ValidateRatings)).resolves.toBe(validateRatings)
  })
})
