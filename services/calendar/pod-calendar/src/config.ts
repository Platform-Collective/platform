//
// Copyright © 2023 Hardcore Engineering Inc.
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

interface Config {
  Port: number

  AccountsURL: string
  ServiceID: string
  Secret: string
  KvsUrl: string
  InitLimit: number
  WorkspaceInactivityInterval: number // Interval in days to stop workspace synchronization if not visited

  // Google Calendar provider. The Google module starts only when both values are present and non-blank.
  Credentials?: string
  WATCH_URL?: string
  GoogleEnabled: boolean
}

type RequiredKey =
  | 'Port'
  | 'AccountsURL'
  | 'ServiceID'
  | 'Secret'
  | 'KvsUrl'
  | 'InitLimit'
  | 'WorkspaceInactivityInterval'

const envMap: { [key in keyof Config]-?: string } = {
  Port: 'PORT',

  AccountsURL: 'ACCOUNTS_URL',
  ServiceID: 'SERVICE_ID',
  Secret: 'SECRET',
  Credentials: 'Credentials',
  WATCH_URL: 'WATCH_URL',
  InitLimit: 'INIT_LIMIT',
  KvsUrl: 'KVS_URL',
  WorkspaceInactivityInterval: 'WORKSPACE_INACTIVITY_INTERVAL',
  GoogleEnabled: 'GOOGLE_ENABLED' // derived, not read from the environment
}

const parseNumber = (str: string | undefined): number | undefined => (str !== undefined ? Number(str) : undefined)

// Treat blank values as unset so a deployment can disable Google with Credentials="".
const optionalString = (str: string | undefined): string | undefined =>
  str !== undefined && str.trim() !== '' ? str : undefined

const config: Config = (() => {
  const required: { [key in RequiredKey]: Config[key] | undefined } = {
    Port: parseNumber(process.env[envMap.Port]) ?? 8095,
    AccountsURL: process.env[envMap.AccountsURL],
    ServiceID: process.env[envMap.ServiceID] ?? 'calendar-service',
    Secret: process.env[envMap.Secret],
    InitLimit: parseNumber(process.env[envMap.InitLimit]) ?? 50,
    KvsUrl: process.env[envMap.KvsUrl],
    WorkspaceInactivityInterval: parseNumber(process.env[envMap.WorkspaceInactivityInterval] ?? '3') // In days
  }

  const missingEnv = (Object.keys(required) as RequiredKey[])
    .filter((key) => required[key] === undefined)
    .map((key) => envMap[key])

  if (missingEnv.length > 0) {
    throw Error(`Missing env variables: ${missingEnv.join(', ')}`)
  }

  const credentials = optionalString(process.env[envMap.Credentials])
  const watchUrl = optionalString(process.env[envMap.WATCH_URL])

  return {
    ...(required as { [key in RequiredKey]: Config[key] }),
    Credentials: credentials,
    WATCH_URL: watchUrl,
    GoogleEnabled: credentials !== undefined && watchUrl !== undefined
  }
})()

export default config
