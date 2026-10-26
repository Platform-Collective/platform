// SPDX-License-Identifier: EPL-2.0

import { DefaultHttpStack, Upload, type HttpRequest, type HttpResponse, type HttpStack } from 'tus-js-client'
import { ChunkReader } from '../chunk-reader'
import { TusUploader, UploadCancelledError } from '../uploader'
import { RECOVERY_OFFLINE_DEADLINE_MS, UPLOAD_REQUEST_TIMEOUT_MS } from '../const'

interface UploadState {
  chunks: Blob[]
  size: number
  length?: number
}

class RecordingServer implements HttpStack {
  readonly uploads: UploadState[] = []
  readonly requests: Array<{ method: string, url: string }> = []
  patchDelayMs = 0
  intercept?: (method: string, id: number, headers: Record<string, string>) => number | 'network' | 'hang' | undefined

  getName (): string {
    return 'RecordingServer'
  }

  createRequest (method: string, url: string): HttpRequest {
    const headers: Record<string, string> = {}
    const response = (status: number, values: Record<string, string> = {}): HttpResponse => ({
      getStatus: () => status,
      getHeader: (key) => values[key.toLowerCase()],
      getBody: () => '',
      getUnderlyingObject: () => undefined
    })
    return {
      getMethod: () => method,
      getURL: () => url,
      getHeader: (name) => headers[name],
      setHeader: (name, value) => {
        headers[name] = value
      },
      setProgressHandler: () => {},
      getUnderlyingObject: () => undefined,
      abort: async () => {},
      send: async (body: unknown) => {
        this.requests.push({ method, url })
        const id = Number(url.split('/').pop())
        const outcome = this.intercept?.(method, id, headers)
        if (outcome === 'network') throw new Error('connection lost')
        if (outcome === 'hang') return await new Promise<HttpResponse>(() => {})
        if (typeof outcome === 'number') return response(outcome)
        if (method === 'POST') {
          this.uploads.push({
            chunks: [],
            size: 0,
            length: headers['Upload-Length'] === undefined ? undefined : Number(headers['Upload-Length'])
          })
          return response(201, { location: `http://stream/recording/${this.uploads.length}` })
        }
        const upload = this.uploads[id - 1]
        if (upload === undefined) return response(404)
        if (method === 'DELETE') return response(204)
        if (method === 'HEAD') {
          return response(200, {
            'upload-offset': String(upload.size),
            ...(upload.length === undefined
              ? { 'upload-defer-length': '1' }
              : { 'upload-length': String(upload.length) })
          })
        }
        if (this.patchDelayMs > 0 && headers['Upload-Length'] !== undefined) {
          await new Promise<void>((resolve) => setTimeout(resolve, this.patchDelayMs))
        }
        if (headers['Upload-Length'] !== undefined) upload.length = Number(headers['Upload-Length'])
        const data = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array()
        upload.chunks.push(new Blob([data]))
        upload.size += data.length
        return response(204, { 'upload-offset': String(upload.size) })
      }
    }
  }
}

async function until (condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await jest.advanceTimersByTimeAsync(0)
  expect(condition()).toBe(true)
}

function create (
  server: RecordingServer,
  cap = 20 * 1024 * 1024,
  enabled = true
): {
  reader: ChunkReader
  uploader: TusUploader
} {
  jest
    .spyOn(DefaultHttpStack.prototype, 'createRequest')
    .mockImplementation((method, url) => server.createRequest(method, url))
  const reader = new ChunkReader(cap)
  const uploader = new TusUploader(reader, {
    endpoint: 'http://stream/recording',
    workspace: 'workspace',
    token: 'token',
    width: 100,
    height: 200,
    contentType: 'video/webm;codecs=vp9',
    recoveryEnabled: enabled,
    httpStack: server
  })
  return { reader, uploader }
}

