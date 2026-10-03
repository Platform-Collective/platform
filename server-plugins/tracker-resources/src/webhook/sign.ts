//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { createHmac, timingSafeEqual } from 'crypto'

/** Header that carries the signature of a delivery. */
export const SIGNATURE_HEADER = 'X-Huly-Signature-256'

const PREFIX = 'sha256='

/**
 * The signature of a payload: `sha256=` and the hex HMAC SHA-256 of the exact bytes of the body, keyed by the secret
 * (the scheme of GitHub's `X-Hub-Signature-256`).
 */
export function signPayload (secret: string, body: string): string {
  return PREFIX + createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

/**
 * Checks a signature in constant time. A receiver does the same with the body it got; this is here for the tests and
 * as the reference of the scheme.
 */
export function verifySignature (secret: string, body: string, header: string | undefined): boolean {
  if (header === undefined || !header.startsWith(PREFIX)) return false
  const expected = Buffer.from(signPayload(secret, body))
  const given = Buffer.from(header)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
