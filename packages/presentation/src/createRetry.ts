// SPDX-License-Identifier: EPL-2.0
import { PlatformError, Severity, Status, type StatusCode } from '@hcengineering/platform'
import presentation from './plugin'

export interface CardActionOptions {
  canSave: boolean
  processing: boolean
  retryOnError: boolean
  action: () => Promise<void> | void
  setProcessing: (processing: boolean) => void
  close: () => void
  reportError: (error: unknown) => void
}

export function runCardAction (options: CardActionOptions): void {
  if (!options.canSave || options.processing) return
  options.setProcessing(true)
  const failed = (error: unknown): void => {
    options.setProcessing(false)
    options.reportError(error)
  }
  let result: Promise<void> | void
  try {
    result = options.action()
  } catch (error) {
    if (!options.retryOnError) throw error
    failed(error)
    return
  }
  if (result instanceof Promise) {
    void result.then(
      () => {
        options.setProcessing(false)
        options.close()
      },
      options.retryOnError ? failed : undefined
    )
  } else {
    options.setProcessing(false)
    options.close()
  }
}

export interface CreateTransactionState {
  creating: boolean
  commitUncertain: boolean
  creationCommitted: boolean
}

export interface CreateFinalizer {
  (): void
  cancelBeforeCommit: () => void
  markCommitUncertain: () => void
}

export interface CreatePreparation<T> {
  context: T
  finalize: CreateFinalizer
  commit: () => Promise<{ result: boolean }>
}

export interface CreateTransactionOptions<T> {
  state: CreateTransactionState
  prepare: () => Promise<CreatePreparation<T>>
  extend: (context: T) => Promise<void>
  committed: () => void
}

export function createTransactionState (): CreateTransactionState {
  return { creating: false, commitUncertain: false, creationCommitted: false }
}

function createError (code: StatusCode): PlatformError<Record<string, unknown>> {
  return new PlatformError(new Status(Severity.ERROR, code, {}))
}

export async function runCreateTransaction<T> (options: CreateTransactionOptions<T>): Promise<void> {
  const { state } = options
  if (state.creationCommitted) throw createError(presentation.status.CreateAlreadyCommitted)
  if (state.commitUncertain) throw createError(presentation.status.CreateOutcomeUnknown)
  if (state.creating) return
  state.creating = true
  try {
    const { context, finalize, commit } = await options.prepare()
    try {
      await options.extend(context)
    } catch (error) {
      finalize.cancelBeforeCommit()
      throw error
    }
    let result: { result: boolean }
    try {
      result = await commit()
    } catch (error) {
      state.commitUncertain = true
      finalize.markCommitUncertain()
      throw error
    }
    if (!result.result) {
      finalize.cancelBeforeCommit()
      throw createError(presentation.status.CreateNotCommitted)
    }
    state.creationCommitted = true
    finalize()
    options.committed()
  } finally {
    state.creating = false
  }
}
