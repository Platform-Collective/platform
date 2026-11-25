// SPDX-License-Identifier: EPL-2.0

import type { Attachment } from '@hcengineering/attachment'
import type { AttachedData, Blob, Markup, Ref } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import presentation, { deleteFile, generateFileId, getFileUrl, uploadFile } from '@hcengineering/presentation'
import { jsonToMarkup } from '@hcengineering/text'
import { markdownToMarkup } from '@hcengineering/text-markdown'
import {
  classifyMessageAttachments,
  copyMessageAttachments,
  getMessageAttachmentData,
  getMessageIssueData
} from '../message-issue'

jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: {
    metadata: {
      Token: 'token',
      FrontUrl: 'frontUrl',
      UploadURL: 'uploadUrl',
      DatalakeUrl: 'datalakeUrl',
      HulylakeUrl: 'hulylakeUrl'
    }
  },
  authorizationHeaders: jest.requireActual('@hcengineering/presentation/src/file-blob').authorizationHeaders,
  deleteFile: jest.fn(),
  generateFileId: jest.fn(),
  getFileUrl: jest.fn(),
  uploadFile: jest.fn()
}))

function markup (content: unknown[]): Markup {
  return JSON.stringify({ type: 'doc', content })
}

function paragraph (text: string): object {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

describe('getMessageIssueData', () => {
  const sourceUrl = 'https://huly.example/workbench/ws/chunter/channel?message=message-id'

  it('uses the first nonempty line for the title and preserves the rich description', () => {
    const content = [
      { type: 'paragraph' },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '  Fix the bug  ', marks: [{ type: 'bold' }] }]
      },
      paragraph('Details'),
      { type: 'image', attrs: { 'file-id': 'image-blob', src: 'image://image-blob' } }
    ]
    const message = markup(content)
    const result = getMessageIssueData(message, sourceUrl, 'Source message', 'New issue')

    expect(result.title).toBe('Fix the bug')
    expect(JSON.parse(result.description).content).toEqual([
      ...content,
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Source message', marks: [{ type: 'link', attrs: { href: sourceUrl } }] }]
      }
    ])
    expect(JSON.parse(message).content).toEqual(content)
  })

  it('stops at a hard break and keeps reference labels in the title', () => {
    const message = markup([
      {
        type: 'paragraph',
        content: [
          { type: 'reference', attrs: { id: 'id', objectclass: 'class', label: 'Alice' } },
          { type: 'text', text: ': fix this' },
          { type: 'hardBreak' },
          { type: 'text', text: 'More details' }
        ]
      }
    ])
    expect(getMessageIssueData(message, sourceUrl, 'Source message', 'New issue').title).toBe('Alice: fix this')
  })

  it('converts person and everyone references to plain text throughout the description', () => {
    const message = markup([
      {
        type: 'paragraph',
        content: [
          { type: 'reference', attrs: { id: 'everyone', objectclass: 'class', label: '@everyone' } },
          { type: 'text', text: ' and ' },
          {
            type: 'reference',
            attrs: { id: 'alice', objectclass: 'class', label: 'Alice' },
            content: [{ type: 'text', text: 'nested text must not survive' }]
          }
        ]
      }
    ])

    const result = getMessageIssueData(message, sourceUrl, 'Source message', 'New issue')
    expect(result.title).toBe('@everyone and Alice')
    expect(JSON.parse(result.description).content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: '@everyone' },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'Alice' }
      ]
    })
    expect(result.description).not.toContain('"reference"')
  })

  it('uses visible markdown link text when a reference has no label parameter', () => {
    const parsed = markdownToMarkup(
      '[Visible person](ref://?_class=contact%3Aclass%3APerson&_id=person-1) and [Visible team](ref://?_class=contact%3Aclass%3APerson&_id=team-1)'
    )
    const result = getMessageIssueData(jsonToMarkup(parsed), sourceUrl, 'Source message', 'New issue')

    expect(result.title).toBe('Visible person and Visible team')
    expect(JSON.parse(result.description).content[0].content).toEqual([
      { type: 'text', text: 'Visible person' },
      { type: 'text', text: ' and ', marks: [] },
      { type: 'text', text: 'Visible team' }
    ])
    expect(result.description).not.toContain('"text":""')
  })

  it('omits empty references while preserving following text', () => {
    const message = markup([
      {
        type: 'paragraph',
        content: [
          { type: 'reference', attrs: { id: 'missing', objectclass: 'class', label: '' } },
          { type: 'text', text: 'Details remain' }
        ]
      }
    ])
    const result = getMessageIssueData(message, sourceUrl, 'Source message', 'New issue')

    expect(result.title).toBe('Details remain')
    expect(JSON.parse(result.description).content[0]).toEqual(paragraph('Details remain'))
  })

  it('truncates long titles to 100 characters without splitting Unicode characters', () => {
    const text = '😀'.repeat(110)
    const result = getMessageIssueData(markup([paragraph(text)]), sourceUrl, 'Source message', 'New issue')
    expect(Array.from(result.title)).toHaveLength(100)
    expect(result.title).toBe('😀'.repeat(99) + '…')
    expect(JSON.parse(result.description).content[0]).toEqual(paragraph(text))
  })

  it('uses the localized fallback for an attachment-only message', () => {
    expect(getMessageIssueData(markup([]), sourceUrl, 'Source message', 'Nouvelle tâche').title).toBe('Nouvelle tâche')
  })
})

