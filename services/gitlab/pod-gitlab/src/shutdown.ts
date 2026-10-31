// SPDX-License-Identifier: EPL-2.0

export interface ShutdownOptions {
  close: () => Promise<void>
  exit: (code: number) => void
  onError: (err: unknown) => void
  // A close that hangs (an open connection, a stuck GitLab call) must not keep the pod from stopping
  timeoutMs: number
}

/** A signal handler: closes once; exits 0 after a clean close, 1 after a failed or too slow one. */
export function createShutdown (options: ShutdownOptions): () => void {
  let started = false
  return () => {
    if (started) return
    started = true
    const timer = setTimeout(() => {
      options.onError(new Error(`Shutdown took longer than ${options.timeoutMs} ms`))
      options.exit(1)
    }, options.timeoutMs)
    options.close().then(
      () => {
        clearTimeout(timer)
        options.exit(0)
      },
      (err: unknown) => {
        clearTimeout(timer)
        options.onError(err)
        options.exit(1)
      }
    )
  }
}
