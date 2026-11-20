//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//
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

export function writable<T> (initialValue: T): Writable<T> {
  let value = initialValue
  const subscribers = new Set<Subscriber<T>>()
  return {
    subscribe (run: Subscriber<T>): Unsubscriber {
      subscribers.add(run)
      run(value)
      return () => subscribers.delete(run)
    },
    set (newValue: T): void {
      value = newValue
      subscribers.forEach((run) => {
        run(value)
      })
    },
    update (updater: Updater<T>): void {
      this.set(updater(value))
    }
  }
}

export function get<T> (store: Readable<T>): T {
  let current!: T
  const unsub = store.subscribe((v) => {
    current = v
  })
  unsub()
  return current
}
