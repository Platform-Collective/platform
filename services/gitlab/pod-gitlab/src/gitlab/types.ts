// SPDX-License-Identifier: EPL-2.0

import type { GitlabIssueState } from '../sync/status'

export type { GitlabIssueState } from '../sync/status'

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
}

export interface GitlabIssueInput {
  title?: string
  description?: string
  // [0] unassigns everyone
  assignee_ids?: number[]
  state_event?: 'close' | 'reopen'
}
