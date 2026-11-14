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
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { accountConfiguration, overrideAccountConfigurationForTests, readAccountConfiguration } from '../config'

describe('account configuration', () => {
  test('keeps registration enabled by default', () => {
    expect(readAccountConfiguration({})).toEqual({
      inviteOrSsoSignup: false
    })
  })

  test('reads invite-or-SSO restrictions', () => {
    expect(
      readAccountConfiguration({
        ACCOUNT_SIGNUP_MODE: 'invite_or_sso'
      })
    ).toEqual({
      inviteOrSsoSignup: true
    })
  })

  test('uses frozen configuration snapshots and restores test overrides', () => {
    const original = accountConfiguration
    expect(Object.isFrozen(original)).toBe(true)

    const restoreConfiguration = overrideAccountConfigurationForTests({
      inviteOrSsoSignup: !original.inviteOrSsoSignup
    })
    try {
      expect(Object.isFrozen(accountConfiguration)).toBe(true)
      expect(accountConfiguration.inviteOrSsoSignup).toBe(!original.inviteOrSsoSignup)
    } finally {
      restoreConfiguration()
    }

    expect(accountConfiguration).toBe(original)
  })
})
