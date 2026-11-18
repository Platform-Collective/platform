// SPDX-License-Identifier: EPL-2.0
import {
  createTransactionState,
  runCardAction,
  runCreateTransaction,
  type CreateFinalizer
} from '../createRetry'
import presentation from '../plugin'

function finalizer (): CreateFinalizer & jest.Mock {
  return Object.assign(jest.fn(), {
    cancelBeforeCommit: jest.fn(),
    markCommitUncertain: jest.fn()
  })
}

describe('retryable card actions', () => {
  it('keeps a rejected action available for retry and suppresses duplicate submission', async () => {
    const error = new Error('commit failed')
    const action = jest.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined)
    const state = { processing: false }
    const close = jest.fn()
    const reportError = jest.fn()
    const submit = (): void => {
      runCardAction({
        canSave: true,
        processing: state.processing,
        retryOnError: true,
        action,
        setProcessing: (processing) => {
          state.processing = processing
        },
        close,
        reportError
      })
    }

    submit()
    submit()
    await Promise.resolve()
    await Promise.resolve()
    expect(action).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(error)
    expect(close).not.toHaveBeenCalled()

    submit()
    await Promise.resolve()
    expect(action).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('handles synchronous errors according to retryOnError=%s', (retryOnError) => {
    const action = jest.fn(() => {
      throw new Error('failed')
    })
    const state = { processing: false }
    const submit = (): void => {
      runCardAction({
        canSave: true,
        processing: state.processing,
        retryOnError,
        action,
        setProcessing: (processing) => {
          state.processing = processing
        },
        close: jest.fn(),
        reportError: jest.fn()
      })
    }

    if (retryOnError) submit()
    else expect(submit).toThrow('failed')
    if (retryOnError) submit()
    else submit()
    expect(action).toHaveBeenCalledTimes(retryOnError ? 2 : 1)
  })
})

describe('create transaction lifecycle', () => {
  it('allows retry after a definite pre-commit failure', async () => {
    const state = createTransactionState()
    const first = finalizer()
    const second = finalizer()
    const commit = jest.fn().mockResolvedValue({ result: true })
    const extend = jest.fn().mockRejectedValueOnce(new Error('preparation')).mockResolvedValue(undefined)
    const committed = jest.fn()
    const prepare = jest.fn()
      .mockImplementationOnce(async () => ({ context: 'first', finalize: first, commit }))
      .mockImplementationOnce(async () => ({ context: 'second', finalize: second, commit }))
    const execute = async (): Promise<void> => {
      await runCreateTransaction({
        state,
        prepare,
        extend,
        committed
      })
    }

    await expect(execute()).rejects.toThrow('preparation')
    expect(first.cancelBeforeCommit).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
    await execute()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(committed).toHaveBeenCalledTimes(1)
    expect(state.creationCommitted).toBe(true)
  })

  it('blocks replay after an ambiguous commit outcome', async () => {
    const state = createTransactionState()
    const finalize = finalizer()
    const prepare = jest.fn(async () => ({
      context: undefined,
      finalize,
      commit: jest.fn().mockRejectedValue(new Error('response lost'))
    }))
    const execute = async (): Promise<void> => {
      await runCreateTransaction({
        state,
        prepare,
        extend: jest.fn().mockResolvedValue(undefined),
        committed: jest.fn()
      })
    }

    await expect(execute()).rejects.toThrow('response lost')
    expect(state.commitUncertain).toBe(true)
    expect(finalize.markCommitUncertain).toHaveBeenCalledTimes(1)
    await expect(execute()).rejects.toMatchObject({
      status: { code: presentation.status.CreateOutcomeUnknown }
    })
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('latches successful persistence before finalization', async () => {
    const state = createTransactionState()
    const finalize = finalizer()
    finalize.mockImplementation(() => {
      throw new Error('draft cleanup failed')
    })
    const execute = async (): Promise<void> => {
      await runCreateTransaction({
        state,
        prepare: async () => ({
          context: undefined,
          finalize,
          commit: jest.fn().mockResolvedValue({ result: true })
        }),
        extend: jest.fn().mockResolvedValue(undefined),
        committed: jest.fn()
      })
    }

    await expect(execute()).rejects.toThrow('draft cleanup failed')
    expect(state.creationCommitted).toBe(true)
    await expect(execute()).rejects.toMatchObject({
      status: { code: presentation.status.CreateAlreadyCommitted }
    })
    expect(finalize).toHaveBeenCalledTimes(1)
  })

  it('keeps a negative commit result retryable', async () => {
    const state = createTransactionState()
    const finalize = finalizer()
    await expect(runCreateTransaction({
      state,
      prepare: async () => ({
        context: undefined,
        finalize,
        commit: async () => ({ result: false })
      }),
      extend: jest.fn().mockResolvedValue(undefined),
      committed: jest.fn()
    })).rejects.toMatchObject({ status: { code: presentation.status.CreateNotCommitted } })
    expect(finalize.cancelBeforeCommit).toHaveBeenCalledTimes(1)
    expect(state.commitUncertain).toBe(false)
    expect(state.creationCommitted).toBe(false)
  })
})
