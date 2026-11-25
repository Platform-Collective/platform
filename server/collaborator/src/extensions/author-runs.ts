// SPDX-License-Identifier: EPL-2.0

import { generateId } from '@hcengineering/core'
import { createDocFromSnapshot, Doc, snapshot, Snapshot, Transaction } from 'yjs'
import type { Context } from '../context'
import type { AuthorSegment } from '../storage/adapter'

interface Run {
  context: Context
  timestamp: number
  curr?: Snapshot
}

// Bound deferred markup conversions, retained snapshots and activity writes per save.
export const MAX_AUTHOR_RUNS = 16

/** Tracks authenticated submitting authors in server arrival order, including RPC edits. */
export class AuthorRuns {
  private readonly closed: Run[] = []
  private current?: Run
  private timestamp = 0
  private captureFailed = false
  private captures = 0
  private readonly candidates = new Map<Transaction, Snapshot>()

  constructor (
    private readonly document: Doc,
    private readonly getMarkup: (document: Doc) => Record<string, string>,
    private readonly onCaptureError: (error: unknown) => void = () => {}
  ) {
    document.on('beforeTransaction', this.beforeTransaction)
    document.on('afterTransaction', this.afterTransaction)
  }

  private readonly beforeTransaction = (transaction: Transaction): void => {
    const context = this.getContext(transaction)
    if (context !== undefined && this.current !== undefined && this.current.context.account !== context.account) {
      if (this.captures >= MAX_AUTHOR_RUNS - 1) return
      this.captures++
      // Capture before the edit, but commit the boundary only for a real update.
      // Count attempted captures too: no-op updates must not bypass the snapshot bound.
      try {
        this.candidates.set(transaction, snapshot(this.document))
      } catch (error) {
        if (!this.captureFailed) {
          this.captureFailed = true
          this.onCaptureError(error)
        }
      }
    }
  }

  private readonly afterTransaction = (transaction: Transaction): void => {
    const boundary = this.candidates.get(transaction)
    this.candidates.delete(transaction)
    const context = this.getContext(transaction)
    const changed =
      transaction.deleteSet.clients.size > 0 ||
      Array.from(transaction.afterState).some(([client, clock]) => clock !== transaction.beforeState.get(client))
    if (context === undefined || !changed) return

    if (this.current?.context.account === context.account) return
    if (this.current !== undefined) {
      if (this.captures >= MAX_AUTHOR_RUNS - 1 && boundary === undefined) {
        // Coalesce overflow into the final run, attributed to its last actual editor.
        this.current.context = context
        return
      }
      if (boundary === undefined) return
      this.current.curr = boundary
      this.closed.push(this.current)
    }
    this.timestamp = Math.max(Date.now(), this.timestamp + 1)
    this.current = { context, timestamp: this.timestamp }
  }

  private getContext (transaction: Transaction): Context | undefined {
    // Origins are server-owned Connection/DirectConnection objects, never client payloads.
    const context = (transaction.origin as { context?: Context } | null)?.context
    return context?.connectionId !== undefined && context.account !== undefined ? context : undefined
  }

  drain (prev: Record<string, string>, curr: Record<string, string>): AuthorSegment[] {
    const runs = [...this.closed]
    if (this.current !== undefined) runs.push({ ...this.current })
    this.discard()
    try {
      return runs.map((run) => {
        let end = curr
        if (run.curr !== undefined) {
          const boundary = createDocFromSnapshot(this.document, run.curr)
          try {
            end = this.getMarkup(boundary)
          } finally {
            boundary.destroy()
          }
        }
        const segment = { ...run, id: generateId(), prev, curr: end }
        prev = end
        return segment
      })
    } catch (error) {
      if (!this.captureFailed) {
        this.captureFailed = true
        this.onCaptureError(error)
      }
      throw error
    }
  }

  discard (): void {
    this.closed.length = 0
    this.current = undefined
    this.captures = 0
  }

  destroy (): void {
    this.document.off('beforeTransaction', this.beforeTransaction)
    this.document.off('afterTransaction', this.afterTransaction)
    this.candidates.clear()
    this.discard()
  }
}
