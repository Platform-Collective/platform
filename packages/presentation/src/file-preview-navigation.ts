// SPDX-License-Identifier: EPL-2.0

function isEditableTarget (target: EventTarget | null): boolean {
  let element = target instanceof HTMLElement ? target : null

  while (element !== null) {
    const tagName = element.tagName.toLowerCase()
    if (
      element.isContentEditable ||
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      tagName === 'video' ||
      tagName === 'audio'
    ) {
      return true
    }
    element = element.parentElement
  }

  return false
}

export function handleFilePreviewNavigation (
  event: KeyboardEvent,
  navigable: boolean,
  navigate: (offset: -1 | 1) => void
): void {
  if (!navigable || event.defaultPrevented || isEditableTarget(event.target)) return

  const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : undefined
  if (offset === undefined) return

  event.preventDefault()
  navigate(offset)
}
