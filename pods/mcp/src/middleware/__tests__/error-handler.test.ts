// SPDX-License-Identifier: EPL-2.0

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
