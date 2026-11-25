// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { setPlatformStatus, unknownError } from '@hcengineering/platform'

export interface CardActionCallbacks {
  onProcessing: (processing: boolean) => void
  onClose: () => void
}

export function reportCardError (err: unknown): void {
  Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
  void setPlatformStatus(unknownError(err))
}

export function executeCardAction (
  action: () => Promise<void> | void,
  retryOnError: boolean,
  callbacks: CardActionCallbacks
): void {
  const succeeded = (): void => {
    callbacks.onProcessing(false)
    callbacks.onClose()
  }
  const failed = (err: unknown): void => {
    callbacks.onProcessing(false)
    reportCardError(err)
    if (!retryOnError) callbacks.onClose()
  }

  callbacks.onProcessing(true)
  try {
    const result = action()
    if (result instanceof Promise) {
      void result.then(succeeded, failed)
    } else {
      succeeded()
    }
  } catch (err) {
    failed(err)
  }
}
