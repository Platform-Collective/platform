// SPDX-License-Identifier: EPL-2.0

import { isButtonActivationKey, isInputTag } from '../keyboard'

describe('keyboard input context', () => {
  it.each(['button', 'BUTTON'])('keeps focused %s navigation in browser context', (tagName) => {
    expect(isInputTag(tagName)).toBe(false)
  })

  it.each(['input', 'INPUT', 'textarea', 'TEXTAREA'])('uses input context for %s', (tagName) => {
    expect(isInputTag(tagName)).toBe(true)
  })

  it.each(['div', 'a', 'span', undefined])('preserves the current context for %s', (tagName) => {
    expect(isInputTag(tagName)).toBe(false)
  })

  it.each([{ key: 'Enter' }, { key: ' ' }])('leaves $key on a focused button to the button', ({ key }) => {
    const evt = { key, altKey: false, ctrlKey: false, metaKey: false }
    expect(isButtonActivationKey('BUTTON', evt)).toBe(true)
    expect(isButtonActivationKey('div', evt)).toBe(false)
    expect(isButtonActivationKey('button', { ...evt, ctrlKey: true })).toBe(false)
  })

  it('handles other keys on a focused button as shortcuts', () => {
    expect(isButtonActivationKey('button', { key: 'c', altKey: false, ctrlKey: false, metaKey: false })).toBe(false)
  })
})
