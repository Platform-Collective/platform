//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021 Hardcore Engineering Inc.
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

import { UNAUTHORIZED } from '@hcengineering/platform'
import { RPCHandler, type HelloResponse, type Response } from '@hcengineering/rpc'
import type { LoginInfoWithWorkspaces } from '@hcengineering/account-client'
import { createServer } from 'http'
import { generateToken } from '@hcengineering/server-token'
import WebSocket from 'ws'

import core, {
  AccountRole,
  SocialIdType,
  type AccountUuid,
  Hierarchy,
  MeasureMetricsContext,
  ModelDb,
  toFindResult,
  type Class,
  type Doc,
  type DocumentQuery,
  type Domain,
  type FindOptions,
  type FindResult,
  type MeasureContext,
  type PersonId,
  type PersonUuid,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxResult,
  type WorkspaceUuid
} from '@hcengineering/core'
import { startSessionManager, type SessionManagerOptions } from '@hcengineering/server'
import { createDummyQueue, createDummyStorageAdapter } from '@hcengineering/server-core'
import { startHttpServer } from '../server_http'
import { genMinModel } from './minmodel'

describe('server', () => {
  const port = 10000
  const handler = new RPCHandler()
  async function getModelDb (): Promise<{ modelDb: ModelDb, hierarchy: Hierarchy }> {
    const txes = genMinModel()
    const hierarchy = new Hierarchy()
    for (const tx of txes) {
      hierarchy.tx(tx)
    }
    const modelDb = new ModelDb(hierarchy)
    for (const tx of txes) {
      await modelDb.tx(tx)
    }
    return { modelDb, hierarchy }
  }

  const toolCtx = new MeasureMetricsContext('test', {})
  const opt: SessionManagerOptions = {
    pipelineFactory: async () => {
      const { modelDb, hierarchy } = await getModelDb()
      return {
        hierarchy,
        modelDb,
        context: {} as any,
        handleBroadcast: async (ctx) => {},
        findAll: async <T extends Doc> (
          ctx: MeasureContext,
          _class: Ref<Class<T>>,
          query: DocumentQuery<T>,
          options?: FindOptions<T>
        ): Promise<FindResult<T>> => toFindResult([]),
        tx: async (ctx: MeasureContext, tx: Tx[]): Promise<[TxResult, Tx[], string[] | undefined]> => [
          {},
          [],
          undefined
        ],
        domainRequest: async (ctx, domain, params) => ({ domain, value: null as any }),
        closeSession: async (ctx, sessionId) => {},
        close: async () => {},
        domains: async () => [],
        groupBy: async () => new Map(),
        find: (ctx: MeasureContext, domain: Domain) => ({
          next: async (ctx: MeasureContext) => undefined,
          close: async (ctx: MeasureContext) => {}
        }),
        load: async (ctx: MeasureContext, domain: Domain, docs: Ref<Doc>[]) => [],
        upload: async (ctx: MeasureContext, domain: Domain, docs: Doc[]) => {},
        clean: async (ctx: MeasureContext, domain: Domain, docs: Ref<Doc>[]) => {},
        searchFulltext: async (ctx, query, options) => {
          return { docs: [] }
        },
        loadModel: async (ctx, lastModelTx, hash) => []
      }
    },
    brandingMap: {},
    accountsUrl: '',
    queue: createDummyQueue()
  }
  const sessionMgr = startSessionManager(toolCtx, opt)

  const serverShutdown = startHttpServer(toolCtx, sessionMgr, port, opt.accountsUrl, createDummyStorageAdapter())

  function connect (): WebSocket {
    const token: string = generateToken(
      '123e4567-e89b-12d3-a456-426614174000' as PersonUuid,
      '123e4567-e89b-12d3-a456-426614174001' as WorkspaceUuid
    )
    return new WebSocket(`ws://localhost:${port}/${token}`)
  }

  afterAll(async () => {
    await sessionMgr.closeWorkspaces(new MeasureMetricsContext('test', {}))
    await serverShutdown()
  })

  it('should connect to server', (done) => {
    const conn = connect()
    conn.on('open', () => {
      conn.close(1000)
    })
    conn.on('close', () => {
      done()
    })
  })

  it('should not connect to server without token', (done) => {
    const conn = new WebSocket(`ws://localhost:${port}/xyz`)
    conn.on('error', () => {
      conn.close(1000)
    })
    conn.on('message', (msg: string) => {
      const resp: Response<any> = handler.readResponse(msg, false)
      expect(resp.result === 'hello')
      expect(resp.error?.code).toBe(UNAUTHORIZED.code)
      conn.close(1000)
    })
    conn.on('close', () => {
      done()
    })
  })

  it('should send many requests', (done) => {
    const conn = connect()
    const total = 10
    // const start = Date.now()
    conn.on('open', () => {
      for (let i = 0; i < total; i++) {
        conn.send(handler.serialize({ method: 'tx', params: [], id: i }, false))
      }
    })
    let received = 0
    conn.on('message', (msg: string) => {
      handler.readResponse(msg, false)
      if (++received === total) {
        // console.log('resp:', resp, ' Time: ', Date.now() - start)
        conn.close(1000)
      }
    })
    conn.on('close', () => {
      done()
    })
  })

  it('reconnect', async () => {
    const workspace = '123e4567-e89b-12d3-a456-426614174001' as WorkspaceUuid
    const loginInfo: LoginInfoWithWorkspaces = {
      account: '123e4567-e89b-12d3-a456-426614174000' as AccountUuid,
      name: 'Reconnect test',
      socialIds: [
        {
          _id: 'reconnect-social' as PersonId,
          type: SocialIdType.EMAIL,
          value: 'reconnect@example.test',
          key: 'email:reconnect@example.test',
          personUuid: '123e4567-e89b-12d3-a456-426614174000' as PersonUuid,
          verifiedOn: 1,
          isDeleted: false
        }
      ],
      workspaces: {
        [workspace]: {
          url: 'reconnect-test',
          mode: 'active',
          version: { versionMajor: 0, versionMinor: 7, versionPatch: 0 },
          endpoint: { internalUrl: '', externalUrl: '', region: '' },
          role: AccountRole.User
        }
      }
    }
    const accountCalls: string[] = []
    const accountsServer = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const request = JSON.parse(body)
          accountCalls.push(request.method)
          if (request.method !== 'getLoginWithWorkspaceInfo' && request.method !== 'updateLastVisit') {
            res.writeHead(400)
            res.end()
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ result: request.method === 'getLoginWithWorkspaceInfo' ? loginInfo : null }))
        } catch {
          res.writeHead(400)
          res.end()
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      accountsServer.once('error', reject)
      accountsServer.listen(0, '127.0.0.1', () => resolve())
    })
    const address = accountsServer.address()
    if (address === null || typeof address === 'string') throw new Error('Expected an account fixture TCP address')

    const opt: SessionManagerOptions = {
      pipelineFactory: async () => {
        const { modelDb, hierarchy } = await getModelDb()
        return {
          hierarchy,
          modelDb,
          context: { hierarchy } as any,
          handleBroadcast: async (ctx) => {},
          findAll: async <T extends Doc> (
            ctx: MeasureContext<SessionData>,
            _class: Ref<Class<T>>,
            query: DocumentQuery<T>,
            options?: FindOptions<T>
          ): Promise<FindResult<T>> => {
            const d: Doc & { sessionId: string } = {
              _class: 'result' as Ref<Class<Doc>>,
              _id: '1' as Ref<Doc & { sessionId: string }>,
              space: '' as Ref<Space>,
              modifiedBy: '' as PersonId,
              modifiedOn: Date.now(),
              sessionId: ctx.contextData.sessionId
            }
            return toFindResult([d as unknown as T])
          },
          tx: async (ctx: MeasureContext, tx: Tx[]): Promise<[TxResult, Tx[], string[] | undefined]> => [
            {},
            [],
            undefined
          ],
          domainRequest: async (ctx, domain, params) => ({ domain, value: null as any }),
          closeSession: async (ctx, sessionId) => {},
          groupBy: async () => new Map(),
          close: async () => {},
          domains: async () => [],
          find: (ctx: MeasureContext, domain: Domain) => ({
            next: async (ctx: MeasureContext) => undefined,
            close: async (ctx: MeasureContext) => {}
          }),
          load: async (ctx: MeasureContext, domain: Domain, docs: Ref<Doc>[]) => [],
          upload: async (ctx: MeasureContext, domain: Domain, docs: Doc[]) => {},
          clean: async (ctx: MeasureContext, domain: Domain, docs: Ref<Doc>[]) => {},
          searchFulltext: async (ctx, query, options) => {
            return { docs: [] }
          },
          loadModel: async (ctx, lastModelTx, hash) => []
        }
      },
      brandingMap: {},
      accountsUrl: `http://127.0.0.1:${address.port}`,
      queue: createDummyQueue()
    }
    const reconnectSessionMgr = (() => {
      const previousModelVersion = process.env.MODEL_VERSION
      process.env.MODEL_VERSION = '0.7.0'
      try {
        return startSessionManager(new MeasureMetricsContext('test', {}), opt)
      } finally {
        if (previousModelVersion === undefined) delete process.env.MODEL_VERSION
        else process.env.MODEL_VERSION = previousModelVersion
      }
    })()
    const serverShutdown = startHttpServer(
      toolCtx,
      reconnectSessionMgr,
      port + 1,
      opt.accountsUrl,
      createDummyStorageAdapter()
    )

    async function findClose (
      token: string,
      timeoutPromise: Promise<never>,
      code: number,
      expectedReconnect: boolean
    ): Promise<string> {
      const newConn = new WebSocket(`ws://localhost:${port + 1}/${token}?sessionId=s1`)
      const closed = new Promise<void>((resolve) => {
        newConn.once('close', () => resolve())
      })
      const response = new Promise<string>((resolve, reject) => {
        let helloReceived = false
        newConn.on('error', reject)
        newConn.once('close', () => reject(new Error('Connection closed before the session response')))
        newConn.once('open', () => {
          newConn.send(handler.serialize({ method: 'hello', params: [], id: -1 }, false))
        })
        newConn.on('message', (msg: Buffer) => {
          try {
            const parsedMsg: Response<any> = handler.readResponse(msg.toString(), false)
            expect(parsedMsg.error).toBeUndefined()
            if (parsedMsg.id === -1) {
              expect(helloReceived).toBe(false)
              expect(parsedMsg.result).toBe('hello')
              expect((parsedMsg as HelloResponse).reconnect).toBe(expectedReconnect)
              helloReceived = true
              newConn.send(handler.serialize({ method: 'findAll', params: [core.class.Space, {}], id: 1 }, false))
              return
            }
            expect(helloReceived).toBe(true)
            expect(parsedMsg.id).toBe(1)
            const sessionId = parsedMsg.result?.[0]?.sessionId
            if (typeof sessionId !== 'string' || sessionId.length === 0) {
              reject(new Error('Expected a nonempty session ID in the reconnect response'))
              return
            }
            resolve(sessionId)
          } catch (err: unknown) {
            reject(err)
          }
        })
      })

      try {
        const sessionId = await Promise.race([response, timeoutPromise])
        if (code === 1005) {
          newConn.close()
        } else {
          newConn.close(code)
        }
        await Promise.race([closed, timeoutPromise])
        return sessionId
      } finally {
        if (newConn.readyState !== WebSocket.CLOSED) newConn.terminate()
        await closed
      }
    }

    let clearTo: ReturnType<typeof setTimeout> | undefined

    try {
      //
      const token: string = generateToken(
        '123e4567-e89b-12d3-a456-426614174000' as PersonUuid,
        '123e4567-e89b-12d3-a456-426614174001' as WorkspaceUuid
      )
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        clearTo = setTimeout(() => reject(new Error('Timed out waiting for the reconnect response')), 4000)
      })
      const t1 = await findClose(token, timeoutPromise, 1005, false)
      const t2 = await findClose(token, timeoutPromise, 1000, true)

      expect(t1).toBe(t2)
      expect(accountCalls.filter((method) => method === 'getLoginWithWorkspaceInfo')).toHaveLength(2)
    } finally {
      if (clearTo !== undefined) clearTimeout(clearTo)
      try {
        await serverShutdown()
      } finally {
        accountsServer.closeAllConnections()
        await new Promise<void>((resolve, reject) => {
          accountsServer.close((err) => {
            if (err !== undefined) reject(err)
            else resolve()
          })
        })
      }
    }
  })
})
