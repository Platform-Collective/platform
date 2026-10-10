// SPDX-License-Identifier: EPL-2.0

import type {
  GitlabApprovals,
  GitlabCommitRef,
  GitlabDiscussion,
  GitlabDiscussionNote,
  GitlabHook,
  GitlabIssueInfo,
  GitlabIssueInput,
  GitlabMergeRequestDiff,
  GitlabMergeRequestInfo,
  GitlabMergeRequestInput,
  GitlabMergeRequestReviewer,
  GitlabNoteable,
  GitlabNoteInfo,
  GitlabProjectInfo,
  GitlabUploadInfo,
  GitlabUser
} from './types'

export type FetchFn = typeof fetch

const MAINTAINER_ACCESS_LEVEL = 40

// Retries of a request answered with 429 Too Many Requests
const MAX_RETRIES = 3
const MAX_ERROR_BODY = 500

export type SleepFn = (ms: number) => Promise<void>

const defaultSleep: SleepFn = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** A SleepFn that ends early, rejecting with the signal's reason, once `signal` aborts (a worker that closes). */
export function abortableSleep (signal: AbortSignal): SleepFn {
  return async (ms) => {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(signal.reason)
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}

const MAX_RETRY_DELAY_MS = 60 * 1000
const DEFAULT_RETRY_DELAY_MS = 1000
const PAGE_SIZE = 100

/** How long to wait after a 429: Retry-After seconds, else until RateLimit-Reset, else a second. */
export function retryDelayMs (headers: Headers, nowMs: number): number {
  const retryAfter = headers.get('retry-after')
  const seconds = Number(retryAfter)
  if (retryAfter !== null && retryAfter !== '' && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
  }
  const resetAt = resetAtMs(headers, nowMs)
  if (resetAt !== undefined) return Math.min(Math.max(resetAt - nowMs, 0), MAX_RETRY_DELAY_MS)
  return DEFAULT_RETRY_DELAY_MS
}

// Below this a RateLimit-Reset is seconds from now (the IETF draft's form), not epoch seconds (GitLab's)
const MIN_EPOCH_SECONDS = 1e9

/** When the rate limit resets, in epoch ms: RateLimit-Reset as epoch seconds, or as seconds from now when small. */
function resetAtMs (headers: Headers, nowMs: number): number | undefined {
  const reset = Number(headers.get('ratelimit-reset'))
  if (headers.get('ratelimit-reset') === null || !Number.isFinite(reset) || reset <= 0) return undefined
  return reset < MIN_EPOCH_SECONDS ? nowMs + reset * 1000 : reset * 1000
}

export class GitlabApiError extends Error {
  constructor (
    readonly status: number,
    message: string,
    // Raw response body (cut to MAX_ERROR_BODY), for logs only: never sent to a browser
    readonly detail?: string,
    // Epoch ms when GitLab's rate limit resets (429)
    readonly retryAt?: number
  ) {
    super(message)
    this.name = 'GitlabApiError'
  }
}

/** GitLab answered 404: deleted, never existed, or not visible to the token. */
export function isNotFound (err: unknown): boolean {
  return err instanceof GitlabApiError && err.status === 404
}

export const MAX_ERROR_SUMMARY = 200

/** GitLab's own error text from a JSON body ({ message } or { error }); any other body stays out of messages. */
export function gitlabErrorSummary (body: string): string | undefined {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return undefined
  }
  if (json === null || typeof json !== 'object') return undefined
  const value = (json as Record<string, unknown>).message ?? (json as Record<string, unknown>).error
  const text = typeof value === 'string' ? value : value !== undefined && value !== null ? JSON.stringify(value) : ''
  return text === '' ? undefined : text.slice(0, MAX_ERROR_SUMMARY)
}

/** GITLAB_READONLY=true: nothing is written to GitLab except the project hooks. Read on every call, like GitHub. */
export function isGitlabWriteAllowed (env: Record<string, string | undefined> = process.env): boolean {
  return env.GITLAB_READONLY !== 'true'
}

/** A write refused by GITLAB_READONLY; not permanent, so the change is retried once writes are allowed again. */
export class GitlabReadonlyError extends Error {
  constructor (method: string, path: string) {
    super(`GitLab is read-only (GITLAB_READONLY): ${method} ${path} not sent`)
    this.name = 'GitlabReadonlyError'
  }
}

