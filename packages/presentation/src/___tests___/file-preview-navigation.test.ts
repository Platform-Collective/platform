// SPDX-License-Identifier: EPL-2.0

import { handleFilePreviewNavigation } from '../file-preview-navigation'

function dispatchNavigationKey (
  target: HTMLElement,
  key: string,
  navigable: boolean,
  navigate: (offset: -1 | 1) => void,
  beforeNavigation?: (event: KeyboardEvent) => void
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.addEventListener('keydown', beforeNavigation ?? (() => {}), { once: true })
  target.addEventListener(
    'keydown',
    (currentEvent) => {
      handleFilePreviewNavigation(currentEvent, navigable, navigate)
    },
    { once: true }
  )
  target.dispatchEvent(event)
  return event
}

describe('handleFilePreviewNavigation', () => {
  it('navigates and prevents the default browser action for a navigable preview', () => {
    const navigate = jest.fn()
    const event = dispatchNavigationKey(document.body, 'ArrowRight', true, navigate)

    expect(navigate).toHaveBeenCalledWith(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it.each(['input', 'textarea', 'select', 'video', 'audio'])(
    'keeps arrow keys available for %s controls',
    (tagName) => {
      const navigate = jest.fn()
      const target = document.createElement(tagName)
      document.body.appendChild(target)

      const event = dispatchNavigationKey(target, 'ArrowLeft', true, navigate)

      expect(navigate).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
      target.remove()
    }
  )

  it('keeps arrow keys available in editable content and after another handler uses them', () => {
    const navigate = jest.fn()
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    const content = document.createElement('span')
    editable.appendChild(content)
    document.body.appendChild(editable)

    const editableEvent = dispatchNavigationKey(content, 'ArrowRight', true, navigate)
    const handledEvent = dispatchNavigationKey(document.body, 'ArrowLeft', true, navigate, (event) => {
      event.preventDefault()
    })

    expect(navigate).not.toHaveBeenCalled()
    expect(editableEvent.defaultPrevented).toBe(false)
    expect(handledEvent.defaultPrevented).toBe(true)
    editable.remove()
  })

  it('does not capture arrows when navigation is disabled', () => {
    const navigate = jest.fn()
    const event = dispatchNavigationKey(document.body, 'ArrowRight', false, navigate)

    expect(navigate).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
