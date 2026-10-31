// SPDX-License-Identifier: EPL-2.0

/** The image shown after a step through the viewer's list; the ends do not wrap. */
export function stepIndex (index: number, delta: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(index + delta, 0), length - 1)
}
