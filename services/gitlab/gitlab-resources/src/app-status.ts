// SPDX-License-Identifier: EPL-2.0

import { GITLAB_COM } from './gitlab-host'

/** The workspace GitLab application, as the GitLab service reports it (`app-status`). */
export interface AppStatus {
  configured: boolean
  host?: string
  clientId?: string
  redirectUri: string
  // Space-separated, as the pod sends it (e.g. 'api read_user')
  scopes: string
}

export function appStatusOf (body: Record<string, unknown>): AppStatus {
  return {
    configured: body.configured === true,
    host: typeof body.host === 'string' ? body.host : undefined,
    clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
    redirectUri: typeof body.redirectUri === 'string' ? body.redirectUri : '',
    scopes: typeof body.scopes === 'string' ? body.scopes : ''
  }
}

/** The setup form; unchecked "self-managed" means gitlab.com. */
export interface SetupForm {
  selfManaged: boolean
  host: string
  clientId: string
  clientSecret: string
}

/** The form for changing `status`; the secret is never shown, so it starts empty. */
export function setupFormOf (status: AppStatus | undefined): SetupForm {
  const host = status?.host ?? ''
  const selfManaged = host !== '' && host !== GITLAB_COM
  return { selfManaged, host: selfManaged ? host : '', clientId: status?.clientId ?? '', clientSecret: '' }
}

/** The `app-config` request: no host for gitlab.com, no secret when left empty (the stored one is kept). */
export function appConfigArgs (form: SetupForm): Record<string, unknown> {
  const args: Record<string, unknown> = { clientId: form.clientId.trim() }
  if (form.selfManaged) args.host = form.host.trim()
  if (form.clientSecret.trim() !== '') args.clientSecret = form.clientSecret.trim()
  return args
}
