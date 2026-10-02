// SPDX-License-Identifier: EPL-2.0

export class HttpError extends Error {
  readonly status: number

  constructor (status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}
