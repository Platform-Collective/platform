// SPDX-License-Identifier: EPL-2.0

import { type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { getFileUrl } from '../file'
import plugin from '../plugin'

jest.mock('../filetypes', () => ({ getFileMetadata: jest.fn() }))

it('resolves a legacy source passed directly by image actions to getFileUrl', () => {
  const getStorageUrl = jest.fn((_workspace: string, id: string) => `https://storage.example/${encodeURIComponent(id)}`)
  setMetadata(plugin.metadata.WorkspaceUuid, 'workspace' as WorkspaceUuid)
  setMetadata(plugin.metadata.FileStorage, {
    getFileUrl: getStorageUrl,
    getCookiePath: jest.fn(),
    getFileMeta: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn()
  })
  try {
    expect(getFileUrl('platform://platform/files/workspace/?file=folder%2Fimage%20%2B.png')).toBe(
      'https://storage.example/folder%2Fimage%20%2B.png'
    )
    expect(getStorageUrl).toHaveBeenCalledWith('workspace', 'folder/image +.png', undefined)
  } finally {
    setMetadata(plugin.metadata.WorkspaceUuid, undefined)
    setMetadata(plugin.metadata.FileStorage, undefined)
  }
})
