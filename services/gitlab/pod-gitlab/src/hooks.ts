// SPDX-License-Identifier: EPL-2.0

import type { Ref, WorkspaceUuid } from '@hcengineering/core'
import type { GitlabIntegration } from '@hcengineering/gitlab'
import { createHmac } from 'crypto'

/** The workspace and integration a project hook belongs to. */
export interface HookTarget {
  workspace: WorkspaceUuid
  integration: Ref<GitlabIntegration>
}

/** Prefix of the project hook URLs. */
export const WEBHOOK_PATH = '/api/webhook'

export function hookUrl (baseUrl: string, target: HookTarget): string {
  return `${baseUrl}${WEBHOOK_PATH}/${encodeURIComponent(target.workspace)}/${encodeURIComponent(target.integration)}`
}

/** Derived from WEBHOOK_SECRET, so nothing is stored; a leaked hook secret is good for one integration only. */
export function hookSecret (master: string, target: HookTarget): string {
  return createHmac('sha256', master).update(`gitlab-hook:v1:${target.workspace}:${target.integration}`).digest('hex')
}

/** The target named by a scoped hook URL's route parameters; undefined when one is missing. */
export function hookTargetOf (params: Record<string, string | undefined>): HookTarget | undefined {
  const { workspace, integration } = params
  if (workspace === undefined || workspace === '' || integration === undefined || integration === '') return undefined
  return { workspace: workspace as WorkspaceUuid, integration: integration as Ref<GitlabIntegration> }
}
