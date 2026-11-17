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

const mockCreateDoc = jest.fn()
const mockUpdateDoc = jest.fn()
const mockUploadMarkup = jest.fn()
const mockUpdateMarkup = jest.fn()
const mockGetResource = jest.fn()

jest.mock('@hcengineering/account-client', () => ({
  getClient: jest.fn(() => ({
    getSocialIds: jest.fn(async () => [{ _id: 'person-id' }]),
    selectWorkspace: jest.fn(async () => ({ account: 'account-id', role: 'User', workspace: 'workspace-id' }))
  }))
}))

jest.mock('@hcengineering/client', () => ({
  __esModule: true,
  default: { function: { GetClient: 'GetClient' } },
  clientId: 'client-id'
}))

jest.mock('@hcengineering/core', () => ({
  TxOperations: jest.fn(() => ({ createDoc: mockCreateDoc, updateDoc: mockUpdateDoc })),
  generateId: jest.fn(() => 'generated-id'),
  pickPrimarySocialId: jest.fn((socialIds) => socialIds[0])
}))

jest.mock('@hcengineering/platform', () => ({
  addLocation: jest.fn(),
  getResource: mockGetResource
}))

jest.mock('../config', () => ({
  loadServerConfig: jest.fn(async () => ({ ACCOUNTS_URL: 'https://accounts.example.com' }))
}))

jest.mock('../markup', () => {
  const actual = jest.requireActual('../markup')
  return {
    ...actual,
    createMarkupOperations: jest.fn(() => ({ uploadMarkup: mockUploadMarkup, updateMarkup: mockUpdateMarkup }))
  }
})

jest.mock('../utils', () => ({
  getWorkspaceToken: jest.fn(async () => ({ endpoint: 'wss://endpoint.example.com', token: 'token' }))
}))

import { connect } from '../client'
import { MarkupContent } from '../markup'

describe('PlatformClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetResource.mockResolvedValue(async () => ({ close: jest.fn() }))
    mockUploadMarkup.mockResolvedValue('markup-ref')
    mockUpdateMarkup.mockResolvedValue(undefined)
    mockCreateDoc.mockResolvedValue('document-id')
    mockUpdateDoc.mockResolvedValue({})
  })

  it('waits for markup uploads before creating a document', async () => {
    const platformClient = await connect('https://api.example.com', {
      token: 'token',
      workspace: 'workspace'
    })

    await platformClient.createDoc('class:test.Doc' as any, 'space-id' as any, {
      description: new MarkupContent('Description', 'markup')
    })

    expect(mockCreateDoc).toHaveBeenCalledWith(
      'class:test.Doc',
      'space-id',
      { description: 'markup-ref' },
      'generated-id'
    )
  })

  it('updates existing markup without creating a collaborator document', async () => {
    const platformClient = await connect('https://api.example.com', {
      token: 'token',
      workspace: 'workspace'
    })

    await platformClient.updateDoc(
      'class:test.Doc' as any,
      'space-id' as any,
      'document-id' as any,
      { description: new MarkupContent('Updated description', 'markup'), title: 'Updated title' } as any
    )

    expect(mockUpdateMarkup).toHaveBeenCalledWith(
      'class:test.Doc',
      'document-id',
      'description',
      'Updated description',
      'markup'
    )
    expect(mockUploadMarkup).not.toHaveBeenCalled()
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      'class:test.Doc',
      'space-id',
      'document-id',
      { title: 'Updated title' },
      undefined
    )
  })
})
