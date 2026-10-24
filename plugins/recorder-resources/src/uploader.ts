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

import * as tus from 'tus-js-client'
import type { RecordingResult } from './types'
import type { ChunkReader } from './chunk-reader'
import {
  RECOVERY_OFFLINE_DEADLINE_MS,
  UPLOAD_CLEANUP_TIMEOUT_MS,
  UPLOAD_REQUEST_TIMEOUT_MS,
  UPLOAD_RETRY_BUDGET_MS
} from './const'
import { TimeoutHttpStack, waitForOnline } from './upload-transport'

export interface Uploader {
  start: () => void
  cancel: () => Promise<void>
  wait: () => Promise<RecordingResult>
}

export interface TusUploaderOptions {
  endpoint: string
  workspace: string
  token: string
  contentType: string
  width: number
  height: number
  recoveryEnabled?: boolean
  httpStack?: tus.HttpStack
}

export class UploadCancelledError extends Error {
  constructor () {
    super('Recording upload cancelled')
    this.name = 'UploadCancelledError'
  }
}

export class TusUploader implements Uploader {
  private upload: tus.Upload | undefined
  private readonly waiterPromise: Promise<RecordingResult>
  private waiterResolve: (value: RecordingResult) => void = () => {}
  private waiterReject: (reason: Error) => void = () => {}
  private readonly cancellation = new AbortController()
  private settled = false
  private recovering = false
  private bytesSent = 0
  private outageStarted: number | undefined
  private outageTimer: ReturnType<typeof setTimeout> | undefined
  private readonly stack: tus.HttpStack

  constructor (
    private readonly reader: ChunkReader,
    private readonly options: TusUploaderOptions
  ) {
    this.waiterPromise = new Promise<RecordingResult>((resolve, reject) => {
      this.waiterResolve = resolve
      this.waiterReject = reject
    })
    // Upload may fail long before stop() calls wait(). Keep the rejection available without an unhandled rejection.
    void this.waiterPromise.catch(() => {})
    this.stack = options.httpStack ?? new tus.DefaultHttpStack({})
    reader.onRecoveryUnavailable = () => {
      if (this.recovering) this.finish(new Error('Recording exceeds the recovery retention limit'))
    }
    this.upload = this.createUpload(reader)
  }

  private createUpload (source: ChunkReader | Blob): tus.Upload {
    const { endpoint, workspace, token, width, height, contentType, recoveryEnabled } = this.options
    const replay = source instanceof Blob
    const upload = new tus.Upload(source, {
      retryDelays:
        recoveryEnabled === true
          ? [0, 1000, 2000, 5000, 10000, 15000, 30000, 30000, 30000, 30000]
          : [0, 1000, 1500, 2000, 2500, 3000],
      chunkSize: 2 * 1024 * 1024,
      uploadLengthDeferred: !replay,
      ...(recoveryEnabled === true
        ? {
            storeFingerprintForResuming: false,
            httpStack: new TimeoutHttpStack(this.stack, UPLOAD_REQUEST_TIMEOUT_MS),
            onShouldRetry: (error: tus.DetailedError) => {
              if (this.settled) return false
              // Local rewind errors are wrapped with an original PATCH request by tus. Retrying cannot fix the source.
              if (error.causingError?.message.includes("before the reader's current offset") === true) return false
              if (this.outageStarted === undefined) {
                this.outageStarted = Date.now()
                this.outageTimer = setTimeout(() => {
                  this.failed(new Error('Recording upload retry deadline exceeded'), replay)
                }, UPLOAD_RETRY_BUDGET_MS)
              }
              if (Date.now() - this.outageStarted >= UPLOAD_RETRY_BUDGET_MS) return false
              const status = error.originalResponse?.getStatus() ?? 0
              // HTTP HEAD errors (except 423) recreate uploads inside tus and bypass this hook.
              return status === 0 || status >= 500 || status === 409 || status === 423
            }
          }
        : { httpStack: this.stack }),
      endpoint,
      metadata: { width: width.toString(), height: height.toString(), contentType, token, workspace },
      onProgress: (bytesSent) => {
        if (upload === this.upload) this.bytesSent = bytesSent
      },
      onChunkComplete: () => {
        if (upload === this.upload) this.clearOutage()
      },
      onSuccess: () => {
        if (this.settled || (!replay && this.recovering)) return
        const uuid = upload.url?.split('/').pop()
        if (uuid === undefined || uuid === '') {
          this.finish(new Error('Recording upload URL does not contain an ID'))
          return
        }
        this.finish(undefined, {
          uuid,
          type: contentType.split(';')[0],
          width,
          height,
          size: replay ? source.size : this.bytesSent
        })
      },
      onError: (error) => {
        this.failed(error, replay)
      }
    })
    return upload
  }

  private failed (error: Error, replay: boolean): void {
    if (this.settled || (!replay && this.recovering)) return
    if (replay || this.options.recoveryEnabled !== true || !this.reader.recoverable) {
      this.finish(error)
      return
    }
    this.recovering = true
    this.stopUpload()
    this.reader.beginRecovery()
    void this.recover().catch((error: Error) => {
      this.finish(error)
    })
  }

  private async recover (): Promise<void> {
    await this.reader.closed
    if (this.settled) return
    if (!this.reader.recoverable) throw new Error('Recording cannot be recovered')
    await waitForOnline(this.cancellation.signal, RECOVERY_OFFLINE_DEADLINE_MS)
    if (this.settled) return
    const blob = this.reader.replayBlob()
    this.clearOutage()
    this.upload = this.createUpload(blob)
    this.upload.start()
  }

  private clearOutage (): void {
    clearTimeout(this.outageTimer)
    this.outageTimer = undefined
    this.outageStarted = undefined
  }

  private stopUpload (): void {
    this.clearOutage()
    // Aborting the request is local; DELETE is separately bounded and must never block replay or cancellation.
    const upload = this.upload
    if (upload === undefined) return
    void upload.abort().catch(() => {})
    if (upload.url !== null) {
      void tus.Upload.terminate(upload.url, {
        httpStack: new TimeoutHttpStack(this.stack, UPLOAD_CLEANUP_TIMEOUT_MS),
        retryDelays: []
      }).catch((error: unknown) => {
        console.warn('TusUploader: upload cleanup failed', error)
      })
    }
  }

  private finish (error?: Error, result?: RecordingResult): void {
    if (this.settled) return
    this.settled = true
    this.clearOutage()
    this.cancellation.abort()
    this.reader.release()
    if (error !== undefined) {
      this.stopUpload()
      this.waiterReject(error)
    } else if (result !== undefined) {
      this.waiterResolve(result)
    }
    this.upload = undefined
  }

  public start (): void {
    if (!this.settled) this.upload?.start()
  }

  public async wait (): Promise<RecordingResult> {
    return await this.waiterPromise
  }

  public async cancel (): Promise<void> {
    this.finish(new UploadCancelledError())
  }
}
