// SPDX-License-Identifier: EPL-2.0

/** Keep issue titles in a single paragraph when saving from a wrapping editor. */
export function normalizeIssueTitle (title: string): string {
  return title.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()
}

/** Allow visual wrapping without inserting line breaks from the keyboard. */
export function handleIssueTitleKeyDown (event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'preventDefault'>): void {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault()
  }
}
