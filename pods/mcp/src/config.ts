/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { config as dotenv } from 'dotenv'

dotenv()

/**
 * How the server decides who the caller is.
 *
 * - `configured`: a self-hosted deployment. Credentials come from the pod's own
 *   environment (HULY_TOKEN, or HULY_EMAIL + HULY_PASSWORD) and every session
 *   runs as that one account. The MCP client needs no Huly credential at all,
 *   which is what makes this usable from Claude Desktop or a phone.
 * - `perRequest`: the MCP client presents its own Huly API token on every
 *   request. Used when several teams share one MCP endpoint and each must act as
 *   itself.
 */
export type AuthMode = 'configured' | 'perRequest'

export interface Config {
  Port: number
  Host: string
  Secret: string
  ServiceID: string
  /** Account service URL; the public Huly base URL in a self-hosted install. */
  AccountsUrl: string
  AuthMode: AuthMode
  /** Static API token for `configured` mode. */
  HulyToken: string
  /** Static login for `configured` mode when no API token is supplied. */
  HulyEmail: string
  HulyPassword: string
  /** Restrict `configured` mode to one workspace, by id or url slug. */
  HulyWorkspace: string
  /** Drop write tools and refuse all mutations. */
  ReadOnly: boolean
  /** Identifiers callers may present when `AuthMode` is `perRequest`. */
  AllowedTokens: string[]
  SessionIdleTtlMs: number
  ClientCacheTtlMs: number
  LoginCacheTtlMs: number
  RequestRateLimit: number
  RequestRateWindowMs: number
  MaxBodyBytes: number
  EnableStats: boolean
}

const int = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    throw Error(`Expected an integer but got "${value}"`)
  }
  return parsed
}

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback
  return value === 'true' || value === '1'
}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

const DEFAULT_ACCOUNTS_URL = 'http://huly.local:3000'

/**
 * Resolves the auth mode from the environment.
 *
 * Credentials win over `perRequest` when both are present: a self-hoster who
 * pasted a token into compose clearly wants the simple single-tenant setup, and
 * silently ignoring it in favour of per-request tokens would produce an endpoint
 * that rejects every client.
 */
export function resolveAuthMode (env: NodeJS.ProcessEnv): AuthMode {
  const hasStaticCredentials =
    (env.HULY_TOKEN ?? '') !== '' || ((env.HULY_EMAIL ?? '') !== '' && (env.HULY_PASSWORD ?? '') !== '')
  return hasStaticCredentials ? 'configured' : 'perRequest'
}

function buildConfig (env: NodeJS.ProcessEnv): Config {
  const authMode = resolveAuthMode(env)

  if (authMode === 'configured' && (env.HULY_TOKEN ?? '') === '' && (env.HULY_PASSWORD ?? '') === '') {
    throw Error('Auth mode is "configured" but neither HULY_TOKEN nor HULY_PASSWORD is set')
  }

  return {
    Port: int(env.PORT, 4090),
    Host: env.HOST ?? '0.0.0.0',
    Secret: env.SECRET ?? '',
    ServiceID: env.SERVICE_ID ?? 'mcp',
    AccountsUrl: env.ACCOUNTS_URL ?? DEFAULT_ACCOUNTS_URL,
    AuthMode: authMode,
    HulyToken: env.HULY_TOKEN ?? '',
    HulyEmail: env.HULY_EMAIL ?? '',
    HulyPassword: env.HULY_PASSWORD ?? '',
    HulyWorkspace: env.HULY_WORKSPACE ?? '',
    ReadOnly: bool(env.MCP_READONLY, false),
    AllowedTokens: list(env.MCP_ALLOWED_TOKENS),
    SessionIdleTtlMs: int(env.MCP_SESSION_TTL_MS, 30 * 60_000),
    ClientCacheTtlMs: int(env.MCP_CLIENT_CACHE_TTL_MS, 10 * 60_000),
    LoginCacheTtlMs: int(env.MCP_LOGIN_CACHE_TTL_MS, 60_000),
    RequestRateLimit: int(env.MCP_RATE_LIMIT, 300),
    RequestRateWindowMs: int(env.MCP_RATE_WINDOW_MS, 60_000),
    MaxBodyBytes: int(env.MCP_MAX_BODY_BYTES, 1024 * 1024),
    EnableStats: bool(env.MCP_STATS, true)
  }
}

/**
 * Fails fast on configuration that would otherwise only break at first use.
 *
 * `SECRET` is the single most dangerous omission: without it every Huly token
 * verifies against the literal string "secret" (see `server-token`), so a
 * misconfigured deployment would accept forged tokens. Refusing to start is the
 * only safe response.
 */
function validate (config: Config): Config {
  if (config.Secret === '' || config.Secret === 'secret') {
    throw Error('SECRET must be set to a real secret; refusing to start with the default')
  }
  if (config.Port < 1 || config.Port > 65535) {
    throw Error(`PORT is out of range: ${config.Port}`)
  }
  return config
}

/**
 * Reads and validates configuration.
 *
 * Deliberately a function rather than a module-level constant: importing this
 * file must not require environment variables, or every unit test that touches
 * a helper here would fail at import time. `index.ts` calls it once at boot,
 * which is where a misconfiguration should stop the process.
 */
export function loadConfig (env: NodeJS.ProcessEnv = process.env): Config {
  return validate(buildConfig(env))
}
