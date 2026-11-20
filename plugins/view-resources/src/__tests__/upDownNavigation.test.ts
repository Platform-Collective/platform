import { getUpDownNavigationOffset, isActiveUpDownNavigationPanel } from '../upDownNavigation'

function key (
  k: string,
  mods: Partial<{
    altKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
    defaultPrevented: boolean
  }> = {}
): Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'defaultPrevented'> {
  return { key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, ...mods }
}

describe('getUpDownNavigationOffset', () => {
  it('maps Alt+ArrowUp / Alt+ArrowDown to previous / next', () => {
    expect(getUpDownNavigationOffset(key('ArrowUp', { altKey: true }))).toBe(-1)
    expect(getUpDownNavigationOffset(key('ArrowDown', { altKey: true }))).toBe(1)
  })

  it('ignores arrows without Alt or with other modifiers', () => {
    expect(getUpDownNavigationOffset(key('ArrowUp'))).toBeUndefined()
    expect(getUpDownNavigationOffset(key('ArrowDown', { altKey: true, shiftKey: true }))).toBeUndefined()
    expect(getUpDownNavigationOffset(key('ArrowDown', { altKey: true, ctrlKey: true }))).toBeUndefined()
    expect(getUpDownNavigationOffset(key('ArrowDown', { altKey: true, metaKey: true }))).toBeUndefined()
  })

  it('ignores other keys and already handled events', () => {
    expect(getUpDownNavigationOffset(key('ArrowLeft', { altKey: true }))).toBeUndefined()
    expect(getUpDownNavigationOffset(key('ArrowDown', { altKey: true, defaultPrevented: true }))).toBeUndefined()
  })

  it('ignores the shortcut while editing text', () => {
    const evt = key('ArrowDown', { altKey: true })
    expect(getUpDownNavigationOffset(evt, { tagName: 'INPUT' })).toBeUndefined()
    expect(getUpDownNavigationOffset(evt, { tagName: 'TEXTAREA' })).toBeUndefined()
    expect(getUpDownNavigationOffset(evt, { tagName: 'DIV', isContentEditable: true })).toBeUndefined()
    expect(getUpDownNavigationOffset(evt, { tagName: 'DIV', isContentEditable: false })).toBe(1)
    expect(getUpDownNavigationOffset(evt, { tagName: 'BUTTON' })).toBe(1)
    expect(getUpDownNavigationOffset(evt, null)).toBe(1)
  })
})

describe('isActiveUpDownNavigationPanel', () => {
  it('uses the raw document id even when the document has a different link id', () => {
    const issue = { _id: 'raw-issue-id', identifier: 'TSK-12' }
    expect(isActiveUpDownNavigationPanel(issue, 'raw-issue-id', false)).toBe(true)
    expect(isActiveUpDownNavigationPanel(issue, 'TSK-12', false)).toBe(false)
  })

  it('handles keys only in the current panel when no popup is open', () => {
    const issue = { _id: 'issue-2' }
    expect(isActiveUpDownNavigationPanel({ _id: 'issue-1' }, 'issue-2', false)).toBe(false)
    expect(isActiveUpDownNavigationPanel(issue, 'issue-2', true)).toBe(false)
  })
})
