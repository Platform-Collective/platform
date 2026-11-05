// SPDX-License-Identifier: EPL-2.0

import { type Doc, type Ref } from '@hcengineering/core'
import { type Action, type ViewAction } from '@hcengineering/view'
import { mergeIds } from '@hcengineering/platform'
import { brandingId } from '@hcengineering/branding'
import branding from '@hcengineering/branding-resources/src/plugin'
import { type SettingsCategory } from '@hcengineering/setting'
import { type Application } from '@hcengineering/workbench'
// This import is needed because of similar import in branding plugin
// Otherwise, TS complains about missing types for resulting merge
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { type AnyComponent } from '@hcengineering/ui/src/types'

export default mergeIds(brandingId, branding, {
  ids: {
    PrintTemplatesSettings: '' as Ref<SettingsCategory>
  },
  app: {
    Branding: '' as Ref<Application>
  },
  action: {
    PrintWithTemplate: '' as Ref<Action<Doc, Record<string, any>>>
  },
  actionImpl: {
    PrintWithTemplate: '' as ViewAction
  }
})
