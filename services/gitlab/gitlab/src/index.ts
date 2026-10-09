// SPDX-License-Identifier: EPL-2.0

import {
  type AttachedDoc,
  type Blob,
  type Class,
  type Doc,
  type Hyperlink,
  type IntegrationKind,
  type Markup,
  type Mixin,
  type PersonId,
  type Ref,
  type Timestamp
} from '@hcengineering/core'
import { type Asset, type IntlString, type Metadata, type Plugin, plugin } from '@hcengineering/platform'
import { type Preference } from '@hcengineering/preference'
import { type Issue, type Project } from '@hcengineering/tracker'
import { type AnyComponent } from '@hcengineering/ui'
import { type ActivityMessage } from '@hcengineering/activity'
import { type Person } from '@hcengineering/contact'
import task, { type TaskStatusFactory, type TaskTypeDescriptor } from '@hcengineering/task'
import { type ToDo } from '@hcengineering/time'
// Direct file import: the package root pulls in Svelte components
import { PaletteColorIndexes } from '@hcengineering/ui/src/colors'

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
  // How images from GitLab reach Huly; absent means DEFAULT_IMAGE_MODE
  imageMode?: GitlabImageMode
}

/**
 * @public
 * Visibility of a GitLab project.
 */
export type GitlabVisibility = 'private' | 'internal' | 'public'

/**
 * @public
 * How images from GitLab reach Huly: linked, so GitLab's permissions decide who sees them, or copied
 * into the workspace's storage.
 */
export type GitlabImageMode = 'link' | 'copy'

/** @public Images from GitLab are linked unless the integration chooses to copy them. */
export const DEFAULT_IMAGE_MODE: GitlabImageMode = 'link'

/**
 * @public
 * Where a GitlabUpload came from: downloaded from GitLab, or uploaded from Huly.
 */
export type GitlabUploadOrigin = 'gitlab' | 'huly'

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
  // Merge requests: head commit sha of the stored diff
  patchSha?: string | null
  // Merge requests: ToDos created so far, 'review:<person>' or 'fix:<person>'; a deleted ToDo is not created again
  todos?: string[]
  // Merge requests: the review state last seen per GitLab user id, { user, state } (the pod's ReviewRecord)
  reviews?: Record<string, unknown>
}

/**
 * @public
 * Mixin on tracker issues linked to a GitLab issue.
 */
export interface GitlabIssue extends Issue {
  // Web URL of the GitLab issue
  url: Hyperlink
  gitlabIid: number
  // The repository the issue lives in; null when the user chose to keep it in Huly only; undefined when nothing was
  // picked (a mixin that only carries syncError)
  repository?: Ref<GitlabIntegrationRepository> | null
  // The last GitLab sync error, for the browser; DocSyncInfo reaches the GitLab service only
  syncError?: string | null
}

/**
 * @public
 * State of a GitLab merge request.
 */
export type GitlabMergeRequestState = 'opened' | 'closed' | 'merged' | 'locked'

/**
 * @public
 * A GitLab merge request in Huly. Created by the GitLab service only; `_id` equals its DocSyncInfo id.
 */
export interface GitlabMergeRequest extends Issue {
  url: Hyperlink
  gitlabIid: number
  repository: Ref<GitlabIntegrationRepository>
  // Mirrored from GitLab, read-only in Huly
  state: GitlabMergeRequestState
  draft: boolean
  sourceBranch: string
  targetBranch: string
  // GitLab detailed_merge_status, e.g. 'mergeable', 'conflict', 'ci_must_pass'
  mergeStatus: string
  hasConflicts: boolean
  mergedAt: Timestamp | null
  closedAt: Timestamp | null
  commits: number
  files: number
  // Changed lines in the diff
  additions: number
  deletions: number
  // Synchronized both ways
  reviewers: Array<Ref<Person>> | null
  // Mirrored from GitLab approvals, read-only in Huly
  approvedBy: Array<Ref<Person>> | null
  // Collection of GitlabReviewComment
  reviewComments: number
  // The last GitLab sync error, for the browser; DocSyncInfo reaches the GitLab service only
  syncError?: string | null
}

/**
 * @public
 * The stored diff of a merge request. Not an attachment, so it is never listed or offered for
 * download; the diff panel and review-thread snippets read it.
 */
export interface GitlabPatch extends AttachedDoc {
  attachedTo: Ref<GitlabMergeRequest>
  file: Ref<Blob>
  size: number
  lastModified: Timestamp
}

/**
 * @public
 * A ToDo the GitLab service created for a merge request.
 */
export interface GitlabTodo extends ToDo {
  purpose: 'review' | 'fix'
}

/**
 * @public
 * A review state change in GitLab: an approval, a revoked approval, requested changes or a finished review.
 */
