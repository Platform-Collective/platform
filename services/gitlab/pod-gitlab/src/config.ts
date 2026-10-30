// SPDX-License-Identifier: EPL-2.0

import { normalizeHostname } from '@hcengineering/safe-fetch'

export interface Config {
  AccountsURL: string
  ServerSecret: string
  ServiceID: string
  FrontURL: string
  // Browser origins the API answers (CORS): the FRONT_URL origin and GITLAB_CORS_ORIGINS
  CorsOrigins: string[]
  Port: number

  RedirectURI: string

  // Public URL of this service as reachable from GitLab
  WebhookBaseURL: string
  WebhookSecret: string

  // Collaborator service URL, used to read and write issue descriptions
  CollaboratorURL: string
  // Blob storage (STORAGE_CONFIG, same format as other services) for merge request diffs; unset: no diffs
  StorageConfig?: string

  // Dev only: accept plain-http GitLab hosts (localhost, 127.0.0.1, *.local). Default false.
  AllowInsecureHosts?: boolean
  // GITLAB_ALLOWED_HOSTS: when not empty, the only GitLab host names the pod calls (private addresses included)
  AllowedHosts: string[]
  // GITLAB_REQUEST_TIMEOUT_MS: limit of one GitLab call, body included
  RequestTimeoutMs: number

  // Days without a visit after which a workspace's worker stops; 0 = never
  WorkspaceInactivityDays: number
}

// OAuth settings of one workspace's GitLab application (see toOAuthConfig in apps.ts)
export interface OAuthConfig {
  // Base URL of the GitLab instance (gitlab.com or self-managed, may include a sub-path)
  GitlabHost: string
  ClientID: string
  ClientSecret: string
  RedirectURI: string
}

const REQUIRED_ENV = [
  'ACCOUNTS_URL',
  'SERVER_SECRET',
  'FRONT_URL',
  'WEBHOOK_BASE_URL',
  'WEBHOOK_SECRET',
  'COLLABORATOR_URL'
] as const

export function trimSlash (url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * OAuth callback on the Huly front the user is actually on, so any host the front is served from works
 * (GitLab still only accepts callback URLs registered in the application). Anything that is not a bare
 * http(s) origin falls back to the configured redirect.
 */
export function redirectUriFor (origin: string | undefined, fallback: string): string {
  if (origin === undefined || origin === '') return fallback
  try {
    const url = new URL(origin)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.origin === origin) {
      return `${url.origin}/gitlab`
    }
  } catch {}
  return fallback
}

/** GITLAB_ALLOWED_HOSTS: comma-separated host names or URLs, as normalized host names (safe-fetch's normalizeHostname). */
export function parseAllowedHosts (value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((it) => it.trim())
    .filter((it) => it !== '')
    .map((it) => {
      try {
        return normalizeHostname(new URL(it.includes('://') ? it : `https://${it}`).hostname)
      } catch {
        throw new Error(`GITLAB_ALLOWED_HOSTS has an invalid host: ${it}`)
      }
    })
}

/** The FRONT_URL origin and GITLAB_CORS_ORIGINS (comma-separated, for fronts served from other hosts) as origins. */
export function parseCorsOrigins (frontUrl: string, value: string | undefined): string[] {
  const toOrigin = (url: string): string => {
    try {
      return new URL(url).origin
    } catch {
      throw new Error(`GITLAB_CORS_ORIGINS has an invalid origin: ${url}`)
    }
  }
  const listed = (value ?? '')
    .split(',')
    .map((it) => it.trim())
    .filter((it) => it !== '')
  const origins = [frontUrl, ...listed].map(toOrigin)
  return [...new Set(origins)]
}

// Shorter secrets, or these well-known placeholders (the dev compose defaults), are reported as weak
const MIN_SECRET_LENGTH = 16
const PLACEHOLDER_SECRETS = new Set(['secret', 'changeme', 'password'])

/** Names of the configured secrets that look weak; empty in dev mode (GITLAB_ALLOW_INSECURE_HOSTS). */
export function weakSecrets (config: Pick<Config, 'ServerSecret' | 'WebhookSecret' | 'AllowInsecureHosts'>): string[] {
  if (config.AllowInsecureHosts === true) return []
  const secrets: Array<[string, string]> = [
    ['SERVER_SECRET', config.ServerSecret],
    ['WEBHOOK_SECRET', config.WebhookSecret]
  ]
  const isWeak = (value: string): boolean =>
    value.length < MIN_SECRET_LENGTH || PLACEHOLDER_SECRETS.has(value.toLowerCase())
  return secrets.filter(([, value]) => isWeak(value)).map(([name]) => name)
}

export function loadConfig (env: Record<string, string | undefined>): Config {
  const missing = REQUIRED_ENV.filter((key) => env[key] === undefined || env[key] === '')
  if (missing.length > 0) {
    throw new Error(`Missing env variables: ${missing.join(', ')}`)
  }
  const port = parseInt(env.PORT ?? '3600')
  if (Number.isNaN(port)) {
    throw new Error('PORT must be a number')
  }
  const frontUrl = trimSlash(env.FRONT_URL as string)
  const inactivityDays = parseInt(env.WORKSPACE_INACTIVITY_INTERVAL ?? '3')
  if (Number.isNaN(inactivityDays)) {
    throw new Error('WORKSPACE_INACTIVITY_INTERVAL must be a number')
  }
  const requestTimeoutMs = parseInt(env.GITLAB_REQUEST_TIMEOUT_MS ?? '30000')
  if (Number.isNaN(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error('GITLAB_REQUEST_TIMEOUT_MS must be a positive number')
  }
  return {
    AccountsURL: env.ACCOUNTS_URL as string,
    ServerSecret: env.SERVER_SECRET as string,
    ServiceID: env.SERVICE_ID ?? 'gitlab-service',
    FrontURL: frontUrl,
    CorsOrigins: parseCorsOrigins(frontUrl, env.GITLAB_CORS_ORIGINS),
    Port: port,
    RedirectURI:
      env.GITLAB_REDIRECT_URI !== undefined && env.GITLAB_REDIRECT_URI !== ''
        ? env.GITLAB_REDIRECT_URI
        : `${frontUrl}/gitlab`,
    WebhookBaseURL: trimSlash(env.WEBHOOK_BASE_URL as string),
    WebhookSecret: env.WEBHOOK_SECRET as string,
    CollaboratorURL: env.COLLABORATOR_URL as string,
    StorageConfig: env.STORAGE_CONFIG !== undefined && env.STORAGE_CONFIG !== '' ? env.STORAGE_CONFIG : undefined,
    AllowInsecureHosts: env.GITLAB_ALLOW_INSECURE_HOSTS === 'true',
    AllowedHosts: parseAllowedHosts(env.GITLAB_ALLOWED_HOSTS),
    RequestTimeoutMs: requestTimeoutMs,
    WorkspaceInactivityDays: inactivityDays
  }
}
