// SPDX-License-Identifier: EPL-2.0

import type { GitlabMergeRequestState } from '@hcengineering/gitlab'

export type GitlabIssueState = 'opened' | 'closed'

export type { GitlabMergeRequestState } from '@hcengineering/gitlab'

/** The GitLab objects that carry notes, as they appear in REST paths. */
export type GitlabNoteable = 'issues' | 'merge_requests'

export interface GitlabUserRef {
  id: number
  username: string
  name: string
  avatar_url: string | null
}

export interface GitlabUser extends GitlabUserRef {
  web_url: string
}

export interface GitlabNamespace {
  id: number
  name: string
  path: string
  kind: 'user' | 'group'
  full_path: string
}

export interface GitlabProjectInfo {
  id: number
  name: string
  path_with_namespace: string
  web_url: string
  description: string | null
  visibility: 'private' | 'internal' | 'public'
  archived: boolean
  default_branch: string | null
  star_count: number
  forks_count: number
  // Absent when the issues feature is disabled on the project
  open_issues_count?: number
  last_activity_at: string
  namespace: GitlabNamespace
}

export interface GitlabHook {
  id: number
  url: string
}

export interface GitlabTokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  created_at: number
  scope: string
}

export interface GitlabIssueInfo {
  id: number
  iid: number
  project_id: number
  title: string
  description: string | null
  state: GitlabIssueState
  created_at: string
  updated_at: string
  closed_at: string | null
  web_url: string
  confidential: boolean
  author: GitlabUserRef
  assignees: GitlabUserRef[]
  // Set on the closed original of an issue moved to another project
  moved_to_id?: number | null
}

export interface GitlabNoteInfo {
  id: number
  body: string
  author: GitlabUserRef
  created_at: string
  updated_at: string
  // Notes GitLab writes itself ("changed the description", ...)
  system: boolean
  // Internal notes (GitLab 15.0+ "internal", older "confidential")
  internal?: boolean
  confidential?: boolean
  noteable_type: string
  noteable_iid?: number
  // null for plain comments, 'DiscussionNote' for thread replies, 'DiffNote' for comments on diff lines
  type?: string | null
}

export interface GitlabIssueInput {
  title?: string
  description?: string
  // [0] unassigns everyone
  assignee_ids?: number[]
  state_event?: 'close' | 'reopen'
}

export interface GitlabMergeRequestInfo {
  id: number
  iid: number
  project_id: number
  title: string
  description: string | null
  state: GitlabMergeRequestState
  created_at: string
  updated_at: string
  merged_at: string | null
  closed_at: string | null
  web_url: string
  draft: boolean
  source_branch: string
  target_branch: string
  // Head commit; null while GitLab is still preparing a new merge request
  sha: string | null
  detailed_merge_status: string
  has_conflicts: boolean
  blocking_discussions_resolved: boolean
  author: GitlabUserRef
  assignees: GitlabUserRef[]
  reviewers: GitlabUserRef[]
}

export type GitlabReviewState =
  | 'unreviewed'
  | 'review_started'
  | 'reviewed'
  | 'requested_changes'
  | 'approved'
  | 'unapproved'

export interface GitlabMergeRequestReviewer {
  user: GitlabUserRef
  state: GitlabReviewState
}

/** One file of a merge request diff (`/diffs?unidiff=true`). */
export interface GitlabMergeRequestDiff {
  old_path: string
  new_path: string
  a_mode: string
  b_mode: string
  // Hunks only ('@@ …'); empty for binary files and pure renames
  diff: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
}

export interface GitlabCommitRef {
  id: string
}

export interface GitlabMergeRequestInput {
  title?: string
  description?: string
  // [0] unassigns everyone
  assignee_ids?: number[]
  // [0] removes every reviewer
  reviewer_ids?: number[]
  state_event?: 'close' | 'reopen'
}

export interface GitlabApproval {
  user: GitlabUserRef
  // Reported by newer GitLab versions only
  approved_at?: string | null
}

export interface GitlabApprovals {
  approved_by: GitlabApproval[]
}

/** Where a diff note sits; a line is null on the side where it does not exist. */
export interface GitlabDiffPosition {
  base_sha: string
  start_sha: string
  head_sha: string
  // 'text' for lines; 'image' and 'file' positions carry no lines
  position_type: string
  old_path: string
  new_path: string
  old_line: number | null
  new_line: number | null
}

export interface GitlabDiscussionNote extends GitlabNoteInfo {
  resolvable?: boolean
  resolved?: boolean
  resolved_by?: GitlabUserRef | null
  position?: GitlabDiffPosition | null
}

export interface GitlabDiscussion {
  // Hex string, unique per merge request
  id: string
  individual_note: boolean
  notes: GitlabDiscussionNote[]
}

/** A file uploaded to a project for use in markdown (POST /projects/:id/uploads). */
export interface GitlabUploadInfo {
  alt: string
  // '/uploads/<secret>/<name>': the path markdown uses, relative to the project
  url: string
  full_path: string
  markdown: string
}