/** A download larger than the caller's limit. */
export class GitlabUploadTooLargeError extends Error {
  constructor (
    readonly size: number,
    readonly limit: number
  ) {
    super(`GitLab upload of ${size} bytes is larger than the ${limit} byte limit`)
    this.name = 'GitlabUploadTooLargeError'
  }
}

// Image formats recognised by their first bytes; SVG is not among them, so it stays application/octet-stream
const IMAGE_SIGNATURES: Array<{ type: string, matches: (data: Buffer) => boolean }> = [
  {
    type: 'image/png',
    matches: (data) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  { type: 'image/jpeg', matches: (data) => data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  { type: 'image/gif', matches: (data) => ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('latin1')) },
  {
    type: 'image/webp',
    matches: (data) =>
      data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP'
  },
  { type: 'image/bmp', matches: (data) => data.subarray(0, 2).toString('latin1') === 'BM' },
  { type: 'image/avif', matches: (data) => data.subarray(4, 12).toString('latin1') === 'ftypavif' }
]

/**
 * The type of a downloaded upload: GitLab's API serves every upload as application/octet-stream, so an unspecific type
 * is replaced by the image type its bytes show.
 */
export function uploadContentType (declared: string | null, data: Buffer): string {
  const type = (declared ?? '').split(';')[0].trim().toLowerCase()
  if (type !== '' && type !== 'application/octet-stream') return declared as string
  return IMAGE_SIGNATURES.find((it) => it.matches(data))?.type ?? 'application/octet-stream'
}

// Markdown may hold a file name URL-encoded or not; the API path needs it encoded exactly once
function decodeFileName (name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

// Hooks stay writable in read-only mode: without them no event reaches the service
function isHookPath (path: string): boolean {
  return /^\/projects\/\d+\/hooks(\/|$)/.test(path)
}

export class GitlabApi {
  constructor (
    private readonly host: string,
    private readonly token: string,
    private readonly fetchFn: FetchFn,
    private readonly sleep: SleepFn = defaultSleep,
    private readonly now: () => number = Date.now
  ) {}

  // followRedirects: upload downloads only (see safeFetch); any other redirect is an error
  private async send (method: string, path: string, body?: unknown, followRedirects = false): Promise<Response> {
    if (method !== 'GET' && !isHookPath(path) && !isGitlabWriteAllowed()) {
      throw new GitlabReadonlyError(method, path)
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` }
    // A form sets its own multipart Content-Type with the boundary
    const form = body instanceof FormData
    if (body !== undefined && !form) {
      headers['Content-Type'] = 'application/json'
    }
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(`${this.host}/api/v4${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
        ...(followRedirects ? { redirect: 'follow' as const } : {})
      })
      if (res.status === 429 && attempt < MAX_RETRIES) {
        await this.sleep(retryDelayMs(res.headers, this.now()))
        continue
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, MAX_ERROR_BODY)
        const summary = gitlabErrorSummary(body)
        throw new GitlabApiError(
          res.status,
          `GitLab ${method} ${path} failed: ${res.status}${summary !== undefined ? ` ${summary}` : ''}`,
          body,
          res.status === 429 ? resetAtMs(res.headers, this.now()) : undefined
        )
      }
      return res
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ data: T, headers: Headers }> {
    const res = await this.send(method, path, body)
    const raw = await res.text()
    let data: T
    try {
      data = (raw === '' ? undefined : JSON.parse(raw)) as T
    } catch {
      // The parser's message quotes the body: keep it for logs only
      throw new GitlabApiError(
        res.status,
        `GitLab ${method} ${path} returned an invalid JSON response`,
        raw.slice(0, MAX_ERROR_BODY)
      )
    }
    return { data, headers: res.headers }
  }

  async getCurrentUser (): Promise<GitlabUser> {
    return (await this.request<GitlabUser>('GET', '/user')).data
  }

  /** One page of a listing at a time; a caller that stops early stops the paging. */
  private async * pages<T>(path: string): AsyncGenerator<T[]> {
    const sep = path.includes('?') ? '&' : '?'
    let page: string | null = '1'
    while (page !== null && page !== '') {
      const resp: { data: T[], headers: Headers } = await this.request<T[]>(
        'GET',
        `${path}${sep}per_page=${PAGE_SIZE}&page=${page}`
      )
      yield resp.data
      page = resp.headers.get('x-next-page')
    }
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const result: T[] = []
    for await (const page of this.pages<T>(path)) result.push(...page)
    return result
  }

  async listMaintainedProjects (): Promise<GitlabProjectInfo[]> {
    return await this.paginate<GitlabProjectInfo>(
      `/projects?membership=true&min_access_level=${MAINTAINER_ACCESS_LEVEL}`
    )
  }

  /** One project by its stable id; follows renames and transfers. */
  async getProject (projectId: number): Promise<GitlabProjectInfo> {
    return (await this.request<GitlabProjectInfo>('GET', `/projects/${projectId}`)).data
  }

  /** Uploads a file for use in markdown; GitLab answers with its `/uploads/<secret>/<name>` path. A write (read-only mode refuses it). */
  async uploadFile (projectId: number, filename: string, data: Buffer, contentType: string): Promise<GitlabUploadInfo> {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(data)], { type: contentType }), filename)
    return (await this.request<GitlabUploadInfo>('POST', `/projects/${projectId}/uploads`, form)).data
  }

  /** Downloads an upload by its secret and file name (GitLab 17.4 and later). */
  async downloadUpload (
    projectId: number,
    secret: string,
    filename: string,
    maxBytes: number
  ): Promise<{ data: Buffer, contentType: string }> {
    const name = decodeFileName(filename)
    // A dot segment would normalize to another endpoint (the project's upload list)
    if (['.', '..'].includes(filename) || ['.', '..'].includes(name)) {
      throw new Error(`Invalid upload file name: ${filename}`)
    }
    // GitLab with object storage redirects to the object store
    const res = await this.send(
      'GET',
      `/projects/${projectId}/uploads/${secret}/${encodeURIComponent(name)}`,
      undefined,
      true
    )
    const declared = Number(res.headers.get('content-length'))
    if (declared > maxBytes) {
      await res.body?.cancel()
      throw new GitlabUploadTooLargeError(declared, maxBytes)
    }
    // Stream the body so a response without content-length is never buffered beyond the limit
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = res.body?.getReader()
    if (reader !== undefined) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > maxBytes) {
          await reader.cancel()
          throw new GitlabUploadTooLargeError(total, maxBytes)
        }
        chunks.push(value)
      }
    }
    const data = Buffer.concat(chunks)
    return { data, contentType: uploadContentType(res.headers.get('content-type'), data) }
  }

  /** Installs or updates the hook at `url`. */
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
    // Re-apply settings so the secret and event set are always current.
    return existing !== undefined
      ? (await this.request<GitlabHook>('PUT', `/projects/${projectId}/hooks/${existing.id}`, payload)).data
      : (await this.request<GitlabHook>('POST', `/projects/${projectId}/hooks`, payload)).data
  }

  // Deleting what is already gone is done
  private async deleteIgnoringNotFound (path: string): Promise<void> {
    await this.ignoringNotFound(async () => await this.request<undefined>('DELETE', path))
  }

  private async ignoringNotFound (action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
    } catch (err: unknown) {
      if (!isNotFound(err)) throw err
    }
  }

  async deleteProjectHook (projectId: number, hookId: number): Promise<void> {
    await this.deleteIgnoringNotFound(`/projects/${projectId}/hooks/${hookId}`)
  }

  async getIssue (projectId: number, iid: number): Promise<GitlabIssueInfo> {
    return (await this.request<GitlabIssueInfo>('GET', `/projects/${projectId}/issues/${iid}`)).data
  }

  /** Issues ordered by update time, oldest first, one page at a time; only those updated at or after `updatedAfter`. */
  async * listIssuePages (projectId: number, updatedAfter?: string): AsyncGenerator<GitlabIssueInfo[]> {
    const since = updatedAfter !== undefined ? `&updated_after=${encodeURIComponent(updatedAfter)}` : ''
    yield * this.pages<GitlabIssueInfo>(`/projects/${projectId}/issues?order_by=updated_at&sort=asc${since}`)
  }

  async createIssue (projectId: number, input: GitlabIssueInput): Promise<GitlabIssueInfo> {
    return (await this.request<GitlabIssueInfo>('POST', `/projects/${projectId}/issues`, input)).data
  }

  async updateIssue (projectId: number, iid: number, input: GitlabIssueInput): Promise<GitlabIssueInfo> {
    return (await this.request<GitlabIssueInfo>('PUT', `/projects/${projectId}/issues/${iid}`, input)).data
  }

  /** Moves an issue to another project; GitLab copies its notes and closes the original. */
  async moveIssue (projectId: number, iid: number, toProjectId: number): Promise<GitlabIssueInfo> {
    return (
      await this.request<GitlabIssueInfo>('POST', `/projects/${projectId}/issues/${iid}/move`, {
        to_project_id: toProjectId
      })
    ).data
  }

  private notesPath (projectId: number, noteable: GitlabNoteable, iid: number): string {
    return `/projects/${projectId}/${noteable}/${iid}/notes`
  }

  /** Notes of an issue or a merge request, oldest first. */
  async listNotes (projectId: number, noteable: GitlabNoteable, iid: number): Promise<GitlabNoteInfo[]> {
    return await this.paginate<GitlabNoteInfo>(
      `${this.notesPath(projectId, noteable, iid)}?order_by=created_at&sort=asc`
    )
  }

  /** One note of an issue or a merge request. */
  async getNote (projectId: number, noteable: GitlabNoteable, iid: number, noteId: number): Promise<GitlabNoteInfo> {
    return (await this.request<GitlabNoteInfo>('GET', `${this.notesPath(projectId, noteable, iid)}/${noteId}`)).data
  }

  /** Adds a note to an issue or a merge request. */
  async createNote (projectId: number, noteable: GitlabNoteable, iid: number, body: string): Promise<GitlabNoteInfo> {
    return (await this.request<GitlabNoteInfo>('POST', this.notesPath(projectId, noteable, iid), { body })).data
  }

  /** Edits a note of an issue or a merge request. */
  async updateNote (
    projectId: number,
    noteable: GitlabNoteable,
    iid: number,
    noteId: number,
    body: string
  ): Promise<GitlabNoteInfo> {
    return (
      await this.request<GitlabNoteInfo>('PUT', `${this.notesPath(projectId, noteable, iid)}/${noteId}`, { body })
    ).data
  }

  /** Deletes a note of an issue or a merge request; a note that is already gone is fine. */
  async deleteNote (projectId: number, noteable: GitlabNoteable, iid: number, noteId: number): Promise<void> {
    await this.deleteIgnoringNotFound(`${this.notesPath(projectId, noteable, iid)}/${noteId}`)
  }

  async getMergeRequest (projectId: number, iid: number): Promise<GitlabMergeRequestInfo> {
    return (await this.request<GitlabMergeRequestInfo>('GET', `/projects/${projectId}/merge_requests/${iid}`)).data
  }

  /** Merge requests of every state, oldest update first, one page at a time. */
  async * listMergeRequestPages (projectId: number, updatedAfter?: string): AsyncGenerator<GitlabMergeRequestInfo[]> {
    const since = updatedAfter !== undefined ? `&updated_after=${encodeURIComponent(updatedAfter)}` : ''
    yield * this.pages<GitlabMergeRequestInfo>(
      `/projects/${projectId}/merge_requests?order_by=updated_at&sort=asc&state=all${since}`
    )
  }

  async updateMergeRequest (
    projectId: number,
    iid: number,
    input: GitlabMergeRequestInput
  ): Promise<GitlabMergeRequestInfo> {
    return (await this.request<GitlabMergeRequestInfo>('PUT', `/projects/${projectId}/merge_requests/${iid}`, input))
      .data
  }

  async listMergeRequestReviewers (projectId: number, iid: number): Promise<GitlabMergeRequestReviewer[]> {
    return (
      await this.request<GitlabMergeRequestReviewer[]>('GET', `/projects/${projectId}/merge_requests/${iid}/reviewers`)
    ).data
  }

  async listMergeRequestCommits (projectId: number, iid: number): Promise<GitlabCommitRef[]> {
    return await this.paginate<GitlabCommitRef>(`/projects/${projectId}/merge_requests/${iid}/commits`)
  }

  /**
   * The whole diff in `git diff` format (GitLab 17.9 and later, 404 before), handed over chunk by chunk; reading stops
   * when `onText` returns false, so a huge diff is never held in memory.
   */
  async readMergeRequestRawDiffs (projectId: number, iid: number, onText: (text: string) => boolean): Promise<void> {
    const res = await this.send('GET', `/projects/${projectId}/merge_requests/${iid}/raw_diffs`)
    const reader = res.body?.getReader()
    if (reader === undefined) return
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!onText(decoder.decode(value, { stream: true }))) {
        await reader.cancel()
        return
      }
    }
    const rest = decoder.decode()
    if (rest !== '') onText(rest)
  }

  /** The per-file diffs (`/diffs?unidiff=true`), one page at a time. */
  async * listMergeRequestDiffPages (projectId: number, iid: number): AsyncGenerator<GitlabMergeRequestDiff[]> {
    yield * this.pages<GitlabMergeRequestDiff>(`/projects/${projectId}/merge_requests/${iid}/diffs?unidiff=true`)
  }

  async getMergeRequestApprovals (projectId: number, iid: number): Promise<GitlabApprovals> {
    return (await this.request<GitlabApprovals>('GET', `/projects/${projectId}/merge_requests/${iid}/approvals`)).data
  }

  /** Approves as the token's user; GitLab answers 401 when that user may not approve. */
  async approveMergeRequest (projectId: number, iid: number): Promise<void> {
    await this.request<unknown>('POST', `/projects/${projectId}/merge_requests/${iid}/approve`)
  }

  /** Revokes the token user's approval; a 404 means there was none. */
  async unapproveMergeRequest (projectId: number, iid: number): Promise<void> {
    await this.ignoringNotFound(
      async () => await this.request<unknown>('POST', `/projects/${projectId}/merge_requests/${iid}/unapprove`)
    )
  }

  private discussionsPath (projectId: number, iid: number): string {
    return `/projects/${projectId}/merge_requests/${iid}/discussions`
  }

  async listMergeRequestDiscussions (projectId: number, iid: number): Promise<GitlabDiscussion[]> {
    return await this.paginate<GitlabDiscussion>(this.discussionsPath(projectId, iid))
  }

  async getMergeRequestDiscussion (projectId: number, iid: number, discussionId: string): Promise<GitlabDiscussion> {
    return (
      await this.request<GitlabDiscussion>(
        'GET',
        `${this.discussionsPath(projectId, iid)}/${encodeURIComponent(discussionId)}`
      )
    ).data
  }

  async createMergeRequestDiscussionNote (
    projectId: number,
    iid: number,
    discussionId: string,
    body: string
  ): Promise<GitlabDiscussionNote> {
    const path = `${this.discussionsPath(projectId, iid)}/${encodeURIComponent(discussionId)}/notes`
    return (await this.request<GitlabDiscussionNote>('POST', path, { body })).data
  }

  async updateMergeRequestDiscussionNote (
    projectId: number,
    iid: number,
    discussionId: string,
    noteId: number,
    body: string
  ): Promise<GitlabDiscussionNote> {
    const path = `${this.discussionsPath(projectId, iid)}/${encodeURIComponent(discussionId)}/notes/${noteId}`
    return (await this.request<GitlabDiscussionNote>('PUT', path, { body })).data
  }

  async deleteMergeRequestDiscussionNote (
    projectId: number,
    iid: number,
    discussionId: string,
    noteId: number
  ): Promise<void> {
    await this.deleteIgnoringNotFound(
      `${this.discussionsPath(projectId, iid)}/${encodeURIComponent(discussionId)}/notes/${noteId}`
    )
  }

  async resolveMergeRequestDiscussion (
    projectId: number,
    iid: number,
    discussionId: string,
    resolved: boolean
  ): Promise<GitlabDiscussion> {
    const path = `${this.discussionsPath(projectId, iid)}/${encodeURIComponent(discussionId)}?resolved=${resolved}`
    return (await this.request<GitlabDiscussion>('PUT', path)).data
  }
}
