//
// Copyright © 2026 TraceX SAS.
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

import activity from '@hcengineering/activity'
import { type Hierarchy } from '@hcengineering/core'
import { type DocNotifyContext } from '@hcengineering/notification'

import { type ChatNavGroupModel } from '../types'

export type NavGroupFilterModel = Pick<ChatNavGroupModel, 'isPinned' | '_class' | 'skipClasses'>

/**
 * Select the notify contexts shown in a chat navigator group.
 *
 * Contexts whose object class is missing from the hierarchy (for example left over
 * from an uninstalled or renamed plugin) are skipped: `classHierarchyMixin` throws
 * for unknown classes, which would otherwise break the whole navigator.
 */
export function filterNavGroupContexts (
  contexts: DocNotifyContext[],
  model: NavGroupFilterModel,
  hierarchy: Pick<Hierarchy, 'hasClass' | 'classHierarchyMixin'>
): DocNotifyContext[] {
  return contexts.filter((it) => {
    const { objectClass, isPinned, hidden } = it
    if (hidden) return false
    if (model.isPinned !== isPinned) return false
    if (model._class !== undefined && model._class !== objectClass) return false
    if (model.skipClasses !== undefined && model.skipClasses.includes(objectClass)) return false
    if (!hierarchy.hasClass(objectClass)) return false
    if (hierarchy.classHierarchyMixin(objectClass, activity.mixin.ActivityDoc) === undefined) return false
    return true
  })
}
