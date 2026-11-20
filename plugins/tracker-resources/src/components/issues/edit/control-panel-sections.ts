// SPDX-License-Identifier: EPL-2.0

/** Minimal Storage subset so the helpers can be tested without a browser. */
export type SectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function panelSectionStorageKey (section: string): string {
  return `tracker.issuePanel.section.${section}.collapsed`
}

function browserStorage (): SectionStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Collapse state is remembered per browser; it falls back to expanded when storage is unavailable. */
export function isPanelSectionCollapsed (
  section: string,
  storage: SectionStorage | undefined = browserStorage()
): boolean {
  try {
    return storage?.getItem(panelSectionStorageKey(section)) === '1'
  } catch {
    return false
  }
}

export function setPanelSectionCollapsed (
  section: string,
  collapsed: boolean,
  storage: SectionStorage | undefined = browserStorage()
): void {
  try {
    if (collapsed) storage?.setItem(panelSectionStorageKey(section), '1')
    else storage?.removeItem(panelSectionStorageKey(section))
  } catch {
    // Storage blocked (private mode, quota): the section still toggles for this view.
  }
}
