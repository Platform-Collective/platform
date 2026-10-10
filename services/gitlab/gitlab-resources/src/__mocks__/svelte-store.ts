// SPDX-License-Identifier: EPL-2.0
//
// `svelte/store` stand-in for Jest: the real module ships as ESM, which the ts-jest CommonJS runtime cannot
// require (plugins/view-resources maps it the same way). It keeps Svelte's store contract: a subscriber gets
// the current value at once, `start` runs on the first subscriber and its stop function after the last leaves.

export type Subscriber<T> = (value: T) => void
export type Unsubscriber = () => void
export type Updater<T> = (value: T) => T
export type StartStopNotifier<T> = (set: Subscriber<T>) => Unsubscriber | undefined

export interface Readable<T> {
  subscribe: (run: Subscriber<T>) => Unsubscriber
}

export interface Writable<T> extends Readable<T> {
  set: (value: T) => void
  update: (updater: Updater<T>) => void
}

export function writable<T> (value: T, start?: StartStopNotifier<T>): Writable<T> {
  const subscribers = new Set<Subscriber<T>>()
  let stop: Unsubscriber | undefined

  function set (next: T): void {
    value = next
    for (const run of subscribers) run(value)
  }

  return {
    set,
    update: (updater) => {
      set(updater(value))
    },
    subscribe: (run) => {
      subscribers.add(run)
      if (subscribers.size === 1 && start !== undefined) stop = start(set)
      run(value)
      return () => {
        subscribers.delete(run)
        if (subscribers.size === 0) {
          stop?.()
          stop = undefined
        }
      }
    }
  }
}

export function readable<T> (value: T, start?: StartStopNotifier<T>): Readable<T> {
  return { subscribe: writable(value, start).subscribe }
}

export function get<T> (store: Readable<T>): T {
  let value: T | undefined
  store.subscribe((current) => {
    value = current
  })()
  return value as T
}
