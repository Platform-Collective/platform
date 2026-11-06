//
// Copyright © 2025 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

export interface ChunkReadResult {
  done: boolean
  value: Blob | undefined
}

export class ChunkReader {
  private readonly chunks: Blob[] = []
  private readonly sent: Blob[] = []
  private done = false
  private discarded = false
  private recovering = false
  private retainedBytes = 0
  private resolveClosed: () => void = () => {}
  private awaitingResolve: ((val: ChunkReadResult | Promise<ChunkReadResult>) => void) | null = null
  readonly closed = new Promise<void>((resolve) => {
    this.resolveClosed = resolve
  })
  recoverable: boolean
  recordingError?: Error
  onRecoveryUnavailable?: () => void
  onError?: (error: Error) => void

  // Retention costs O(recording length). Disabled by default; the cap includes queued and consumed chunks.
  constructor (private readonly maxRetainedBytes = 0) {
    this.recoverable = maxRetainedBytes > 0
  }

  public async read (): Promise<ChunkReadResult> {
    if (this.discarded || this.recovering || (this.done && this.chunks.length === 0)) {
      return { done: true, value: undefined }
    }
    const value = this.chunks.shift()
    if (value !== undefined) {
      if (this.recoverable) this.sent.push(value)
      return { done: false, value }
    }
    return await new Promise<ChunkReadResult>((resolve) => {
      this.awaitingResolve = resolve
    })
  }

  public push (blob: Blob): void {
    if (this.done || this.discarded) return
    if (this.recoverable) {
      this.retainedBytes += blob.size
      if (this.retainedBytes > this.maxRetainedBytes) {
        this.recoverable = false
        this.retainedBytes = 0
        this.sent.length = 0
        console.warn('ChunkReader: recording recovery disabled because the retention limit was exceeded')
        this.onRecoveryUnavailable?.()
        if (this.recovering) this.release()
      }
    }
    if (this.discarded) return
    this.chunks.push(blob)
    this.wakeReader()
  }

  public close (): void {
    this.done = true
    this.resolveClosed()
    this.wakeReader()
  }

  // MediaRecorder emits final dataavailable and stop after error. Keep accepting that final chunk.
  public fail (error: Error): void {
    this.recordingError = error
    this.onError?.(error)
  }

  public beginRecovery (): void {
    this.recovering = true
    this.wakeReader()
    if (!this.recoverable) this.release()
  }

  public replayBlob (): Blob {
    if (!this.done || !this.recoverable || this.discarded) throw new Error('Recording cannot be replayed')
    return new Blob([...this.sent, ...this.chunks])
  }

  public release (): void {
    this.discarded = true
    this.recoverable = false
    this.retainedBytes = 0
    this.sent.length = 0
    this.chunks.length = 0
    this.resolveClosed()
    this.wakeReader()
  }

  private wakeReader (): void {
    const resolve = this.awaitingResolve
    this.awaitingResolve = null
    if (resolve !== null) resolve(this.read())
  }
}
