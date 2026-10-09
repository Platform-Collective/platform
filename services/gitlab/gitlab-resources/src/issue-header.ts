// SPDX-License-Identifier: EPL-2.0

export interface IssueHeaderInput {
  mergeRequest?: { syncError?: string | null }
  link?: { gitlabIid?: number, repository?: string | null, syncError?: string | null }
  linkedRepositories: number
  readonly: boolean
}

/** What the GitLab header of an issue shows. */
export interface IssueHeaderState {
  kind: 'mergeRequest' | 'linked' | 'creating' | 'failed' | 'pick' | 'none'
  // GitLab's last sync error for this issue; null when there is none
  error: string | null
}

export function issueHeaderState (input: IssueHeaderInput): IssueHeaderState {
  const { mergeRequest, link } = input
  if (mergeRequest !== undefined) return { kind: 'mergeRequest', error: mergeRequest.syncError ?? null }
  const error = link?.syncError ?? null
  if ((link?.gitlabIid ?? 0) > 0) return { kind: 'linked', error }
  // Picked: the GitLab service is creating the issue, or GitLab refused it
  if (link?.repository != null) return { kind: error === null ? 'creating' : 'failed', error }
  if (input.linkedRepositories > 0 && !input.readonly) return { kind: 'pick', error }
  return { kind: 'none', error }
}