describe('getMessageAttachmentData', () => {
  it('copies file references and metadata without copying ownership or document identity', () => {
    const source = {
      _id: 'source-attachment',
      attachedTo: 'source-message',
      space: 'source-space',
      readonly: true,
      name: 'screenshot.png',
      file: 'existing-blob' as Ref<Blob>,
      type: 'image/png',
      size: 123,
      lastModified: 42,
      metadata: { width: 800, height: 600 },
      description: 'Screenshot'
    } as unknown as Attachment

    expect(getMessageAttachmentData(source)).toEqual({
      name: source.name,
      file: source.file,
      type: source.type,
      size: source.size,
      lastModified: source.lastModified,
      metadata: source.metadata,
      description: source.description
    })
    expect(source.attachedTo).toBe('source-message')
  })
})

describe('copyMessageAttachments', () => {
  const source: AttachedData<Attachment> = {
    name: 'screenshot.png',
    file: 'source-blob' as Ref<Blob>,
    type: 'image/png',
    size: 3,
    lastModified: 42,
    metadata: { width: 800 }
  }
  const description = markup([
    paragraph('Source message'),
    { type: 'paragraph', content: [{ type: 'image', attrs: { 'file-id': source.file, src: 'old-url' } }] },
    { type: 'file', attrs: { 'file-id': source.file, 'data-file-href': 'old-url' } },
    { type: 'image', attrs: { src: 'https://example.com/external.png' } }
  ])
  const originalFetch = globalThis.fetch
  const fetchFile = jest.fn()

  beforeEach(() => {
    jest.resetAllMocks()
    setMetadata(presentation.metadata.Token, 'session-token')
    setMetadata(presentation.metadata.FrontUrl, 'https://huly.example/')
    setMetadata(presentation.metadata.UploadURL, 'https://files.example/files')
    globalThis.fetch = fetchFile
    fetchFile.mockResolvedValue({ ok: true, blob: async () => new globalThis.Blob(['png'], { type: 'image/png' }) })
    jest.mocked(generateFileId).mockReturnValue('copied-blob')
    jest.mocked(getFileUrl).mockImplementation((file) => `https://files.example/${file}`)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    setMetadata(presentation.metadata.Token, undefined)
    setMetadata(presentation.metadata.FrontUrl, undefined)
    setMetadata(presentation.metadata.UploadURL, undefined)
    setMetadata(presentation.metadata.DatalakeUrl, undefined)
    setMetadata(presentation.metadata.HulylakeUrl, undefined)
  })

  it('uploads independent bytes once and remaps inline references without changing the source', async () => {
    const result = await copyMessageAttachments(
      classifyMessageAttachments([source, source]),
      [source, source],
      description
    )

    expect(fetchFile).toHaveBeenCalledWith('https://files.example/source-blob', {
      headers: { Authorization: 'Bearer session-token' }
    })
    expect(uploadFile).toHaveBeenCalledTimes(1)
    const [file, id] = jest.mocked(uploadFile).mock.calls[0]
    expect(id).toBe('copied-blob')
    expect(await file.text()).toBe('png')
    expect(file.name).toBe(source.name)
    expect(file.type).toBe(source.type)
    expect(file.lastModified).toBe(source.lastModified)
    expect(result.attachments).toEqual([{ ...source, file: 'copied-blob' }])
    const content = JSON.parse(result.description).content
    expect(content[1].content[0].attrs).toEqual({
      'file-id': 'copied-blob',
      src: 'https://files.example/copied-blob'
    })
    expect(content[2].attrs['data-file-href']).toBe('https://files.example/copied-blob')
    expect(content[3].attrs.src).toBe('https://example.com/external.png')
    expect(source.file).toBe('source-blob')
    expect(JSON.parse(description).content[1].content[0].attrs['file-id']).toBe('source-blob')
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('retains an independent attachment for source files still embedded in the edited description', async () => {
    const result = await copyMessageAttachments(classifyMessageAttachments([source]), [], description)
    expect(result.attachments).toEqual([{ ...source, file: 'copied-blob' }])
    expect(result.description).not.toContain('source-blob')
  })

  it('skips attachments over 25 MiB before downloading and reports copy progress', async () => {
    const oversized = { ...source, file: 'oversized-blob' as Ref<Blob>, size: 25 * 1024 * 1024 + 1 }
    const progress = jest.fn()

    const result = await copyMessageAttachments(
      classifyMessageAttachments([oversized, source]),
      [oversized, source],
      description,
      progress
    )

    expect(result.attachments).toEqual([{ ...source, file: 'copied-blob' }])
    expect(fetchFile).toHaveBeenCalledTimes(1)
    expect(fetchFile).toHaveBeenCalledWith('https://files.example/source-blob', expect.anything())
    expect(progress).toHaveBeenNthCalledWith(1, 0, 1)
    expect(progress).toHaveBeenNthCalledWith(2, 1, 1)
  })

  it.each([0, 1])(
    'omits an actually oversized file and its inline reference when the declared size is %i',
    async (declaredSize) => {
      const oversized = { ...source, file: 'oversized-blob' as Ref<Blob>, size: declaredSize }
      const inline = markup([
        paragraph('Before'),
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Keep ' },
            { type: 'image', attrs: { 'file-id': oversized.file, src: 'old-url' } },
            { type: 'text', text: 'this text' }
          ]
        },
        paragraph('After')
      ])
      fetchFile.mockResolvedValue(new Response(new Uint8Array(25 * 1024 * 1024 + 1)))

      const result = await copyMessageAttachments(classifyMessageAttachments([oversized]), [oversized], inline)

      expect(result.attachments).toEqual([])
      expect(JSON.parse(result.description).content).toEqual([
        paragraph('Before'),
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Keep ' },
            { type: 'text', text: 'this text' }
          ]
        },
        paragraph('After')
      ])
      expect(uploadFile).not.toHaveBeenCalled()
    }
  )

  it('copies a small file with an unknown declared size and records its actual size', async () => {
    const unknownSize = { ...source, size: 0 }

    const result = await copyMessageAttachments(classifyMessageAttachments([unknownSize]), [unknownSize], description)

    expect(result.attachments).toEqual([{ ...unknownSize, file: 'copied-blob', size: 3 }])
    expect(uploadFile).toHaveBeenCalledTimes(1)
  })

  it('does not copy files removed from both the preview and the description', async () => {
    const edited = markup([paragraph('Edited description')])
    expect(await copyMessageAttachments(classifyMessageAttachments([source]), [], edited)).toEqual({
      attachments: [],
      description: edited,
      sizeOmissions: []
    })
    expect(fetchFile).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it.each(['https://attacker.example/file', '//attacker.example/file', '../file', 'blob/id', 'blob id', 'blob\n'])(
    'drops invalid blob IDs from attachments and inline source files: %j',
    async (file) => {
      const unsafe = { ...source, file: file as Ref<Blob> }
      const inline = markup([{ type: 'image', attrs: { 'file-id': file } }])

      const classified = classifyMessageAttachments([unsafe])
      expect((await copyMessageAttachments(classified, [unsafe], inline)).attachments).toEqual([])
      expect((await copyMessageAttachments(classified, [], inline)).attachments).toEqual([])
      expect(getFileUrl).not.toHaveBeenCalled()
      expect(fetchFile).not.toHaveBeenCalled()
      expect(uploadFile).not.toHaveBeenCalled()
    }
  )

  it.each([
    'https://attacker.example/file',
    'https://files.example.attacker.example/file',
    'http://files.example/file',
    'https://files.example:444/file',
    '//attacker.example/file',
    'https://[invalid'
  ])('skips an unsafe resolved file URL and still copies trusted files: %s', async (url) => {
    const unsafe = { ...source, file: 'unsafe-blob' as Ref<Blob> }
    jest.mocked(getFileUrl).mockImplementation((file) => (file === unsafe.file ? url : `https://files.example/${file}`))

    const result = await copyMessageAttachments(
      classifyMessageAttachments([unsafe, source]),
      [unsafe, source],
      description
    )

    expect(fetchFile).toHaveBeenCalledTimes(1)
    expect(fetchFile).toHaveBeenCalledWith('https://files.example/source-blob', {
      headers: { Authorization: 'Bearer session-token' }
    })
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(result.attachments).toEqual([{ ...source, file: 'copied-blob' }])
  })

  it('resolves relative file URLs against the configured front URL', async () => {
    setMetadata(presentation.metadata.UploadURL, undefined)
    jest.mocked(getFileUrl).mockImplementation((file) => `/files/${file}`)

    const result = await copyMessageAttachments(classifyMessageAttachments([source]), [source], description)
    expect(result.attachments).toHaveLength(1)
    expect(fetchFile).toHaveBeenCalledWith('https://huly.example/files/source-blob', {
      headers: { Authorization: 'Bearer session-token' }
    })
  })

  it.each([presentation.metadata.DatalakeUrl, presentation.metadata.HulylakeUrl])(
    'uses the configured storage endpoint for the trusted origin: %s',
    async (key) => {
      setMetadata(key, 'https://storage.example/base')
      jest.mocked(getFileUrl).mockImplementation((file) => `https://storage.example/blob/${file}`)

      const result = await copyMessageAttachments(classifyMessageAttachments([source]), [source], description)
      expect(result.attachments).toHaveLength(1)
      expect(fetchFile).toHaveBeenCalledWith('https://storage.example/blob/source-blob', {
        headers: { Authorization: 'Bearer session-token' }
      })
    }
  )

  it('cleans up earlier copies if a later source file cannot be downloaded', async () => {
    fetchFile.mockResolvedValueOnce({ ok: true, blob: async () => new globalThis.Blob(['png']) })
    fetchFile.mockResolvedValueOnce({ ok: false, status: 404 })
    const files = [source, { ...source, file: 'missing-blob' as Ref<Blob> }]
    await expect(copyMessageAttachments(classifyMessageAttachments(files), files, description)).rejects.toThrow(
      'Failed to copy message attachment: 404'
    )
    expect(deleteFile).toHaveBeenCalledWith('copied-blob')
    expect(deleteFile).not.toHaveBeenCalledWith('source-blob')
  })

  it('cleans up a failed upload and propagates the original error even if cleanup fails', async () => {
    jest.mocked(uploadFile).mockRejectedValue(new Error('Upload failed'))
    jest.mocked(deleteFile).mockRejectedValue(new Error('Cleanup failed'))
    await expect(copyMessageAttachments(classifyMessageAttachments([source]), [source], description)).rejects.toThrow(
      'Upload failed'
    )
    expect(deleteFile).toHaveBeenCalledWith('copied-blob')
  })
})
