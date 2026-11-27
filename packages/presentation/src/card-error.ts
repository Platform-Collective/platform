// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { unknownError, type Status } from '@hcengineering/platform'

export interface CardActionCallbacks {
  onProcessing: (processing: boolean) => void
  onClose: () => void
  onError: (status: Status) => void
}

export function executeCardAction (action: () => Promise<void> | void, callbacks: CardActionCallbacks): void {
  const succeeded = (): void => {
    callbacks.onProcessing(false)
    callbacks.onClose()
  }
  const failed = (err: unknown): void => {
    callbacks.onProcessing(false)
    callbacks.onError(unknownError(err))
    Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
  }

  callbacks.onProcessing(true)
  let result: Promise<void> | void
  try {
    result = action()
  } catch (err) {
    failed(err)
    return
  }
  if (result == null) {
    succeeded()
  } else {
    void Promise.resolve(result).then(succeeded, failed)
  }
}
