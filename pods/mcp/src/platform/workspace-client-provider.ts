// SPDX-License-Identifier: EPL-2.0

import { createRestTxOperations } from '@hcengineering/api-client'
import { type MeasureContext, type TxOperations } from '@hcengineering/core'

import { type SessionIdentity } from '../auth/authenticator'
import { type AccountApi, type AccountApiFactory } from './account-api'
import { type MarkupReader, type MarkupWriter } from './markup-reader'
import { fromMarkup } from './markup'

/** Everything a tool needs to talk to one workspace on behalf of one user. */
export interface WorkspaceSession {
  client: TxOperations
  /** Account-service calls (members, roles, workspace settings), made as the caller. */
  accounts: AccountApi
  identity: SessionIdentity
  markup: MarkupReader
  /** Undefined when no collaborator service is configured. */
  markupWriter?: MarkupWriter
}

export interface WorkspaceClientProvider {
  get: (identity: SessionIdentity) => Promise<WorkspaceSession>
  close: () => Promise<void>
}

/** Injected so tests can supply a fake TxOperations without a live platform. */
export type ClientFactory = (identity: SessionIdentity) => Promise<TxOperations>

export interface WorkspaceClientProviderOptions {
  ctx: MeasureContext
  createClient?: ClientFactory
  createAccounts: AccountApiFactory
  createMarkupReader?: (identity: SessionIdentity) => MarkupReader
  createMarkupWriter?: (identity: SessionIdentity) => MarkupWriter | undefined
  /** Idle time after which a cached client is closed, in milliseconds. */
  idleTtlMs?: number
  /** How often idle entries are swept, in milliseconds. */
  sweepIntervalMs?: number
  now?: () => number
}

interface CacheEntry {
  session: WorkspaceSession
  lastUsed: number
}

const DEFAULT_IDLE_TTL_MS = 10 * 60_000
const DEFAULT_SWEEP_INTERVAL_MS = 60_000

/**
 * Cache key for one client: account, workspace, privilege class.
 *
 * The read-only flag is part of the key on purpose. A `WorkspaceSession`
 * carries the identity (and the workspace token) of whoever populated the
 * cache, so a read-only token sharing a key with a full-access token would get
 * a session whose `readOnly` says `false` and whose token can write — the
 * read-only gate would open for the wrong request. `ro` / `rw` keeps the key
 * short but readable in log output.
 */
const keyOf = (identity: SessionIdentity): string =>
  `${identity.account}:${identity.workspace}:${identity.readOnly ? 'ro' : 'rw'}`

/**
 * Re-labels a cached session with the identity of the request being served.
 *
 * The expensive parts (client, account API, markup reader) stay shared — the
 * key already guarantees the two identities have the same account, workspace
 * and privilege class. What must NOT be shared is the identity itself: tools
 * and the read-only gate read `readOnly` and `workspaceToken` off it, and
 * those must describe this request, not whichever request filled the cache.
 */
const withCallerIdentity = (session: WorkspaceSession, identity: SessionIdentity): WorkspaceSession =>
  identity === session.identity ? session : { ...session, identity }

/**
 * Caches one `TxOperations` per (account, workspace, read-only flag).
 *
 * Building a client is not cheap: `createRestTxOperations` fetches the account
 * and the full workspace model over HTTP. MCP sessions are long lived and many
 * tools fire back to back, so a per-request client would multiply that cost by
 * an order of magnitude.
 *
 * Caching per *account* (not just per workspace) matters for correctness, not
 * just speed: a client is bound to a social id, and every write is attributed
 * to that social id. Sharing one client between users would attribute their
 * edits to whoever happened to populate the cache first. The same logic
 * applies to the read-only flag: two entries, two privilege classes, no
 * cross-contamination.
 */
export class CachingWorkspaceClientProvider implements WorkspaceClientProvider {
  private readonly ctx: MeasureContext
  private readonly createClient: ClientFactory
  private readonly createAccounts: AccountApiFactory
  private readonly createMarkupReader: (identity: SessionIdentity) => MarkupReader
  private readonly createMarkupWriter: (identity: SessionIdentity) => MarkupWriter | undefined
  private readonly idleTtlMs: number
  private readonly now: () => number
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<WorkspaceSession>>()
  private readonly sweeper: ReturnType<typeof setInterval>

  constructor (options: WorkspaceClientProviderOptions) {
    this.ctx = options.ctx
    this.createClient = options.createClient ?? defaultClientFactory
    this.createAccounts = options.createAccounts
    this.createMarkupReader = options.createMarkupReader ?? defaultMarkupReaderFactory
    this.createMarkupWriter = options.createMarkupWriter ?? (() => undefined)
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
    this.now = options.now ?? Date.now

    this.sweeper = setInterval(() => {
      void this.sweep()
    }, options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS)
    // Never hold the event loop open just for the sweeper.
    this.sweeper.unref?.()
  }

  async get (identity: SessionIdentity): Promise<WorkspaceSession> {
    const key = keyOf(identity)

    const cached = this.cache.get(key)
    if (cached !== undefined) {
      cached.lastUsed = this.now()
      return withCallerIdentity(cached.session, identity)
    }

    // Collapse concurrent first-hits for the same identity into one build,
    // otherwise a burst of parallel tool calls each loads the whole model.
    const existing = this.inFlight.get(key)
    if (existing !== undefined) return withCallerIdentity(await existing, identity)

    const creation = (async (): Promise<WorkspaceSession> => {
      const client = await this.createClient(identity)
      const session: WorkspaceSession = {
        client,
        accounts: this.createAccounts(identity),
        identity,
        markup: this.createMarkupReader(identity),
        markupWriter: this.createMarkupWriter(identity)
      }
      this.cache.set(key, { session, lastUsed: this.now() })
      return session
    })()

    this.inFlight.set(key, creation)
    try {
      return await creation
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async sweep (): Promise<void> {
    const cutoff = this.now() - this.idleTtlMs
    for (const [key, entry] of [...this.cache]) {
      if (entry.lastUsed > cutoff) continue
      this.cache.delete(key)
      try {
        await entry.session.client.close()
      } catch (err) {
        this.ctx.warn('mcp workspace client close failed', { key, error: (err as Error)?.message })
      }
    }
  }

  async close (): Promise<void> {
    clearInterval(this.sweeper)
    const entries = [...this.cache.values()]
    this.cache.clear()
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await entry.session.client.close()
        } catch {
          // Shutdown is best effort; a stuck client must not block the exit.
        }
      })
    )
  }

  /** Test and diagnostic helper. */
  get size (): number {
    return this.cache.size
  }
}

const defaultClientFactory: ClientFactory = async (identity) =>
  await createRestTxOperations(identity.transactorUrl, identity.workspace, identity.workspaceToken, true)

const defaultMarkupReaderFactory = (identity: SessionIdentity): MarkupReader => ({
  read: async (ref: string) => fromMarkup(await fetchMarkup(identity.transactorUrl, identity.workspaceToken, ref))
})

/**
 * Reads a markup blob through the transactor's blob endpoint.
 *
 * Issue and document bodies are `MarkupBlobRef`s pointing at the blob store,
 * not inline text, so a tool that wants to show a description has to resolve it.
 * Failures resolve to an empty string: a missing description blob is a data
 * consistency issue, not a reason to fail the whole tool call.
 */
async function fetchMarkup (transactorUrl: string, token: string, ref: string): Promise<string> {
  const url = `${transactorUrl.replace(/\/$/, '')}/api/v1/blob?name=${encodeURIComponent(ref)}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) return ''
  return await response.text()
}
