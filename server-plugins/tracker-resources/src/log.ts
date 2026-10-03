//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { TriggerControl } from '@hcengineering/server-core'

/**
 * Logs through the measure context of a trigger. A missing context (or method) never breaks a trigger.
 */
export function logTrigger (
  control: Pick<TriggerControl, 'ctx'>,
  level: 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>
): void {
  try {
    ;(control.ctx as any)?.[level]?.(message, data)
  } catch {
    // Logging must not fail the trigger
  }
}
