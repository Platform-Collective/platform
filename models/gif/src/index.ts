//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//
import { type Builder } from '@hcengineering/model'
import core from '@hcengineering/model-core'

import setting from '@hcengineering/setting'
import view from '@hcengineering/view'
import print from '@hcengineering/model-print'
import tracker from '@hcengineering/model-tracker'
import { AccountRole } from '@hcengineering/core'

import { DOMAIN_GIF, TWorkspaceGif } from './models'
import gifPlugin from './plugin'

export { gifId } from '@hcengineering/gif'
export { gifPlugin as default }

export function createModel (builder: Builder): void {
  builder.createModel(TWorkspaceGif)

  // A library holds tens of rows, not millions. Without this it inherits full indexing.
  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_GIF,
    disabled: [{ space: 1 }, { modifiedOn: 1 }, { modifiedBy: 1 }, { createdBy: 1 }, { createdOn: -1 }]
  })

  builder.createDoc(setting.class.WorkspaceSettingCategory, core.space.Model, {
    name: 'gifs',
    label: gifPlugin.string.GifLibrary,
    icon: gifPlugin.icon.Gif,
    component: gifPlugin.component.SettingsGifTable,
    group: 'settings-editor',
    role: AccountRole.User,
    order: 5010
  })

  // Without this a WorkspaceGif picks up Open / OpenInNewTab / Print / NewRelatedIssue, none
  // of which it can honour.
  builder.mixin(gifPlugin.class.WorkspaceGif, core.class.Class, view.mixin.IgnoreActions, {
    actions: [view.action.Open, view.action.OpenInNewTab, print.action.Print, tracker.action.NewRelatedIssue]
  })
}
