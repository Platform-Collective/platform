// SPDX-License-Identifier: EPL-2.0

export function isPendingJoinInThisSession (
  pendingSessionId: string | null,
  currentSessionId: string | undefined
): boolean {
  return pendingSessionId !== null && pendingSessionId === currentSessionId
}
