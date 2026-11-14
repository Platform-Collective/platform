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

export interface AccountConfiguration {
  inviteOrSsoSignup: boolean
}

export function readAccountConfiguration (env: NodeJS.ProcessEnv = process.env): AccountConfiguration {
  return {
    inviteOrSsoSignup: env.ACCOUNT_SIGNUP_MODE === 'invite_or_sso'
  }
}

// Account-service configuration is fixed for the lifetime of a process.
export let accountConfiguration: Readonly<AccountConfiguration> = Object.freeze(readAccountConfiguration())

/**
 * Replaces the process configuration for the duration of a test and returns a
 * restore callback. Production code must treat the configuration as immutable.
 */
export function overrideAccountConfigurationForTests (overrides: Partial<AccountConfiguration>): () => void {
  const previous = accountConfiguration
  accountConfiguration = Object.freeze({ ...accountConfiguration, ...overrides })

  return () => {
    accountConfiguration = previous
  }
}