describe('TusUploader with the real browser tus-js-client', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  test('the installed tus stream source reports the rewind error used by retry classification', async () => {
    const server = new RecordingServer()
    server.intercept = (method, id, headers) => {
      if (method === 'PATCH' && id === 1 && Number(headers['Upload-Offset']) > 0) return 'network'
      if (method === 'HEAD') return 404
    }
    const reader = new ChunkReader()
    reader.push(new Blob([new Uint8Array(5 * 1024 * 1024)]))
    reader.close()
    const rewind = jest.fn()
    const failed = new Promise<Error>((resolve) => {
      const upload = new Upload(reader, {
        endpoint: 'http://stream/recording',
        httpStack: server,
        chunkSize: 2 * 1024 * 1024,
        uploadLengthDeferred: true,
        storeFingerprintForResuming: false,
        retryDelays: [0, 0],
        onShouldRetry: (error) => {
          if (error.causingError?.message === 'connection lost') return true
          rewind(error.causingError?.message)
          return false
        },
        onError: resolve
      })
      upload.start()
    })
    await until(() => server.requests.some((r) => r.method === 'HEAD'))
    expect((await failed).message).toContain("before the reader's current offset")
    expect(rewind).toHaveBeenCalledWith("Requested data is before the reader's current offset")
  })

  test.each([404, 500])('HEAD %s recreates and closed Blob replay includes later chunks', async (status) => {
    const server = new RecordingServer()
    let dropped = false
    server.intercept = (method, id, headers) => {
      if (method === 'PATCH' && id === 1 && Number(headers['Upload-Offset']) > 0 && !dropped) {
        dropped = true
        return 'network'
      }
      if (method === 'HEAD' && id === 1) return status
    }
    const { reader, uploader } = create(server)
    const initial = new Uint8Array(5 * 1024 * 1024).fill(7)
    reader.push(new Blob([initial]))
    uploader.start()
    await until(() => dropped)
    await jest.advanceTimersByTimeAsync(0)
    await until(() => server.uploads.length === 2)
    await until(() => server.requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/2')))
    expect(server.uploads).toHaveLength(2)
    reader.push(new Blob(['final']))
    reader.close()
    const result = await uploader.wait()
    expect(result).toMatchObject({ uuid: '3', size: initial.length + 5, type: 'video/webm' })
    expect(await new Blob(server.uploads[2].chunks).arrayBuffer()).toEqual(
      await new Blob([initial, 'final']).arrayBuffer()
    )
  })

  test.each([423, 'network'] as const)('retries PATCH %s even when navigator is offline', async (failure) => {
    const server = new RecordingServer()
    let failed = false
    server.intercept = (method) => {
      if (method === 'PATCH' && !failed) {
        failed = true
        return failure
      }
    }
    const { reader, uploader } = create(server)
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
    reader.push(new Blob(['recording']))
    reader.close()
    uploader.start()
    await until(() => failed)
    await jest.advanceTimersByTimeAsync(0)
    const result = await uploader.wait()
    expect(result).toMatchObject({ uuid: '1', size: 9 })
  })

  test('403 recovers once; a second failure settles early and discards future chunks', async () => {
    const server = new RecordingServer()
    server.intercept = (method) => (method === 'POST' ? 403 : undefined)
    const { reader, uploader } = create(server)
    uploader.start()
    await until(() => server.requests.length > 0)
    reader.push(new Blob(['late final chunk']))
    reader.close()
    await expect(uploader.wait()).rejects.toThrow()
    expect(server.requests.filter((r) => r.method === 'POST')).toHaveLength(2)
    reader.push(new Blob(['later']))
    expect(reader).toMatchObject({ chunks: [], sent: [] })
  })

  test('overflow while waiting for close fails promptly and releases queued data', async () => {
    const server = new RecordingServer()
    server.intercept = (method) => (method === 'POST' ? 403 : undefined)
    const { reader, uploader } = create(server, 3)
    uploader.start()
    await until(() => server.requests.length > 0)
    await jest.advanceTimersByTimeAsync(0)
    reader.push(new Blob(['exceeds cap']))
    await expect(uploader.wait()).rejects.toThrow('retention limit')
    for (let i = 0; i < 100; i++) reader.push(new Blob(['later']))
    expect(reader).toMatchObject({ chunks: [], sent: [] })
    expect(server.requests.filter((r) => r.method === 'POST')).toHaveLength(1)
  })

  test.each(['close', 'online', 'DELETE'])('cancel while awaiting %s prevents a late POST', async (phase) => {
    const server = new RecordingServer()
    server.intercept = (method) => {
      if (method === 'PATCH') return 403
      if (method === 'DELETE') return 'hang'
    }
    const { reader, uploader } = create(server)
    reader.push(new Blob(['recording']))
    if (phase === 'online') reader.close()
    if (phase === 'online') {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
    }
    uploader.start()
    // A small live stream needs more data before tus sends a PATCH.
    if (phase !== 'online') reader.push(new Blob([new Uint8Array(3 * 1024 * 1024)]))
    await until(() => server.requests.some((r) => r.method === 'DELETE'))
    await uploader.cancel()
    await expect(uploader.wait()).rejects.toBeInstanceOf(UploadCancelledError)
    const posts = server.requests.filter((r) => r.method === 'POST').length
    reader.close()
    window.dispatchEvent(new Event('online'))
    await jest.advanceTimersByTimeAsync(RECOVERY_OFFLINE_DEADLINE_MS)
    expect(server.requests.filter((r) => r.method === 'POST')).toHaveLength(posts)
  })

  test.each([false, true])('offline recovery reconnects before deadline = %s', async (reconnect) => {
    const server = new RecordingServer()
    let failed = false
    server.intercept = (method) => {
      if (method === 'POST' && !failed) {
        failed = true
        return 403
      }
    }
    const { reader, uploader } = create(server)
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
    reader.push(new Blob(['all bytes']))
    reader.close()
    uploader.start()
    await until(() => failed)
    await jest.advanceTimersByTimeAsync(0)
    if (reconnect) {
      window.dispatchEvent(new Event('online'))
      expect((await uploader.wait()).size).toBe(9)
    } else {
      await jest.advanceTimersByTimeAsync(RECOVERY_OFFLINE_DEADLINE_MS)
      await expect(uploader.wait()).rejects.toThrow('offline deadline')
      window.dispatchEvent(new Event('online'))
      expect(server.requests.filter((r) => r.method === 'POST')).toHaveLength(1)
    }
  })

  test.each(['POST', 'HEAD', 'PATCH'])('never-resolving %s requests exhaust a bounded budget', async (hung) => {
    const server = new RecordingServer()
    server.intercept = (method) => {
      if (method === hung) return 'hang'
      if (hung === 'HEAD' && method === 'PATCH') return 'network'
    }
    const { reader, uploader } = create(server)
    reader.push(new Blob(['all bytes']))
    reader.close()
    uploader.start()
    await until(() => server.requests.length > 0)
    await jest.advanceTimersByTimeAsync(2 * (10 * UPLOAD_REQUEST_TIMEOUT_MS + 180000))
    await expect(uploader.wait()).rejects.toThrow('retry deadline')
  })

  test('a final PATCH taking more than 30 seconds completes without recreating the upload', async () => {
    const server = new RecordingServer()
    server.patchDelayMs = 45000
    let completing = false
    server.intercept = (method, id, headers) => {
      if (method === 'PATCH' && headers['Upload-Length'] !== undefined) completing = true
      return undefined
    }
    const { reader, uploader } = create(server)
    reader.push(new Blob(['all bytes']))
    reader.close()
    uploader.start()
    await until(() => completing)
    await jest.advanceTimersByTimeAsync(45000)
    expect(await uploader.wait()).toMatchObject({ uuid: '1', size: 9 })
    expect(server.uploads).toHaveLength(1)
    expect(server.requests.some((r) => r.method === 'HEAD' || r.method === 'DELETE')).toBe(false)
  })

  test.each([
    { enabled: false, cap: 0 },
    { enabled: true, cap: 3 },
    { enabled: true, cap: 20 * 1024 * 1024 }
  ])('capture error keeps the live upload with recovery options %j', async ({ enabled, cap }) => {
    const server = new RecordingServer()
    const { reader, uploader } = create(server, cap, enabled)
    reader.push(new Blob(['start']))
    uploader.start()
    await until(() => server.uploads.length === 1)
    reader.fail(new Error('capture failure'))
    expect(reader.recordingError?.message).toBe('capture failure')
    reader.push(new Blob(['final']))
    reader.close()
    expect(await uploader.wait()).toMatchObject({ uuid: '1', size: 10 })
    expect(await new Blob(server.uploads[0].chunks).text()).toBe('startfinal')
    expect(server.uploads).toHaveLength(1)
    expect(server.requests.some((r) => r.method === 'DELETE')).toBe(false)
  })

  test('recovery is opt-in: a terminal failure does not replay by default', async () => {
    const server = new RecordingServer()
    server.intercept = (method) => (method === 'POST' ? 403 : undefined)
    const { reader, uploader } = create(server, 0, false)
    reader.push(new Blob(['all bytes']))
    reader.close()
    uploader.start()
    await expect(uploader.wait()).rejects.toThrow()
    expect(server.requests.filter((r) => r.method === 'POST')).toHaveLength(1)
  })
})
