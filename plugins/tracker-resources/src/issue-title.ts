// SPDX-License-Identifier: EPL-2.0

/** Keep issue titles in a single paragraph when saving from a wrapping editor. */
export function normalizeIssueTitle (title: string): string {
  return title.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()
}

interface IssueTitleKeyEvent extends Pick<KeyboardEvent, 'key' | 'isComposing' | 'preventDefault'> {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

/**
 * Allow visual wrapping without inserting line breaks from the keyboard.
 * A plain Enter calls `onEnter`, so a dialog can move focus to the next field
 * the way it does for single-line inputs. Ctrl/Cmd+Enter is left to the dialog.
 */
export function handleIssueTitleKeyDown (event: IssueTitleKeyEvent, onEnter?: () => void): void {
  if (event.key !== 'Enter' || event.isComposing) {
    return
  }
  event.preventDefault()
  if (event.ctrlKey === true || event.metaKey === true || event.shiftKey === true || event.altKey === true) {
    return
  }
  onEnter?.()
}
