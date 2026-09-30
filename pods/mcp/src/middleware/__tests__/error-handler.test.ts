/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { type NextFunction, type Request, type Response } from 'express'

import { fakeMeasureContext } from '../../__tests__/test-doubles'
import { HttpError } from '../../error'
import { errorHandler } from '../index'

interface Captured {
  status: number
  body: unknown
}

function run (err: unknown): Captured {
  const captured: Captured = { status: 0, body: undefined }
  const res = {
    headersSent: false,
    status (code: number) {
      captured.status = code
      return this
    },
    json (body: unknown) {
      captured.body = body
      return this
    }
  }
  const req: Pick<Request, 'path'> = { path: '/mcp' }
  errorHandler(fakeMeasureContext())(err, req as Request, res as unknown as Response, (() => {}) as NextFunction)
  return captured
}

describe('errorHandler', () => {
  it('maps HttpError to its own status', () => {
    expect(run(new HttpError(403, 'nope')).status).toBe(403)
  })

  it('reports malformed JSON as 400', () => {
    expect(run(Object.assign(new SyntaxError('bad'), { type: 'entity.parse.failed' })).status).toBe(400)
  })

  it('reports an oversized body as 413, not 500', () => {
    const err = Object.assign(new Error('too large'), { type: 'entity.too.large', status: 413, expose: true })
    expect(run(err).status).toBe(413)
  })

  it('passes through other exposed client errors', () => {
    const err = Object.assign(new Error('unsupported'), { status: 415, expose: true })
    expect(run(err).status).toBe(415)
  })

  it('hides unexpected failures behind a 500', () => {
    const captured = run(new Error('db password is hunter2'))
    expect(captured.status).toBe(500)
    expect(JSON.stringify(captured.body)).not.toContain('hunter2')
  })
})
