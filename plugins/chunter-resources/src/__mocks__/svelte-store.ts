// SPDX-License-Identifier: EPL-2.0

// Minimal synchronous CommonJS stand-in for `svelte/store` (which ships as ESM).
// Derived stores are recomputed from their inputs, so `get()` sees current values.

export type Subscriber<T> = (value: T) => void
export type Unsubscriber = () => void
export type Updater<T> = (value: T) => T

export interface Readable<T> {
  subscribe: (run: Subscriber<T>) => Unsubscriber
}

export interface Writable<T> extends Readable<T> {
  set: (value: T) => void
  update: (updater: Updater<T>) => void
}

export function get<T> (store: Readable<T>): T {
  let value: T | undefined
  store.subscribe((v) => {
    value = v
  })()
  return value as T
}

export function writable<T> (initialValue: T): Writable<T> {
  let value = initialValue
  const subscribers = new Set<Subscriber<T>>()
  const set = (newValue: T): void => {
    value = newValue
    subscribers.forEach((run) => {
      run(value)
    })
  }
  return {
    subscribe: (run) => {
      subscribers.add(run)
      run(value)
      return () => subscribers.delete(run)
    },
    set,
    update: (updater) => {
      set(updater(value))
    }
  }
}

export function readable<T> (initialValue: T): Readable<T> {
  return writable(initialValue)
}

export function derived<T> (stores: Readable<any> | Array<Readable<any>>, fn: (values: any) => T): Readable<T> {
  const compute = (): T => (Array.isArray(stores) ? fn(stores.map((s) => get(s))) : fn(get(stores)))
  return {
    subscribe: (run) => {
      const inputs = Array.isArray(stores) ? stores : [stores]
      let ready = false
      const unsubscribers = inputs.map((s) =>
        s.subscribe(() => {
          if (ready) run(compute())
        })
      )
      ready = true
      run(compute())
      return () => {
        unsubscribers.forEach((u) => {
          u()
        })
      }
    }
  }
}
