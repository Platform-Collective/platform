// SPDX-License-Identifier: EPL-2.0

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export function deferred<T> (): Deferred<T> {
  let fulfill!: (value: T) => void
  let fail!: (reason: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    fulfill = resolve
    fail = reject
  })
  return { promise, resolve: fulfill, reject: fail }
}
