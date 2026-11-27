// SPDX-License-Identifier: EPL-2.0

export type CalloutKind = 'info'

const MAX_CALLOUT_EMOJI_LENGTH = 16

/** Normalize missing or unsupported callout kinds for editor and server conversion. */
export function getCalloutKind (_kind: unknown): CalloutKind {
  return 'info'
}

/** Return the default icon for a callout kind. */
export function getCalloutEmoji (kind: unknown): string {
  switch (getCalloutKind(kind)) {
    case 'info':
      return 'ℹ️'
  }
}

/** Accept only a short emoji attribute that is safe to display through CSS content. */
export function parseCalloutEmoji (emoji: unknown): string | null {
  if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > MAX_CALLOUT_EMOJI_LENGTH) {
    return null
  }
  return emoji
}
