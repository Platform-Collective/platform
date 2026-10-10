// SPDX-License-Identifier: EPL-2.0

import type { Integration } from '@hcengineering/account-client'
import type { MeasureContext, PersonId, Ref, WorkspaceUuid } from '@hcengineering/core'
import type { GitlabIntegration } from '@hcengineering/gitlab'
import type { HookTarget } from '../hooks'
import type { WorkspaceWorkerState } from '../workspace-state'
import { errorMessage } from '../sync/errors'
import type { GitlabImageAccess } from '../sync/image-access'
import type { GitlabHookKind, GitlabHookPayload, SessionLease } from './worker'

const WORKSPACE_CHECK_INTERVAL_MS = 5 * 60 * 1000

/** The worker surface the platform uses. */
export interface WorkerHandle {
  init: () => Promise<void>
  start: () => void
  close: () => Promise<void>
  ownsProject: (webUrl: string, projectId: number) => boolean
  // `integration`: only that integration's repositories (an event from a scoped hook)
  handleWebhook: (
    kind: GitlabHookKind,
    payload: GitlabHookPayload,
    integration?: Ref<GitlabIntegration>
  ) => Promise<void>
  requestFullSync: () => void
  forgetTokens: () => void
  lease: (accountId: PersonId) => SessionLease | undefined
  gitlabImage: (url: string, actor: PersonId) => Promise<GitlabImageAccess>
}

export interface PlatformDeps {
  ctx: MeasureContext
  // Workspaces with at least one GitLab connection
  listWorkspaces: () => Promise<WorkspaceUuid[]>
  // undefined when GitLab is disabled in the workspace
  createWorker: (workspace: WorkspaceUuid) => Promise<WorkerHandle | undefined>
  checkIntervalMs?: number
  // Unset: every listed workspace connects (tests)
  workspaceState?: (workspace: WorkspaceUuid) => Promise<WorkspaceWorkerState>
}

export function workspacesWithGitlab (integrations: Array<Pick<Integration, 'workspaceUuid'>>): WorkspaceUuid[] {
  const result = new Set<WorkspaceUuid>()
  for (const it of integrations) {
    if (it.workspaceUuid != null && it.workspaceUuid !== '') result.add(it.workspaceUuid)
  }
  return [...result]
}

/** Runs one GitlabWorker per workspace with a GitLab connection and routes webhooks to them. */
export class GitlabPlatform {
  private readonly workers = new Map<WorkspaceUuid, WorkerHandle>()
  private checking: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setInterval> | undefined

  constructor (private readonly deps: PlatformDeps) {}

  start (): void {
    void this.checkWorkspaces()
    this.timer = setInterval(() => {
      void this.checkWorkspaces()
    }, this.deps.checkIntervalMs ?? WORKSPACE_CHECK_INTERVAL_MS)
  }

  /** Starts workers for new workspaces and closes those without a connection; calls are serialised. */
  async checkWorkspaces (): Promise<void> {
    this.checking = this.checking.then(async () => {
      try {
        await this.doCheck()
      } catch (err: unknown) {
        this.deps.ctx.error('gitlab workspace check failed', { error: errorMessage(err) })
      }
    })
    await this.checking
  }

  getWorker (workspace: WorkspaceUuid): WorkerHandle | undefined {
    return this.workers.get(workspace)
  }

  /** Routes an event to the workers that link its project; a scoped event only to its own workspace. */
  async dispatch (kind: GitlabHookKind, payload: GitlabHookPayload, target?: HookTarget): Promise<void> {
    const projectId = payload.project?.id
    const webUrl = payload.project?.web_url
    if (projectId === undefined || webUrl === undefined) return
    for (const [workspace, worker] of this.workers) {
      if (target !== undefined && workspace !== target.workspace) continue
      if (!worker.ownsProject(webUrl, projectId)) continue
      try {
        await worker.handleWebhook(kind, payload, target?.integration)
      } catch (err: unknown) {
        this.deps.ctx.error('gitlab webhook dispatch failed', { workspace, kind, error: errorMessage(err) })
      }
    }
  }

  async close (): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer)
    await this.checking
    await Promise.all(
      [...this.workers.values()].map(async (worker) => {
        await worker.close()
      })
    )
    this.workers.clear()
  }

  private async doCheck (): Promise<void> {
    const wanted = new Set(await this.deps.listWorkspaces())
    for (const [workspace, worker] of [...this.workers]) {
      const state = wanted.has(workspace) ? await this.stateOf(workspace) : 'skip'
      if (state !== 'skip' && state !== 'inactive') continue
      this.workers.delete(workspace)
      this.deps.ctx.info('gitlab worker stopped', { workspace, state })
      await worker.close().catch((err: unknown) => {
        this.deps.ctx.error('failed to close gitlab worker', { workspace, error: errorMessage(err) })
      })
    }
    for (const workspace of wanted) {
      if (this.workers.has(workspace)) continue
      if ((await this.stateOf(workspace)) !== 'connect') continue
      let worker: WorkerHandle | undefined
      try {
        worker = await this.deps.createWorker(workspace)
        if (worker === undefined) continue
        await worker.init()
        this.workers.set(workspace, worker)
        worker.start()
        this.deps.ctx.info('gitlab worker started', { workspace })
      } catch (err: unknown) {
        // Retried on the next check; the failed worker's connection must not leak
        this.deps.ctx.error('failed to start gitlab worker', { workspace, error: errorMessage(err) })
        await worker?.close().catch((closeErr: unknown) => {
          this.deps.ctx.error('failed to close gitlab worker', { workspace, error: errorMessage(closeErr) })
        })
      }
    }
  }

  // Unknown state (account service unavailable): keep what runs, start nothing new
  private async stateOf (workspace: WorkspaceUuid): Promise<WorkspaceWorkerState> {
    if (this.deps.workspaceState === undefined) return 'connect'
    try {
      return await this.deps.workspaceState(workspace)
    } catch (err: unknown) {
      this.deps.ctx.warn('gitlab workspace state unavailable', { workspace, error: errorMessage(err) })
      return 'wait'
    }
  }
}
