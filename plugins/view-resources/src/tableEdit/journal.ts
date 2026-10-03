//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Edit operations of a bulk edit and the journal that makes a batch of them undoable.
// Free of platform imports: the operations are plain data, a host turns them into transactions.

/** @public */
export interface DocTarget {
  _id: string
  _class: string
  space: string
  // Set for documents that are attached to another document
  attachedTo?: string
  attachedToClass?: string
  collection?: string
}

/**
 * One change. `before` and `after` hold the touched attributes, so that every operation can be reverted.
 * An attribute that did not have a value is recorded as null.
 * @public
 */
export type EditOp =
  | { kind: 'update', target: DocTarget, before: Record<string, unknown>, after: Record<string, unknown> }
  | { kind: 'add', target: DocTarget, attributes: Record<string, unknown> }
  | { kind: 'remove', target: DocTarget, attributes: Record<string, unknown> }

/** @public */
export interface EditBatch {
  id: string
  ops: EditOp[]
  // Number of distinct documents the batch touches
  count: number
}

const plainEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Update of one document that records the previous values; null for attributes that are not set. */
export function updateOp (target: DocTarget, doc: Record<string, unknown>, patch: Record<string, unknown>): EditOp {
  const before: Record<string, unknown> = {}
  for (const key of Object.keys(patch)) before[key] = doc[key] ?? null
  return { kind: 'update', target, before, after: { ...patch } }
}

/** True when applying the operation would not change anything. */
export function isNoop (op: EditOp): boolean {
  if (op.kind !== 'update') return false
  return Object.keys(op.after).every((key) => plainEqual(op.before[key] ?? null, op.after[key] ?? null))
}

/**
 * Merge updates of the same document into one: the first `before` and the last `after` of each attribute win.
 * Operations that are not updates keep their order and come after the updates.
 */
export function coalesceOps (ops: readonly EditOp[]): EditOp[] {
  const updates = new Map<string, Extract<EditOp, { kind: 'update' }>>()
  const rest: EditOp[] = []
  for (const op of ops) {
    if (op.kind !== 'update') {
      rest.push(op)
      continue
    }
    const known = updates.get(op.target._id)
    if (known === undefined) {
      updates.set(op.target._id, { ...op, before: { ...op.before }, after: { ...op.after } })
    } else {
      for (const key of Object.keys(op.after)) {
        if (!(key in known.before)) known.before[key] = op.before[key] ?? null
        known.after[key] = op.after[key]
      }
    }
  }
  return [...[...updates.values()].filter((op) => !isNoop(op)), ...rest]
}

export function invertOp (op: EditOp): EditOp {
  switch (op.kind) {
    case 'update':
      return { kind: 'update', target: op.target, before: op.after, after: op.before }
    case 'add':
      return { kind: 'remove', target: op.target, attributes: op.attributes }
    case 'remove':
      return { kind: 'add', target: op.target, attributes: op.attributes }
  }
}

/** Operations that revert `ops`, last operation first. */
export function invertOps (ops: readonly EditOp[]): EditOp[] {
  return [...ops].reverse().map(invertOp)
}

export function countTargets (ops: readonly EditOp[]): number {
  return new Set(ops.map((op) => op.target._id)).size
}

export function createBatch (id: string, ops: readonly EditOp[]): EditBatch {
  return { id, ops: [...ops], count: countTargets(ops) }
}

/**
 * Applies a list of operations atomically. The host implements it on top of a transaction builder.
 * @public
 */
export type OpRunner = (ops: readonly EditOp[]) => Promise<void>

/**
 * Undo and redo stacks of applied batches. A new batch drops the redo stack.
 */
export class EditJournal {
  private undoStack: EditBatch[] = []
  private redoStack: EditBatch[] = []

  constructor (private readonly limit: number = 50) {}

  get canUndo (): boolean {
    return this.undoStack.length > 0
  }

  get canRedo (): boolean {
    return this.redoStack.length > 0
  }

  /** The batch that undo would revert */
  get lastBatch (): EditBatch | undefined {
    return this.undoStack[this.undoStack.length - 1]
  }

  record (batch: EditBatch): void {
    if (batch.ops.length === 0) return
    this.undoStack.push(batch)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }

  /**
   * Revert the last batch (or the given one, when it is still the last). The batch stays undoable
   * when reverting fails.
   */
  async undo (run: OpRunner, id?: string): Promise<EditBatch | undefined> {
    const batch = this.lastBatch
    if (batch === undefined || (id !== undefined && batch.id !== id)) return undefined
    await run(invertOps(batch.ops))
    this.undoStack.pop()
    this.redoStack.push(batch)
    return batch
  }

  async redo (run: OpRunner): Promise<EditBatch | undefined> {
    const batch = this.redoStack[this.redoStack.length - 1]
    if (batch === undefined) return undefined
    await run(batch.ops)
    this.redoStack.pop()
    this.undoStack.push(batch)
    return batch
  }

  clear (): void {
    this.undoStack = []
    this.redoStack = []
  }
}
