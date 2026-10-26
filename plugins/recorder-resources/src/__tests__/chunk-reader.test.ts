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

import { ChunkReader } from '../chunk-reader'

describe('ChunkReader', () => {
  let chunkReader: ChunkReader

  beforeEach(() => {
    chunkReader = new ChunkReader()
  })

  test('Initial state: read returns done when no chunks and closed', async () => {
    chunkReader.close()
    const result = await chunkReader.read()
    expect(result).toEqual({ done: true, value: undefined })
  })

  test('Read returns pushed chunks', async () => {
    const blob1 = new Blob(['chunk1'])
    const blob2 = new Blob(['chunk2'])

    chunkReader.push(blob1)
    chunkReader.push(blob2)

    const result1 = await chunkReader.read()
    expect(result1).toEqual({ done: false, value: blob1 })

    const result2 = await chunkReader.read()
    expect(result2).toEqual({ done: false, value: blob2 })
  })

  test('Read waits for chunks if none are available', async () => {
    const blob = new Blob(['chunk'])

    // Start reading before pushing a chunk
    const readPromise = chunkReader.read()

    // Push a chunk after a delay
    setTimeout(() => {
      chunkReader.push(blob)
    }, 10)

    const result = await readPromise
    expect(result).toEqual({ done: false, value: blob })
  })

  test('Close resolves pending read with done', async () => {
    const readPromise = chunkReader.read()

    setTimeout(() => {
      chunkReader.close()
    }, 10)

    const result = await readPromise
    expect(result).toEqual({ done: true, value: undefined })
  })

  test('Push resolves pending read with the chunk', async () => {
    const blob = new Blob(['chunk'])

    const readPromise = chunkReader.read()

    setTimeout(() => {
      chunkReader.push(blob)
    }, 10)

    const result = await readPromise
    expect(result).toEqual({ done: false, value: blob })
  })

  test('Read returns done after all chunks are read and reader is closed', async () => {
    const blob = new Blob(['chunk'])

    chunkReader.push(blob)
    chunkReader.close()

    const result1 = await chunkReader.read()
    expect(result1).toEqual({ done: false, value: blob })

    const result2 = await chunkReader.read()
    expect(result2).toEqual({ done: true, value: undefined })
  })
})

describe('ChunkReader recovery', () => {
  test('replays consumed, queued and final chunks only after close', async () => {
    const reader = new ChunkReader(20)
    reader.push(new Blob(['first']))
    await reader.read()
    reader.push(new Blob(['second']))
    expect(() => reader.replayBlob()).toThrow()
    reader.beginRecovery()
    reader.push(new Blob(['final']))
    reader.close()
    await reader.closed
    expect(await reader.replayBlob().text()).toBe('firstsecondfinal')
  })

  test('cap counts queued and consumed bytes exactly once and preserves the live consumer', async () => {
    const reader = new ChunkReader(6)
    reader.push(new Blob(['abc']))
    await reader.read()
    reader.push(new Blob(['def']))
    expect(reader.recoverable).toBe(true)
    reader.push(new Blob(['g']))
    expect(reader.recoverable).toBe(false)
    expect(await (await reader.read()).value?.text()).toBe('def')
    expect(await (await reader.read()).value?.text()).toBe('g')
    reader.close()
  })

  test('overflow without a consumer promptly discards the queue and all future pushes', async () => {
    const reader = new ChunkReader(3)
    const unavailable = jest.fn()
    reader.onRecoveryUnavailable = unavailable
    reader.beginRecovery()
    reader.push(new Blob(['abc']))
    for (let i = 0; i < 100; i++) reader.push(new Blob(['more']))
    expect(unavailable).toHaveBeenCalledTimes(1)
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    expect(() => reader.replayBlob()).toThrow()
    expect(reader).toMatchObject({ chunks: [], sent: [], retainedBytes: 0 })
    await reader.closed
  })

  test('release resolves pending reads and close waiters, and ignores future pushes', async () => {
    const reader = new ChunkReader(10)
    const pending = reader.read()
    reader.release()
    reader.push(new Blob(['late']))
    expect(await pending).toEqual({ done: true, value: undefined })
    await reader.closed
    expect(reader).toMatchObject({ chunks: [], sent: [], retainedBytes: 0 })
  })

  test('recording error does not close the stream before its final chunk', async () => {
    const reader = new ChunkReader(100)
    const error = jest.fn()
    reader.onError = error
    reader.push(new Blob(['start']))
    reader.fail(new Error('capture failed'))
    reader.push(new Blob(['final']))
    reader.close()
    expect(error).toHaveBeenCalledTimes(1)
    expect(await reader.replayBlob().text()).toBe('startfinal')
  })
})
