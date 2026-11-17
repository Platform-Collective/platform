//
// SPDX-License-Identifier: EPL-2.0
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

import core, { type Doc, type Ref, type WorkspaceUuid, makeCollabId } from '@hcengineering/core'
import { PlatformError } from '@hcengineering/platform'
import * as publicApi from '../index'

describe('collaborator HTTP errors', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each([401, 403])('preservesTypedHttpStatusWithoutLoggingToken (%i)', async (status) => {
    const token = 'sentinel-token'
    const endpoint = 'https://collaborator.example.com'
    const body = 'response-body-detail; stack: response-stack-detail'
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(body, {
          status,
          statusText: `${token} ${endpoint} ${body}`
        })
    )
    const client = publicApi.getClient('workspace' as WorkspaceUuid, token, endpoint)
    const document = makeCollabId(core.class.Doc, 'document' as Ref<Doc>, 'content')
    const operations: Array<() => Promise<unknown>> = [
      async () => await client.getMarkup(document),
      async () => await client.createMarkup(document, 'content'),
      async () => {
        await client.updateMarkup(document, 'content')
      },
      async () => {
        await client.copyContent(document, document)
      }
    ]

    for (const operation of operations) {
      const failure: unknown = await operation().catch((error: unknown) => error)
      expect(failure).toHaveProperty('httpStatus', status)
      expect(failure).toBeInstanceOf(Reflect.get(publicApi, 'CollaboratorHttpError'))
      expect(failure).toBeInstanceOf(Error)
      expect(failure).toBeInstanceOf(PlatformError)
      expect((failure as Error).message).toBe(`HTTP error ${status}`)
      expect(failure).toHaveProperty('name', 'CollaboratorHttpError')
      expect((failure as { retryAfterMs?: number }).retryAfterMs).toBeUndefined()
      expect((failure as { outcomeUnknown?: boolean }).outcomeUnknown).toBeUndefined()
      expect((failure as { rejectedBeforeWrite?: boolean }).rejectedBeforeWrite).toBeUndefined()
    }
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(errorLog).not.toHaveBeenCalled()
  })
})
