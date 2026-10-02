// SPDX-License-Identifier: EPL-2.0

import { type Request } from 'express'
import { type Token } from '@hcengineering/server-token'

/** Request shape used by the auth pipeline: a plain Express request. */
export type RequestWithAuth = Request & {
  token?: Token
}
