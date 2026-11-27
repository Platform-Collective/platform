// SPDX-License-Identifier: EPL-2.0

import type { Doc, Ref } from '@hcengineering/core'
import setting from '@hcengineering/setting'
import { splitSettingsNavigation } from '../settings-category'

interface Category {
  _id: Ref<Doc>
  name: string
  group?: string
}

function category (name: string, group?: string, _id?: Ref<Doc>): Category {
  return { _id: _id ?? (`test:ids:${name}` as Ref<Doc>), name, group }
}

const profile = category('profile', 'settings-account', setting.ids.Profile)
const notifications = category('notifications', 'settings-account')
const workspace = category('setting', 'settings', setting.ids.Setting)
const types = category('types', 'settings-editor')
const spaceTypes = category('spaceTypes', 'settings-editor', setting.ids.ManageSpaces)

describe('settings navigation', () => {
  it('lists workspace data model pages inside the workspace settings group', () => {
    const { topLevel, inWorkspace } = splitSettingsNavigation([profile, notifications, workspace, types, spaceTypes])

    expect(topLevel.map((it) => it.name)).toEqual(['profile', 'notifications', 'setting'])
    expect(inWorkspace.map((it) => it.name)).toEqual(['types', 'spaceTypes'])
  })

  it('keeps the original order of both lists', () => {
    const { topLevel, inWorkspace } = splitSettingsNavigation([spaceTypes, profile, types, workspace])

    expect(topLevel.map((it) => it.name)).toEqual(['profile', 'setting'])
    expect(inWorkspace.map((it) => it.name)).toEqual(['spaceTypes', 'types'])
  })

  it('keeps data model pages at the top level when workspace settings are not available', () => {
    const { topLevel, inWorkspace } = splitSettingsNavigation([profile, types, spaceTypes])

    expect(topLevel.map((it) => it.name)).toEqual(['profile', 'types', 'spaceTypes'])
    expect(inWorkspace).toEqual([])
  })

  it('leaves personal pages without a group at the top level', () => {
    const ungrouped = category('custom')
    const { topLevel, inWorkspace } = splitSettingsNavigation([ungrouped, workspace, types])

    expect(topLevel.map((it) => it.name)).toEqual(['custom', 'setting'])
    expect(inWorkspace.map((it) => it.name)).toEqual(['types'])
  })
})
