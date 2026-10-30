// SPDX-License-Identifier: EPL-2.0

import type { Doc, Ref } from '@hcengineering/core'
import setting from '@hcengineering/setting'

export function isSettingsCategoryVisible (categoryId: Ref<Doc>, localLoginHidden: boolean | undefined): boolean {
  return localLoginHidden !== true || categoryId !== setting.ids.Password
}