export type GitlabReviewKind = 'approved' | 'unapproved' | 'requested_changes' | 'reviewed'

/**
 * @public
 * A review message in a merge request's activity, written as the reviewer. Huly users create 'approved' and
 * 'unapproved' ones to approve or revoke in GitLab.
 */
export interface GitlabReview extends ActivityMessage {
  state: GitlabReviewKind
  // The last GitLab sync error, for the browser; DocSyncInfo reaches the GitLab service only
  syncError?: string | null
}

/**
 * @public
 * A GitLab discussion on a diff line. Its notes are GitlabReviewComments with the same discussionId.
 */
export interface GitlabReviewThread extends ActivityMessage {
  discussionId: string
  // File path on the new side, and on the old side (they differ for renames)
  path: string
  oldPath: string
  // null on the side where the line does not exist (an added or a removed line)
  line: number | null
  oldLine: number | null
  isResolved: boolean
  resolvedBy: PersonId | null
  // Written on an older head commit than the merge request's current one
  isOutdated: boolean
}

/**
 * @public
 * One note of a diff discussion, attached to the merge request.
 */
export interface GitlabReviewComment extends AttachedDoc {
  attachedTo: Ref<GitlabMergeRequest>
  discussionId: string
  body: Markup
}

/**
 * @public
 * A diff file marked as viewed; `sha` identifies the file's version in the diff.
 */
export interface GitlabViewedFile {
  fileName: string
  sha: string
}

/**
 * @public
 * Huly only: the diff files one person marked as viewed on one merge request.
 */
export interface GitlabMergeRequestReview extends AttachedDoc {
  attachedTo: Ref<GitlabMergeRequest>
  author: Ref<Person>
  files: GitlabViewedFile[]
}

/**
 * @public
 * A Huly file and the GitLab upload it was copied to or from.
 */
export interface GitlabUpload extends Doc {
  repository: Ref<GitlabIntegrationRepository>
  // '/uploads/<secret>/<name>', as GitLab markdown refers to it
  path: string
  // The blob name in the workspace's storage
  file: Ref<Blob>
  origin: GitlabUploadOrigin
}

/** @public The integration's image mode, with the default applied. */
export function imageModeOf (integration: Pick<GitlabIntegration, 'imageMode'>): GitlabImageMode {
  return integration.imageMode ?? DEFAULT_IMAGE_MODE
}

/** @public The fragment that marks a link in Huly as a GitLab image. */
export const GITLAB_IMAGE_FRAGMENT = 'gitlab-image'

/** @public Matches the href of a GitLab image link, with or without its encoded size. */
export const GITLAB_IMAGE_HREF_PATTERN = `#${GITLAB_IMAGE_FRAGMENT}(=|$)`

/**
 * @public
 * Statuses of the merge request task type.
 */
export const gitlabMergeRequestStates: TaskStatusFactory[] = [
  { category: task.statusCategory.Active, statuses: [['Open', PaletteColorIndexes.Cerulean]] },
  { category: task.statusCategory.Won, statuses: [['Merged', PaletteColorIndexes.Grass]] },
  { category: task.statusCategory.Lost, statuses: [['Closed', PaletteColorIndexes.Coin]] }
]

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
    DocSyncInfo: '' as Ref<Class<DocSyncInfo>>,
    GitlabMergeRequest: '' as Ref<Class<GitlabMergeRequest>>,
    GitlabPatch: '' as Ref<Class<GitlabPatch>>,
    GitlabReview: '' as Ref<Class<GitlabReview>>,
    GitlabReviewThread: '' as Ref<Class<GitlabReviewThread>>,
    GitlabReviewComment: '' as Ref<Class<GitlabReviewComment>>,
    GitlabMergeRequestReview: '' as Ref<Class<GitlabMergeRequestReview>>,
    GitlabUpload: '' as Ref<Class<GitlabUpload>>
  },
  mixin: {
    GitlabProject: '' as Ref<Mixin<GitlabProject>>,
    GitlabIssue: '' as Ref<Mixin<GitlabIssue>>,
    GitlabTodo: '' as Ref<Mixin<GitlabTodo>>
  },
  icon: {
    Gitlab: '' as Asset,
    GitlabRepository: '' as Asset,
    MergeRequest: '' as Asset,
    MergeRequestMerged: '' as Asset,
    MergeRequestClosed: '' as Asset,
    Image: '' as Asset
  },
  descriptors: {
    MergeRequest: '' as Ref<TaskTypeDescriptor>
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
    IssueConnectedActivityInfo: '' as IntlString,
    MergeRequest: '' as IntlString,
    MergeRequests: '' as IntlString,
    MergeRequestConnectedActivityInfo: '' as IntlString
  }
})
