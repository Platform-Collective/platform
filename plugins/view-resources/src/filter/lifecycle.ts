// Copyright © 2026 Hardcore Engineering Inc.
// Licensed under the Eclipse Public License, Version 2.0

const owners = new Map<number, AbortController>()
const cancelledController = new AbortController()
cancelledController.abort()

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
  private readonly aborted: Promise<void>
  private resolveAborted: () => void = () => {}

  private constructor (signals: AbortSignal[]) {
    this.signals = signals
    this.aborted = new Promise<void>((resolve) => {
      this.resolveAborted = resolve
    })
    for (const signal of this.signals) signal.addEventListener('abort', this.cancel, { once: true })
    if (!this.isActive()) this.cancel()
  }

  static register (indexes: number[]): FilterQueryLifetime {
    return new FilterQueryLifetime(indexes.map(getSignal))
  }

  static capture (index: number): FilterQueryLifetime {
    return new FilterQueryLifetime([owners.get(index)?.signal ?? cancelledController.signal])
  }

  private readonly cancel = (): void => {
    for (const signal of this.signals) signal.removeEventListener('abort', this.cancel)
    this.resolveAborted()
  }

  isActive (): boolean {
    return this.signals.every((signal) => !signal.aborted)
  }

  async waitFor<T> (operation: Promise<T>): Promise<T | undefined> {
    return await Promise.race([
      operation.then((value) => (this.isActive() ? value : undefined)),
      this.aborted.then((): undefined => undefined)
    ])
  }
}
