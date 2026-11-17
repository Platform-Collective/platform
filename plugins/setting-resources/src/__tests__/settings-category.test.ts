// SPDX-License-Identifier: EPL-2.0

import setting from '@hcengineering/setting'
import { isSettingsCategoryVisible } from '../settings-category'

describe('settings category visibility', () => {
  it('hides Change Password when local login is disabled', () => {
    expect(isSettingsCategoryVisible(setting.ids.Password, true)).toBe(false)
  })

  it.each([false, undefined])('shows Change Password when HideLocalLogin is %s', (localLoginHidden) => {
    expect(isSettingsCategoryVisible(setting.ids.Password, localLoginHidden)).toBe(true)
  })

  it.each([true, false, undefined])('keeps other settings visible when HideLocalLogin is %s', (localLoginHidden) => {
    for (const categoryId of [setting.ids.Profile, setting.ids.Security, setting.ids.Setting]) {
      expect(isSettingsCategoryVisible(categoryId, localLoginHidden)).toBe(true)
    }
  })
})
