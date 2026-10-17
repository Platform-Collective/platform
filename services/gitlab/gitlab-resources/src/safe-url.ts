// SPDX-License-Identifier: EPL-2.0

/**
 * The URL when it is http(s), else undefined. URLs mirrored from GitLab (or written by any client into a GitLab mixin)
 * must never become a javascript: or data: link.
 */
export function safeHttpUrl (url: string | null | undefined): string | undefined {
  const trimmed = url?.trim() ?? ''
  return /^https?:\/\/./i.test(trimmed) ? trimmed : undefined
}
