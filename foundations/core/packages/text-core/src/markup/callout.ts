// SPDX-License-Identifier: EPL-2.0

export type CalloutKind = 'info' | 'warning' | 'success'

/** Normalize missing or unsupported callout kinds for editor and server conversion. */
export function getCalloutKind (kind: unknown): CalloutKind {
  return kind === 'warning' || kind === 'success' ? kind : 'info'
}
