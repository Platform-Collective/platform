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
import type { Class, Doc, Hierarchy, Ref } from '@hcengineering/core'
import type { DocNotifyContext } from '@hcengineering/notification'

import { filterNavGroupContexts, type NavGroupFilterModel } from '../components/chat/navigator/navGroupContexts'

const channelClass = 'test:class:Channel' as Ref<Class<Doc>>
const plainClass = 'test:class:Plain' as Ref<Class<Doc>>
const removedClass = 'removed-plugin:class:Thing' as Ref<Class<Doc>>

const knownClasses = new Set<Ref<Class<Doc>>>([channelClass, plainClass])
const activityDocClasses = new Set<Ref<Class<Doc>>>([channelClass])

// Mirrors the real Hierarchy: `classHierarchyMixin` throws for classes it does not know.
const hierarchy: Pick<Hierarchy, 'hasClass' | 'classHierarchyMixin'> = {
  hasClass: (_class) => knownClasses.has(_class),
  classHierarchyMixin: (_class: Ref<Class<Doc>>, mixin: Ref<Class<Doc>>) => {
    if (!knownClasses.has(_class)) throw new Error('class not found: ' + _class)
    return mixin === activity.mixin.ActivityDoc && activityDocClasses.has(_class) ? ({} as any) : undefined
  }
}

function context (id: string, objectClass: Ref<Class<Doc>>, extra: Partial<DocNotifyContext> = {}): DocNotifyContext {
  return { _id: id, objectClass, isPinned: false, hidden: false, ...extra } as unknown as DocNotifyContext
}

const model: NavGroupFilterModel = { isPinned: false }

describe('filterNavGroupContexts', () => {
  it('skips contexts whose class is missing from the hierarchy instead of throwing', () => {
    const contexts = [context('known', channelClass), context('stale', removedClass)]

    expect(() => filterNavGroupContexts(contexts, model, hierarchy)).not.toThrow()
    expect(filterNavGroupContexts(contexts, model, hierarchy).map((it) => it._id)).toEqual(['known'])
  })

  it('keeps only visible contexts of ActivityDoc classes that match the group model', () => {
    const contexts = [
      context('channel', channelClass),
      context('plain', plainClass),
      context('hidden', channelClass, { hidden: true }),
      context('pinned', channelClass, { isPinned: true })
    ]

    expect(filterNavGroupContexts(contexts, model, hierarchy).map((it) => it._id)).toEqual(['channel'])
    expect(filterNavGroupContexts(contexts, { isPinned: true }, hierarchy).map((it) => it._id)).toEqual(['pinned'])
    expect(filterNavGroupContexts(contexts, { isPinned: false, skipClasses: [channelClass] }, hierarchy)).toEqual([])
    expect(filterNavGroupContexts(contexts, { isPinned: false, _class: plainClass }, hierarchy)).toEqual([])
  })
})
