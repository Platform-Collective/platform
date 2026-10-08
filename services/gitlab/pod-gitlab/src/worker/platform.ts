// SPDX-License-Identifier: EPL-2.0

import type { Integration } from '@hcengineering/account-client'
import type { MeasureContext, PersonId, TxOperations, WorkspaceUuid } from '@hcengineering/core'
import { errorMessage } from '../sync/errors'
import type { GitlabHookKind, GitlabHookPayload } from './worker'

export const WORKSPACE_CHECK_INTERVAL_MS = 5 * 60 * 1000

/** The worker surface the platform uses. */
export interface WorkerHandle {
  init: () => Promise<void>
  start: () => void
  close: () => Promise<void>
  ownsProject: (webUrl: string, projectId: number) => boolean
  handleWebhook: (kind: GitlabHookKind, payload: GitlabHookPayload) => Promise<void>
  requestFullSync: () => void
  session: (accountId: PersonId) => TxOperations | undefined
}

export interface PlatformDeps {
  ctx: MeasureContext
  // Workspaces with at least one GitLab connection
  listWorkspaces: () => Promise<WorkspaceUuid[]>
  // undefined when GitLab is disabled in the workspace
  createWorker: (workspace: WorkspaceUuid) => Promise<WorkerHandle | undefined>
  checkIntervalMs?: number
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

  async dispatch (kind: GitlabHookKind, payload: GitlabHookPayload): Promise<void> {
    const projectId = payload.project?.id
    const webUrl = payload.project?.web_url
    if (projectId === undefined || webUrl === undefined) return
    for (const [workspace, worker] of this.workers) {
      if (!worker.ownsProject(webUrl, projectId)) continue
      try {
        await worker.handleWebhook(kind, payload)
      } catch (err: unknown) {
        this.deps.ctx.error('gitlab webhook dispatch failed', { workspace, kind, error: errorMessage(err) })
      }
    }
  }

  async close (): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer)
    await this.checking
    await Promise.all([...this.workers.values()].map(async (worker) => { await worker.close() }))
    this.workers.clear()
  }

  private async doCheck (): Promise<void> {
    const wanted = new Set(await this.deps.listWorkspaces())
    for (const [workspace, worker] of [...this.workers]) {
      if (!wanted.has(workspace)) {
        this.workers.delete(workspace)
        await worker.close().catch((err: unknown) => {
          this.deps.ctx.error('failed to close gitlab worker', { workspace, error: errorMessage(err) })
        })
      }
    }
    for (const workspace of wanted) {
      if (this.workers.has(workspace)) continue
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
}
