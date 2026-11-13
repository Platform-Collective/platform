// SPDX-License-Identifier: EPL-2.0

import type { Doc, Ref } from '@hcengineering/core'
import setting from '@hcengineering/setting'

/**
 * Settings pages registered as top-level categories that describe the shared workspace
 * (for example types and space types) rather than the current user.
 */
const workspaceSettingsGroup = 'settings-editor'

export function isSettingsCategoryVisible (categoryId: Ref<Doc>, localLoginHidden: boolean | undefined): boolean {
  return localLoginHidden !== true || categoryId !== setting.ids.Password
}

/**
 * Splits the top-level settings categories into the pages shown directly in the settings
 * navigation and the workspace pages listed inside the workspace settings group.
 * Workspace pages stay at the top level when the workspace settings group is not shown.
 */
export function splitSettingsNavigation<T extends { _id: Ref<Doc>, group?: string }> (
  categories: T[]
): { topLevel: T[], inWorkspace: T[] } {
  const hasWorkspaceSettings = categories.some((it) => it._id === setting.ids.Setting)
  if (!hasWorkspaceSettings) {
    return { topLevel: categories, inWorkspace: [] }
  }
  return {
    topLevel: categories.filter((it) => it.group !== workspaceSettingsGroup),
    inWorkspace: categories.filter((it) => it.group === workspaceSettingsGroup)
  }
}
