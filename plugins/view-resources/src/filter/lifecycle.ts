// Copyright © 2026 Hardcore Engineering Inc.
// Licensed under the Eclipse Public License, Version 2.0

const owners = new Map<number, AbortController>()

function getSignal (index: number): AbortSignal {
  let owner = owners.get(index)
  if (owner === undefined) {
    owner = new AbortController()
    owners.set(index, owner)
  }
  return owner.signal
}

export function cancelFilterQuery (index: number): void {
  const owner = owners.get(index)
  owners.delete(index)
  owner?.abort()
}

// Capture every filter before the first lookup. Removal aborts that generation;
// reusing its numeric index creates a new signal and cannot revive old work.
export class FilterQueryLifetime {
  private readonly signals: AbortSignal[]

  constructor (indexes: number[]) {
    this.signals = indexes.map(getSignal)
  }

  isActive (): boolean {
    return this.signals.every((signal) => !signal.aborted)
  }

  async waitFor<T> (operation: Promise<T>): Promise<T | undefined> {
    return await new Promise<T | undefined>((resolve, reject) => {
      const cleanup = (): void => {
        for (const signal of this.signals) signal.removeEventListener('abort', cancel)
      }
      function cancel (): void {
        cleanup()
        resolve(undefined)
      }
      for (const signal of this.signals) signal.addEventListener('abort', cancel)
      if (!this.isActive()) cancel()
      // Keep rejection handling attached even when cancellation wins the race.
      operation.then(
        (value) => {
          cleanup()
          resolve(this.isActive() ? value : undefined)
        },
        (error) => {
          cleanup()
          reject(error)
        }
      )
    })
  }
}
