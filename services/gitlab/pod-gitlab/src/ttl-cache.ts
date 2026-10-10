// SPDX-License-Identifier: EPL-2.0

export interface TtlCacheOptions<V> {
  ttlMs: number
  maxEntries: number
  // Total of sizeOf over all entries
  maxSize: number
  sizeOf: (value: V) => number
  now?: () => number
}

/** A small least-recently-used cache whose entries expire. */
export class TtlCache<V> {
  // Map order is the use order: the first entry is the least recently used
  private readonly entries = new Map<string, { value: V, size: number, until: number }>()
  private size = 0

  constructor (private readonly options: TtlCacheOptions<V>) {}

  get (key: string): V | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    this.delete(key)
    if (entry.until <= this.now()) return undefined
    this.entries.set(key, entry)
    this.size += entry.size
    return entry.value
  }

  set (key: string, value: V): void {
    const size = this.options.sizeOf(value)
    this.delete(key)
    if (size > this.options.maxSize) return
    this.entries.set(key, { value, size, until: this.now() + this.options.ttlMs })
    this.size += size
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.options.maxEntries && this.size <= this.options.maxSize) break
      this.delete(oldest)
    }
  }

  private delete (key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    this.entries.delete(key)
    this.size -= entry.size
  }

  private now (): number {
    return (this.options.now ?? Date.now)()
  }
}
