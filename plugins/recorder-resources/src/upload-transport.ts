// SPDX-License-Identifier: EPL-2.0

import type { HttpRequest, HttpResponse, HttpStack } from 'tus-js-client'

/** Bound requests including HEAD, POST and best-effort DELETE, even when the transport never settles. */
export class TimeoutHttpStack implements HttpStack {
  constructor (
    private readonly stack: HttpStack,
    private readonly timeoutMs: number
  ) {}

  getName (): string {
    return this.stack.getName()
  }

  createRequest (method: string, url: string): HttpRequest {
    const request = this.stack.createRequest(method, url)
    let cancel: (() => void) | undefined
    return {
      getMethod: () => request.getMethod(),
      getURL: () => request.getURL(),
      setHeader: (name, value) => {
        request.setHeader(name, value)
      },
      getHeader: (name) => request.getHeader(name),
      setProgressHandler: (handler) => {
        request.setProgressHandler(handler)
      },
      getUnderlyingObject: () => request.getUnderlyingObject(),
      abort: async () => {
        cancel?.()
        void request.abort().catch(() => {})
      },
      send: async (body: unknown) =>
        await new Promise<HttpResponse>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Recording upload request timed out'))
            void request.abort().catch(() => {})
          }, this.timeoutMs)
          cancel = () => {
            clearTimeout(timer)
            reject(new Error('Recording upload request aborted'))
          }
          void request
            .send(body)
            .then(resolve, reject)
            .finally(() => {
              clearTimeout(timer)
              cancel = undefined
            })
        })
    }
  }
}

/** Wait only while explicitly offline. An online browser does not guarantee a reachable endpoint. */
export async function waitForOnline (signal: AbortSignal, deadlineMs: number): Promise<void> {
  if (signal.aborted) throw new Error('Recording upload cancelled')
  if (typeof navigator === 'undefined' || navigator.onLine) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      window.removeEventListener('online', online)
      signal.removeEventListener('abort', aborted)
    }
    const online = (): void => {
      cleanup()
      resolve()
    }
    const aborted = (): void => {
      cleanup()
      reject(new Error('Recording upload cancelled'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Recording recovery offline deadline exceeded'))
    }, deadlineMs)
    window.addEventListener('online', online)
    signal.addEventListener('abort', aborted, { once: true })
  })
}
