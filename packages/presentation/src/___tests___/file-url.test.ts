// SPDX-License-Identifier: EPL-2.0

import { type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { type FileStorage } from '@hcengineering/storage-client'

import { getFileUrl } from '../file'
import plugin from '../plugin'

jest.mock('../filetypes', () => ({ getFileMetadata: jest.fn() }))

describe('getFileUrl', () => {
  const storage: FileStorage = {
    getFileUrl: jest.fn(() => 'https://storage.example/current-workspace/image'),
    getCookiePath: jest.fn(),
    getFileMeta: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
    setMetadata(plugin.metadata.WorkspaceUuid, 'current-workspace' as WorkspaceUuid)
    setMetadata(plugin.metadata.FileStorage, storage)
  })

  afterEach(() => {
    setMetadata(plugin.metadata.WorkspaceUuid, undefined)
    setMetadata(plugin.metadata.FileStorage, undefined)
  })

  it.each([
    ['platform://platform/files/workspace/?file=image-id', 'image-id'],
    ['platform://platform/files/workspace/?file=folder%2Fimage%20%2B.png&size=400', 'folder/image +.png'],
    ['platform://platform/files/workspace/?size=400&file=image-id', 'image-id'],
    ['image-id', 'image-id']
  ])('resolves %s through current workspace storage', (file, id) => {
    expect(getFileUrl(file, 'image.png')).toBe('https://storage.example/current-workspace/image')
    expect(storage.getFileUrl).toHaveBeenCalledWith('current-workspace', id, 'image.png')
  })

  it.each([
    'https://images.example/image.png?file=external',
    'http://images.example/image.png',
    'blob:https://images.example/image',
    'platform://platform/files/workspace/',
    'platform://platform/files/workspace/?file=',
    'platform://other/files/workspace/?file=image-id',
    'platform://platform/other/?file=image-id'
  ])('preserves %s', (file) => {
    expect(getFileUrl(file)).toBe(file)
    expect(storage.getFileUrl).not.toHaveBeenCalled()
  })
})
