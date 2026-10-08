// SPDX-License-Identifier: EPL-2.0

import {
  type AttachedDoc,
  type Class,
  type Doc,
  type Hyperlink,
  type IntegrationKind,
  type Mixin,
  type PersonId,
  type Ref,
  type Timestamp
} from '@hcengineering/core'
import { type Asset, type IntlString, type Metadata, type Plugin, plugin } from '@hcengineering/platform'
import { type Preference } from '@hcengineering/preference'
import { type Issue, type Project } from '@hcengineering/tracker'
import { type AnyComponent } from '@hcengineering/ui'

/**
 * @public
 * A GitLab account connected to a workspace. Equivalent of a GitHub App installation.
 */
export interface GitlabIntegration extends Doc {
  // Base URL of the GitLab instance, e.g. https://gitlab.com
  host: string
  gitlabUserId: number
  // GitLab username of the connecting user
  login: string
  name: string
  // Huly social id of the user whose OAuth token is used for integration-level operations
  connectedBy: PersonId
  alive: boolean
  error?: string | null
  repositories: number
}

/**
 * @public
 * Visibility of a GitLab project.
 */
export type GitlabVisibility = 'private' | 'internal' | 'public'

/**
 * @public
 * A GitLab project visible to the connecting user with Maintainer access.
 */
export interface GitlabIntegrationRepository extends AttachedDoc {
  attachedTo: Ref<GitlabIntegration>
  projectId: number
  name: string
  pathWithNamespace: string
  webUrl: string
  description: string | null
  visibility: GitlabVisibility
  archived: boolean
  defaultBranch: string | null
  starCount: number
  forksCount: number
  openIssuesCount: number
  lastActivityAt: Timestamp
  // Linked to a Huly project and webhook installed
  enabled: boolean
  gitlabProject: Ref<GitlabProject> | null
  hookId: number | null
  // Not returned by GitLab on the last refresh (lost access or removed)
  deleted: boolean
}

/**
 * @public
 * Mixin on tracker Project linking it to GitLab repositories.
 */
export interface GitlabProject extends Project {
  integration: Ref<GitlabIntegration>
  repositories: Ref<GitlabIntegrationRepository>[]
}

/**
 * @public
 * Per-user authorization state, attachedTo = PersonId of the user.
 */
export interface GitlabAuthentication extends Preference {
  login: string
  name?: string
  avatar?: string
  url?: string
  error?: string | null
  authRequestTime?: Timestamp
}

/**
 * @public
 * Bookkeeping of one synchronized Huly document (issue or comment) and its GitLab counterpart.
 * `_id` equals the Huly document id.
 */
export interface DocSyncInfo extends Doc {
  // Stable key of the GitLab object, e.g. 'gitlab.com/projects/42/issues/7'; '' until it exists in GitLab
  key: string
  // Key of the parent GitLab object (the issue of a note)
  parent?: string
  objectClass: Ref<Class<Doc>>
  // null until a Huly-born document is assigned to a repository
  repository: Ref<GitlabIntegrationRepository> | null
  // GitLab issue iid; 0 for notes and not yet created issues
  gitlabIid: number
  // Last GitLab object received (REST shape)
  external?: unknown
  // Last state both sides agreed on: the base of the three-way merge
  current?: unknown
  // '' when a sync is pending; the pod's sync version when done
  needSync: string
  // GitLab updated_at of `external`, epoch milliseconds
  lastModified?: Timestamp
  // The Huly document was removed
  deleted?: boolean
  error?: string | null
  // The error may go away on retry (expired token, network); re-queued by the next full sync
  retryable?: boolean
  // Parent Huly document of a collection document (set by the trigger)
  attachedTo?: Ref<Doc>
  // Huly person of the GitLab user whose change is pending
  lastGitlabUser?: PersonId | null
}

/**
 * @public
 * Mixin on tracker issues linked to a GitLab issue.
 */
export interface GitlabIssue extends Issue {
  // Web URL of the GitLab issue
  url: Hyperlink
  gitlabIid: number
  repository: Ref<GitlabIntegrationRepository>
}

/**
 * @public
 */
export const gitlabIntegrationKind = 'gitlab' as IntegrationKind

/**
 * @public
 */
export const gitlabUserIntegrationKind = 'gitlab-user' as IntegrationKind

/**
 * @public
 * Per-workspace GitLab OAuth application (host, client id, client secret), stored as an account-service secret.
 */
export const gitlabAppIntegrationKind = 'gitlab-app' as IntegrationKind

/**
 * @public
 */
export const gitlabId = 'gitlab' as Plugin

export default plugin(gitlabId, {
  class: {
    GitlabIntegration: '' as Ref<Class<GitlabIntegration>>,
    GitlabIntegrationRepository: '' as Ref<Class<GitlabIntegrationRepository>>,
    GitlabAuthentication: '' as Ref<Class<GitlabAuthentication>>,
    DocSyncInfo: '' as Ref<Class<DocSyncInfo>>
  },
  mixin: {
    GitlabProject: '' as Ref<Mixin<GitlabProject>>,
    GitlabIssue: '' as Ref<Mixin<GitlabIssue>>
  },
  icon: {
    Gitlab: '' as Asset,
    GitlabRepository: '' as Asset
  },
  component: {
    ConnectApp: '' as AnyComponent
  },
  metadata: {
    // URL of the pod-gitlab service
    GitlabURL: '' as Metadata<string>
  },
  string: {
    Gitlab: '' as IntlString,
    GitlabDesc: '' as IntlString,
    ConfigLabel: '' as IntlString,
    ConfigDescription: '' as IntlString,
    GitlabIssue: '' as IntlString,
    IssueConnectedActivityInfo: '' as IntlString
  }
})
