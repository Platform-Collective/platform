// SPDX-License-Identifier: EPL-2.0

import { generateId } from '@hcengineering/core'
import { Doc, Transaction } from 'yjs'
import type { Context } from '../context'
import type { AuthorSegment } from '../storage/adapter'

interface Run {
  context: Context
  timestamp: number
  curr?: Record<string, string>
}

/** Tracks authenticated submitting authors in server arrival order, including RPC edits. */
export class AuthorRuns {
  private readonly closed: Run[] = []
  private current?: Run
  private timestamp = 0
  private captureFailed = false
  private readonly candidates = new Map<Transaction, Record<string, string>>()

  constructor (
    private readonly document: Doc,
    private readonly getMarkup: () => Record<string, string>,
    private readonly onCaptureError: (error: unknown) => void = () => {}
  ) {
    document.on('beforeTransaction', this.beforeTransaction)
    document.on('afterTransaction', this.afterTransaction)
  }

  private readonly beforeTransaction = (transaction: Transaction): void => {
    const context = this.getContext(transaction)
    if (context !== undefined && this.current !== undefined && this.current.context.account !== context.account) {
      // Capture before the edit, but commit the boundary only for a real update.
      // Markup capture also works with gc:true and never discards author runs on overflow.
      // Full markup conversion is also needed for author switches that prove to be no-ops.
      // Never let a capture error escape: Yjs emits beforeTransaction outside its cleanup guard.
      try {
        this.candidates.set(transaction, this.getMarkup())
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
    if (this.current !== undefined) runs.push({ ...this.current, curr })
    this.closed.length = 0
    this.current = undefined
    return runs.map((run) => {
      const end = run.curr ?? curr
      const segment = { ...run, id: generateId(), prev, curr: end }
      prev = end
      return segment
    })
  }

  destroy (): void {
    this.document.off('beforeTransaction', this.beforeTransaction)
    this.document.off('afterTransaction', this.afterTransaction)
    this.candidates.clear()
    this.closed.length = 0
    this.current = undefined
  }
}
