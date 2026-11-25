// SPDX-License-Identifier: EPL-2.0

import type { Card } from '@hcengineering/card'
import type { Ref } from '@hcengineering/core'
import type * as PlatformModule from '@hcengineering/platform'
import type * as WorkbenchModule from '@hcengineering/workbench'
import type * as MissingDocument from '../missingDocument'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

interface MissingDocumentHarness {
  handle: (isCurrent?: () => boolean) => void
  missingDocument: jest.Mock
  fallback: jest.Mock
  resolveResources: () => void
  rejectResources: (reason: Error) => void
}

function deferred<T> (): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

function createHarness (): MissingDocumentHarness {
  jest.resetModules()
  const platform = jest.requireActual<typeof PlatformModule>('@hcengineering/platform')
  const workbenchModule = jest.requireActual<typeof WorkbenchModule>('@hcengineering/workbench')
  const { handleMissingCardDocument } = jest.requireActual<typeof MissingDocument>('../missingDocument')
  const loading = deferred<PlatformModule.Resources>()
  const missingDocument = jest.fn((_objectId: string) => false)
  const fallback = jest.fn()

  platform.addLocation(workbenchModule.workbenchId, async () => ({
    default: async () => await loading.promise
  }))

  return {
    handle: (isCurrent = () => true) => {
      handleMissingCardDocument('card-a' as Ref<Card>, isCurrent, fallback)
    },
    missingDocument,
    fallback,
    resolveResources: () => {
      loading.resolve({
        function: {
          HandleMissingTabDocument: (objectId: string) => missingDocument(objectId)
        }
      })
    },
    rejectResources: (reason: Error) => {
      loading.reject(reason)
    }
  }
}

async function settleResources (): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Card editor missing document handling', () => {
  it('ignores a delayed resource result after the query context becomes inactive', async () => {
    const harness = createHarness()
    let current = true
    harness.handle(() => current)

    current = false
    harness.resolveResources()
    await settleResources()

    expect(harness.missingDocument).not.toHaveBeenCalled()
    expect(harness.fallback).not.toHaveBeenCalled()
  })

  it('keeps the editor fallback when resource loading fails', async () => {
    const harness = createHarness()
    harness.handle()

    harness.rejectResources(new Error('Resource load failed'))
    await settleResources()

    expect(harness.fallback).toHaveBeenCalledTimes(1)
  })

  it('does not run the fallback for a handled document', async () => {
    const harness = createHarness()
    harness.missingDocument.mockReturnValue(true)
    harness.handle()

    harness.resolveResources()
    await settleResources()

    expect(harness.missingDocument).toHaveBeenCalledWith('card-a')
    expect(harness.fallback).not.toHaveBeenCalled()
  })

  it('keeps the editor fallback for an active unmatched document', async () => {
    const harness = createHarness()
    harness.handle()

    harness.resolveResources()
    await settleResources()

    expect(harness.missingDocument).toHaveBeenCalledWith('card-a')
    expect(harness.fallback).toHaveBeenCalledTimes(1)
  })
})
