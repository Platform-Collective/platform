// SPDX-License-Identifier: EPL-2.0

import { type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { markupToHtml } from '@hcengineering/text-html'
import { MarkupNodeType } from '@hcengineering/text'
import { tick } from 'svelte'
import HTMLViewer from '../components/HTMLViewer.svelte'
import plugin from '../plugin'

jest.mock('../filetypes', () => ({ getFileMetadata: jest.fn() }))
jest.mock('@hcengineering/text', () => ({
  ...jest.requireActual('@hcengineering/text-core'),
  ...jest.requireActual('../../../../foundations/core/packages/text/src/markup/utils')
}))
jest.mock('@hcengineering/emoji', () => ({ loadParseEmojisFunction: async () => undefined }))

it.each([
  [
    'notification HTML',
    (): string =>
      markupToHtml({
        type: MarkupNodeType.doc,
        content: [
          {
            type: MarkupNodeType.paragraph,
            content: [{ type: MarkupNodeType.image, attrs: { 'file-id': 'blob-id', src: null } }]
          }
        ]
      })
  ],
  ['legacy HTML', (): string => '<img src="platform://platform/files/workspace/?file=blob-id">']
] as const)('renders %s through the production HTML parser and viewer', async (_name, html) => {
  setMetadata(plugin.metadata.WorkspaceUuid, 'workspace' as WorkspaceUuid)
  setMetadata(plugin.metadata.FileStorage, {
    getFileUrl: (_workspace: string, id: string) => `https://storage.example/${id}`,
    getCookiePath: jest.fn(),
    getFileMeta: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn()
  })
  const target = document.createElement('div')
  const viewer = new HTMLViewer({ target, props: { value: html() } })
  try {
    await tick()
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/blob-id')
  } finally {
    viewer.$destroy()
    setMetadata(plugin.metadata.WorkspaceUuid, undefined)
    setMetadata(plugin.metadata.FileStorage, undefined)
  }
})
