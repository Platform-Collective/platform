/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { type MeasureContext } from '@hcengineering/core'
import { randomUUID as cryptoRandomUUID } from 'node:crypto'

import { type SessionIdentity } from '../auth/authenticator'

/**
 * One MCP client conversation.
 *
 * The identity is resolved at `initialize` and never changes afterwards. A
 * request carrying a different identity than the session's is rejected by the
 * transport, so a session id cannot be replayed under another account.
 */
export class McpSession {
  readonly id: string
  readonly identity: SessionIdentity
  readonly createdOn: number
  protocolVersion: string | undefined
  initialized = false
  lastSeen: number

  constructor (id: string, identity: SessionIdentity, now: number) {
    this.id = id
    this.identity = identity
    this.createdOn = now
    this.lastSeen = now
  }

  touch (now: number): void {
    this.lastSeen = now
  }

  belongsTo (identity: SessionIdentity): boolean {
    return (
      this.identity.account === identity.account && this.identity.workspace === identity.workspace
    )
  }
}

export interface SessionStoreOptions {
  ctx: MeasureContext
  /** Idle time after which a session is dropped, in milliseconds. */
  idleTtlMs?: number
  /** Maximum concurrent sessions, to bound memory. */
  maxSessions?: number
  now?: () => number
  generateId?: () => string
}

const DEFAULT_IDLE_TTL_MS = 30 * 60_000
const DEFAULT_MAX_SESSIONS = 1000

/**
 * In-memory session store.
 *
 * Deliberately not persisted: a restart drops all sessions, and clients recover
 * by re-initializing. Session state here is a cache of an authenticated
 * identity, not a source of truth, so there is nothing worth writing to disk.
 */
export class SessionStore {
  private readonly ctx: MeasureContext
  private readonly sessions = new Map<string, McpSession>()
  private readonly idleTtlMs: number
  private readonly maxSessions: number
  private readonly now: () => number
  private readonly generateId: () => string

  constructor (options: SessionStoreOptions) {
    this.ctx = options.ctx
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
    this.now = options.now ?? Date.now
    this.generateId = options.generateId ?? (() => randomUUID())
  }

  create (identity: SessionIdentity): McpSession {
    if (this.sessions.size >= this.maxSessions) {
      // Evict the least recently used rather than refuse service: an agent
      // reconnecting after a network blip should not be locked out.
      this.evictOldest()
    }

    const session = new McpSession(this.generateId(), identity, this.now())
    this.sessions.set(session.id, session)
    this.ctx.info('mcp session opened', { session: session.id, workspace: identity.workspace })
    return session
  }

  get (id: string): McpSession | undefined {
    const session = this.sessions.get(id)
    if (session === undefined) return undefined
    session.touch(this.now())
    return session
  }

  delete (id: string): boolean {
    const session = this.sessions.get(id)
    if (session === undefined) return false
    this.sessions.delete(id)
    this.ctx.info('mcp session closed', { session: id })
    return true
  }

  /** Drops idle sessions. Returns how many were removed. */
  sweep (): number {
    const cutoff = this.now() - this.idleTtlMs
    let removed = 0
    for (const [id, session] of [...this.sessions]) {
      if (session.lastSeen <= cutoff) {
        this.sessions.delete(id)
        removed += 1
      }
    }
    return removed
  }

  private evictOldest (): void {
    let oldest: McpSession | undefined
    for (const session of this.sessions.values()) {
      if (oldest === undefined || session.lastSeen < oldest.lastSeen) oldest = session
    }
    if (oldest !== undefined) this.sessions.delete(oldest.id)
  }

  get size (): number {
    return this.sessions.size
  }

  closeAll (): void {
    this.sessions.clear()
  }
}

/**
 * Session ids are bearer-equivalent: whoever holds one inherits the session's
 * authenticated identity, so they must be unguessable. `crypto.randomUUID` is
 * the right primitive here, not a hand-rolled Math.random.
 */
function randomUUID (): string {
  return cryptoRandomUUID()
}
