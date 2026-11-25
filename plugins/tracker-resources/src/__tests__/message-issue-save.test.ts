// SPDX-License-Identifier: EPL-2.0

import type { Attachment } from '@hcengineering/attachment'
import type { AttachedData, Blob, Ref, WorkspaceUuid } from '@hcengineering/core'
import {
  addEventListener,
  PlatformEvent,
  removeEventListener,
  setMetadata,
  Severity,
  Status
} from '@hcengineering/platform'
import presentation, { createFileStorage } from '@hcengineering/presentation'

import { copyMessageAttachments, getMessageIssueData, isMessageAttachmentWithinSizeLimit } from '../message-issue'
import tracker from '../plugin'

// Load the actual file API without loading the Svelte components in the package entry point.
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: jest.requireActual('@hcengineering/presentation/src/plugin').default,
  ...jest.requireActual('@hcengineering/presentation/src/file'),
  ...jest.requireActual('@hcengineering/presentation/src/file-blob')
}))
jest.mock('@hcengineering/presentation/src/filetypes', () => ({ getFileMetadata: jest.fn() }))

describe('saving attachments from a message', () => {
  const storeUrl = 'https://files.example'
  const limit = 25 * 1024 * 1024
  const downloaded: AttachedData<Attachment> = {
    file: 'downloaded' as Ref<Blob>,
    name: 'image.png',
    size: 0,
    type: 'image/png',
    lastModified: 0
  }
  const declared = { ...downloaded, file: 'declared' as Ref<Blob>, size: limit + 1 }
  const omittedWarning = new Status(Severity.WARNING, tracker.string.MessageAttachmentsTooLarge, { limit: 25 })
  const listener = jest.fn(async () => {})

  function issueDescription (source: Array<AttachedData<Attachment>>): string {
    const message = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Before ' },
            ...source.map(({ file }) => ({
              type: 'image',
              attrs: { 'file-id': file, src: `image://${file}` }
            })),
            { type: 'text', text: 'after' }
          ]
        }
      ]
    })
    return getMessageIssueData(message, 'https://app.example/source', 'Original message', 'New issue', source)
      .description
  }

  beforeEach(() => {
    listener.mockClear()
    addEventListener(PlatformEvent, listener)
    setMetadata(presentation.metadata.FrontUrl, 'https://app.example')
    setMetadata(presentation.metadata.UploadURL, storeUrl)
    setMetadata(presentation.metadata.WorkspaceUuid, 'workspace' as WorkspaceUuid)
  })

  afterEach(() => {
    removeEventListener(PlatformEvent, listener)
    jest.restoreAllMocks()
    setMetadata(presentation.metadata.FileStorage, undefined)
    setMetadata(presentation.metadata.FrontUrl, undefined)
    setMetadata(presentation.metadata.UploadURL, undefined)
    setMetadata(presentation.metadata.DatalakeUrl, undefined)
    setMetadata(presentation.metadata.HulylakeUrl, undefined)
    setMetadata(presentation.metadata.WorkspaceUuid, undefined)
  })

  it.each([
    { expectedPath: '/workspace/image.png?file=downloaded&workspace=workspace', includeDeclared: false },
    { expectedPath: '/blob/workspace/downloaded/image.png', datalakeUrl: storeUrl, includeDeclared: true },
    { expectedPath: '/api/workspace/downloaded', hulylakeUrl: storeUrl, includeDeclared: false }
  ])('warns once when the storage response is too large at $expectedPath', async (config) => {
    const { datalakeUrl, hulylakeUrl, expectedPath, includeDeclared } = config
    setMetadata(presentation.metadata.DatalakeUrl, datalakeUrl)
    setMetadata(presentation.metadata.HulylakeUrl, hulylakeUrl)
    setMetadata(presentation.metadata.FileStorage, createFileStorage(storeUrl, datalakeUrl, hulylakeUrl))
    const fetchFile = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(limit + 1)))
    const source = includeDeclared ? [downloaded, declared] : [downloaded]
    const description = issueDescription(source)

    const saved = await copyMessageAttachments(source.filter(isMessageAttachmentWithinSizeLimit), description, source)

    expect(saved.attachments).toEqual([])
    expect(saved.description).not.toContain(downloaded.file)
    expect(saved.description).not.toContain(declared.file)
    expect(saved.description).toContain('Before ')
    expect(saved.description).toContain('after')
    expect(fetchFile).toHaveBeenCalledTimes(1)
    expect(fetchFile).toHaveBeenCalledWith(storeUrl + expectedPath, { headers: {} })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(PlatformEvent, omittedWarning)
  })

  it('warns once when only the declared size excludes an attachment', async () => {
    const fetchFile = jest.spyOn(globalThis, 'fetch')
    const description = issueDescription([declared])

    const saved = await copyMessageAttachments([], description, [declared])

    expect(saved.attachments).toEqual([])
    expect(saved.description).not.toContain(declared.file)
    expect(fetchFile).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(PlatformEvent, omittedWarning)
  })

  it('does not warn when a file was removed from both the attachment list and description', async () => {
    const description = JSON.stringify({ type: 'doc', content: [] })

    expect(await copyMessageAttachments([], description, [downloaded])).toEqual({ attachments: [], description })
    expect(listener).not.toHaveBeenCalled()
  })
})
