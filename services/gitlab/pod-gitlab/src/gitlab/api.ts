// SPDX-License-Identifier: EPL-2.0

import type { GitlabHook, GitlabIssueInfo, GitlabIssueInput, GitlabNoteInfo, GitlabProjectInfo, GitlabUser } from './types'

export type FetchFn = typeof fetch

const MAINTAINER_ACCESS_LEVEL = 40

// Retries of a request answered with 429 Too Many Requests
const MAX_RETRIES = 3
const MAX_ERROR_BODY = 500

export type SleepFn = (ms: number) => Promise<void>

const defaultSleep: SleepFn = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayMs (header: string | null): number {
  const seconds = Number(header)
  return header !== null && header !== '' && Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) * 1000 : 1000
}

export class GitlabApiError extends Error {
  constructor (
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'GitlabApiError'
  }
}

export class GitlabApi {
  constructor (
    private readonly host: string,
    private readonly token: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly sleep: SleepFn = defaultSleep
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ data: T, headers: Headers }> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(`${this.host}/api/v4${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
      if (res.status === 429 && attempt < MAX_RETRIES) {
        await this.sleep(retryDelayMs(res.headers.get('retry-after')))
        continue
      }
      if (!res.ok) {
        const text = (await res.text()).slice(0, MAX_ERROR_BODY)
        throw new GitlabApiError(res.status, `GitLab ${method} ${path} failed: ${res.status} ${text}`)
      }
      const raw = await res.text()
      const data = (raw === '' ? undefined : JSON.parse(raw)) as T
      return { data, headers: res.headers }
    }
  }

  async getCurrentUser (): Promise<GitlabUser> {
    return (await this.request<GitlabUser>('GET', '/user')).data
  }

  private async paginate<T> (path: string): Promise<T[]> {
    const result: T[] = []
    const sep = path.includes('?') ? '&' : '?'
    let page: string | null = '1'
    while (page !== null && page !== '') {
      const resp: { data: T[], headers: Headers } = await this.request<T[]>('GET', `${path}${sep}per_page=100&page=${page}`)
      result.push(...resp.data)
      page = resp.headers.get('x-next-page')
    }
    return result
  }

  async listMaintainedProjects (): Promise<GitlabProjectInfo[]> {
    return await this.paginate<GitlabProjectInfo>(`/projects?membership=true&min_access_level=${MAINTAINER_ACCESS_LEVEL}`)
  }

  async ensureProjectHook (projectId: number, url: string, secret: string): Promise<GitlabHook> {
    const payload = {
      url,
      token: secret,
      issues_events: true,
      confidential_issues_events: false,
      merge_requests_events: true,
      note_events: true,
      confidential_note_events: false,
      push_events: false,
      enable_ssl_verification: true
    }
    const hooks = await this.paginate<GitlabHook>(`/projects/${projectId}/hooks`)
    const existing = hooks.find((it) => it.url === url)
    if (existing !== undefined) {
      // Re-apply settings so the secret and event set are always current.
      return (await this.request<GitlabHook>('PUT', `/projects/${projectId}/hooks/${existing.id}`, payload)).data
    }
    return (await this.request<GitlabHook>('POST', `/projects/${projectId}/hooks`, payload)).data
  }

  async deleteProjectHook (projectId: number, hookId: number): Promise<void> {
    try {
      await this.request<undefined>('DELETE', `/projects/${projectId}/hooks/${hookId}`)
    } catch (err: unknown) {
      if (err instanceof GitlabApiError && err.status === 404) {
        return
      }
      throw err
    }
  }

  async getIssue (projectId: number, iid: number): Promise<GitlabIssueInfo> {
    return (await this.request<GitlabIssueInfo>('GET', `/projects/${projectId}/issues/${iid}`)).data
  }

  /** Issues ordered by update time, oldest first; only those updated at or after `updatedAfter` (ISO 8601) when given. */
  async listIssues (projectId: number, updatedAfter?: string): Promise<GitlabIssueInfo[]> {
    const since = updatedAfter !== undefined ? `&updated_after=${encodeURIComponent(updatedAfter)}` : ''
    return await this.paginate<GitlabIssueInfo>(`/projects/${projectId}/issues?order_by=updated_at&sort=asc${since}`)
  }

  async createIssue (projectId: number, input: GitlabIssueInput): Promise<GitlabIssueInfo> {
    return (await this.request<GitlabIssueInfo>('POST', `/projects/${projectId}/issues`, input)).data
  }

  async updateIssue (projectId: number, iid: number, input: GitlabIssueInput): Promise<GitlabIssueInfo> {
    return (await this.request<GitlabIssueInfo>('PUT', `/projects/${projectId}/issues/${iid}`, input)).data
  }

  async listIssueNotes (projectId: number, iid: number): Promise<GitlabNoteInfo[]> {
    return await this.paginate<GitlabNoteInfo>(`/projects/${projectId}/issues/${iid}/notes?order_by=created_at&sort=asc`)
  }

  async getIssueNote (projectId: number, iid: number, noteId: number): Promise<GitlabNoteInfo> {
    return (await this.request<GitlabNoteInfo>('GET', `/projects/${projectId}/issues/${iid}/notes/${noteId}`)).data
  }

  async createIssueNote (projectId: number, iid: number, body: string): Promise<GitlabNoteInfo> {
    return (await this.request<GitlabNoteInfo>('POST', `/projects/${projectId}/issues/${iid}/notes`, { body })).data
  }

  async updateIssueNote (projectId: number, iid: number, noteId: number, body: string): Promise<GitlabNoteInfo> {
    return (await this.request<GitlabNoteInfo>('PUT', `/projects/${projectId}/issues/${iid}/notes/${noteId}`, { body })).data
  }

  async deleteIssueNote (projectId: number, iid: number, noteId: number): Promise<void> {
    try {
      await this.request<undefined>('DELETE', `/projects/${projectId}/issues/${iid}/notes/${noteId}`)
    } catch (err: unknown) {
      if (err instanceof GitlabApiError && err.status === 404) {
        return
      }
      throw err
    }
  }
}
