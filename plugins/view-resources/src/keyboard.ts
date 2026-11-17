// SPDX-License-Identifier: EPL-2.0

/** Whether the target tag requires input-context keyboard actions. */
export function isInputTag (tagName: string | undefined): boolean {
  const tag = tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea'
}

/** Whether the key natively activates a focused button and must be left to the browser. */
export function isButtonActivationKey (
  tagName: string | undefined,
  evt: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>
): boolean {
  if (tagName?.toLowerCase() !== 'button') return false
  if (evt.altKey || evt.ctrlKey || evt.metaKey) return false
  return evt.key === 'Enter' || evt.key === ' '
}
