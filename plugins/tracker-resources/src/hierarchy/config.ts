//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/**
 * Sub-issue hierarchy of the table ("Show hierarchy" of GitHub Projects). The switch is stored in the view options
 * under `HIERARCHY_OPTION_KEY`, so that it is saved with the saved view, restored when it is opened and takes part
 * in its unsaved-changes tracking. It is absent (off) for a view that was saved before the feature existed and for
 * the unsaved default view; a new table view starts with it on.
 */
export const HIERARCHY_OPTION_KEY = 'hierarchy'

/** Key of the view option "Sub-issues"; a list that hides the sub-issues has nothing to nest. */
export const SUB_ISSUES_OPTION_KEY = 'shouldShowSubIssues'

/** Whether the tree is shown for the view options. */
export function isHierarchyEnabled (viewOptions: Record<string, any> | undefined): boolean {
  return viewOptions?.[HIERARCHY_OPTION_KEY] === true && viewOptions[SUB_ISSUES_OPTION_KEY] !== false
}

/** Whether the view option itself is on, whatever the "Sub-issues" option says. */
export function isHierarchySwitchedOn (viewOptions: Record<string, any> | undefined): boolean {
  return viewOptions?.[HIERARCHY_OPTION_KEY] === true
}

/**
 * The view options with the switch set. Off is not stored at all, so that switching it on and off again does not
 * make the view look changed.
 */
export function withHierarchy<O extends Record<string, any>> (options: O, enabled: boolean): O {
  const next: Record<string, any> = { ...options }
  if (enabled) {
    next[HIERARCHY_OPTION_KEY] = true
  } else {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next[HIERARCHY_OPTION_KEY]
  }
  return next as O
}

/** What a new view of a layout starts with: tables show the hierarchy, the other layouts do not use it. */
export function newViewHierarchyOptions (isTable: boolean): Record<string, any> | undefined {
  return isTable ? { [HIERARCHY_OPTION_KEY]: true } : undefined
}
