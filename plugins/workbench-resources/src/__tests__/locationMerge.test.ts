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

import type { Location, ResolvedLocation } from '@hcengineering/ui'
import { mergeResolvedLocation } from '../locationMerge'

const panel = 'view:component:EditDoc|card1|card:class:Card|content'

// What the card location resolver returns for /workbench/ws/card/<cardId>
const cardResolved = (): ResolvedLocation => ({
  loc: { path: ['workbench', 'ws'], fragment: panel },
  defaultLocation: { path: ['workbench', 'ws', 'card', 'space1', 'card:class:Card'], fragment: panel }
})

const cardLoc = (): Location => ({ path: ['workbench', 'ws', 'card', 'card1'] })

describe('mergeResolvedLocation', () => {
  it('keeps the tracker special when a card panel is opened over an issue list', () => {
    const merged = mergeResolvedLocation(cardLoc(), cardResolved(), {
      currentAppAlias: 'tracker',
      currentSpace: 'project1',
      currentSpecial: 'issues',
      currentQuery: undefined
    })
    expect(merged.path).toEqual(['workbench', 'ws', 'tracker', 'project1', 'issues'])
    expect(merged.fragment).toBe(panel)
  })

  it('does not invent a special when the current app has none', () => {
    const merged = mergeResolvedLocation(cardLoc(), cardResolved(), {
      currentAppAlias: 'tracker',
      currentSpace: 'project1',
      currentSpecial: undefined,
      currentQuery: undefined
    })
    expect(merged.path).toEqual(['workbench', 'ws', 'tracker', 'project1'])
  })

  it('does not copy a special over a panel without a current space', () => {
    const merged = mergeResolvedLocation(cardLoc(), cardResolved(), {
      currentAppAlias: 'inbox',
      currentSpace: undefined,
      currentSpecial: 'inbox',
      currentQuery: undefined
    })
    expect(merged.path).toEqual(['workbench', 'ws', 'inbox', 'inbox'])
  })

  it('uses the default location when no application is shown yet', () => {
    const merged = mergeResolvedLocation(cardLoc(), cardResolved(), {
      currentAppAlias: undefined,
      currentSpace: undefined,
      currentSpecial: undefined,
      currentQuery: undefined
    })
    expect(merged.path).toEqual(['workbench', 'ws', 'card', 'space1', 'card:class:Card'])
  })
})
