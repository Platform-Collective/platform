// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import type { WorkspaceUuid } from '@hcengineering/core'
import { GitlabPlatform, type WorkerHandle, workspacesWithGitlab } from '../worker/platform'
import { ctx } from './helpers/provider'
import type { WorkspaceWorkerState } from '../workspace-state'

function handle (owns: boolean): WorkerHandle & Record<string, jest.Mock> {
  return {
    init: jest.fn(async () => {}),
    start: jest.fn(),
    close: jest.fn(async () => {}),
    ownsProject: jest.fn(() => owns),
    handleWebhook: jest.fn(async () => {}),
    requestFullSync: jest.fn(),
    lease: jest.fn(() => undefined),
    gitlabImage: jest.fn(async () => ({ kind: 'not-found' }))
  } as any
}

describe('workspacesWithGitlab', () => {
  it('lists each workspace with a GitLab integration once', () => {
    expect(
      workspacesWithGitlab([
        { workspaceUuid: 'a' },
        { workspaceUuid: 'b' },
        { workspaceUuid: 'a' },
        { workspaceUuid: null }
      ] as any)
    ).toEqual(['a', 'b'])
  })
})

describe('GitlabPlatform', () => {
  it("routes a scoped event only to the hook's workspace, with its integration", async () => {
    const workers: Record<string, any> = { ws1: handle(true), ws2: handle(true) }
    const platform = new GitlabPlatform({
      ctx,
      listWorkspaces: async () => ['ws1', 'ws2'] as WorkspaceUuid[],
      createWorker: async (ws) => workers[ws]
    })
    await platform.checkWorkspaces()
    const payload = { project: { id: 42, web_url: 'https://gitlab.example.com/group/proj' } }
    await platform.dispatch('Issue Hook', payload, { workspace: 'ws2' as WorkspaceUuid, integration: 'int-9' as any })
    expect(workers.ws1.handleWebhook).not.toHaveBeenCalled()
    expect(workers.ws2.handleWebhook).toHaveBeenCalledWith('Issue Hook', payload, 'int-9')
    await platform.dispatch('Issue Hook', payload)
    expect(workers.ws1.handleWebhook).toHaveBeenCalledWith('Issue Hook', payload, undefined)
  })

  it('starts workers for listed workspaces and closes those no longer listed', async () => {
    let listed = ['ws1', 'ws2']
    const workers: Record<string, any> = { ws1: handle(false), ws2: handle(false) }
    const platform = new GitlabPlatform({
      ctx,
      listWorkspaces: async () => listed as WorkspaceUuid[],
      createWorker: async (ws) => workers[ws]
    })
    await platform.checkWorkspaces()
    expect(workers.ws1.init).toHaveBeenCalled()
    expect(workers.ws1.start).toHaveBeenCalled()
    expect(platform.getWorker('ws2' as WorkspaceUuid)).toBe(workers.ws2)
    listed = ['ws1']
    await platform.checkWorkspaces()
    expect(workers.ws2.close).toHaveBeenCalled()
    expect(platform.getWorker('ws2' as WorkspaceUuid)).toBeUndefined()
  })

  it('retries a workspace whose worker failed to start, without blocking the others', async () => {
    const ok = handle(false)
    let fail = true
    const platform = new GitlabPlatform({
      ctx,
      listWorkspaces: async () => ['bad', 'good'] as WorkspaceUuid[],
      createWorker: async (ws) => {
        if (ws === 'bad' && fail) throw new Error('transactor down')
        return ws === 'good' ? ok : handle(false)
      }
    })
    await platform.checkWorkspaces()
    expect(platform.getWorker('good' as WorkspaceUuid)).toBe(ok)
    expect(platform.getWorker('bad' as WorkspaceUuid)).toBeUndefined()
    fail = false
    await platform.checkWorkspaces()
    expect(platform.getWorker('bad' as WorkspaceUuid)).toBeDefined()
  })

  it('skips workspaces where GitLab is disabled (no worker)', async () => {
    const platform = new GitlabPlatform({
      ctx,
      listWorkspaces: async () => ['ws1'] as WorkspaceUuid[],
      createWorker: async () => undefined
    })
    await platform.checkWorkspaces()
    expect(platform.getWorker('ws1' as WorkspaceUuid)).toBeUndefined()
  })

  it('never starts two workers for one workspace on concurrent checks', async () => {
    const createWorker = jest.fn(async () => handle(false))
    const platform = new GitlabPlatform({ ctx, listWorkspaces: async () => ['ws1'] as WorkspaceUuid[], createWorker })
    await Promise.all([platform.checkWorkspaces(), platform.checkWorkspaces()])
    expect(createWorker).toHaveBeenCalledTimes(1)
  })

  it('dispatches a webhook only to workers owning the project, isolating failures', async () => {
    const owner = handle(true)
    const failing = handle(true)
    ;(failing.handleWebhook as jest.Mock).mockRejectedValue(new Error('boom'))
    const other = handle(false)
    const byWs: Record<string, any> = { a: owner, b: failing, c: other }
    const platform = new GitlabPlatform({
      ctx,
      listWorkspaces: async () => ['a', 'b', 'c'] as WorkspaceUuid[],
      createWorker: async (ws) => byWs[ws]
    })
    await platform.checkWorkspaces()
    const payload = { project: { id: 42, web_url: 'https://gitlab.example.com/g/p' }, object_attributes: { iid: 1 } }
    await platform.dispatch('Issue Hook', payload)
    expect(owner.handleWebhook).toHaveBeenCalledWith('Issue Hook', payload, undefined)
    expect(failing.handleWebhook).toHaveBeenCalled()
    expect(other.handleWebhook).not.toHaveBeenCalled()
  })

  it('ignores a webhook without a project', async () => {
    const owner = handle(true)
    const platform = new GitlabPlatform({
      ctx,
      listWorkspaces: async () => ['a'] as WorkspaceUuid[],
      createWorker: async () => owner
    })
    await platform.checkWorkspaces()
    await platform.dispatch('Issue Hook', {})
    expect(owner.handleWebhook).not.toHaveBeenCalled()
  })

  it('closes a worker whose init failed, so its connection is not leaked', async () => {
    const broken = handle(false)
    ;(broken.init as jest.Mock).mockRejectedValue(new Error('model mismatch'))
    const platform = new GitlabPlatform({
      ctx,
      listWorkspaces: async () => ['ws1'] as WorkspaceUuid[],
      createWorker: async () => broken
    })
    await platform.checkWorkspaces()
    expect(broken.close).toHaveBeenCalled()
    expect(platform.getWorker('ws1' as WorkspaceUuid)).toBeUndefined()
  })

  it('starts only connectable workspaces, keeps a waiting worker, and closes inactive and skipped ones', async () => {
    const workers: Record<string, any> = { ws1: handle(false), ws2: handle(false), ws3: handle(false) }
    const states: Record<string, WorkspaceWorkerState> = { ws1: 'connect', ws2: 'wait', ws3: 'connect' }
    const platform = new GitlabPlatform({
      ctx,
      listWorkspaces: async () => ['ws1', 'ws2', 'ws3'] as WorkspaceUuid[],
      createWorker: async (ws) => workers[ws],
      workspaceState: async (ws) => states[ws]
    })
    await platform.checkWorkspaces()
    expect(workers.ws1.start).toHaveBeenCalled()
    expect(workers.ws2.init).not.toHaveBeenCalled()
    states.ws1 = 'wait'
    states.ws3 = 'skip'
    await platform.checkWorkspaces()
    expect(workers.ws1.close).not.toHaveBeenCalled()
    expect(workers.ws3.close).toHaveBeenCalled()
    states.ws1 = 'inactive'
    await platform.checkWorkspaces()
    expect(workers.ws1.close).toHaveBeenCalled()
    expect(platform.getWorker('ws1' as WorkspaceUuid)).toBeUndefined()
  })

  it('keeps running workers and starts none when the workspace state is unavailable', async () => {
    const workers: Record<string, any> = { ws1: handle(false), ws2: handle(false) }
    let listed = ['ws1']
    let failing = false
    const platform = new GitlabPlatform({
      ctx,
      listWorkspaces: async () => listed as WorkspaceUuid[],
      createWorker: async (ws) => workers[ws],
      workspaceState: async () => {
        if (failing) throw new Error('account service down')
        return 'connect'
      }
    })
    await platform.checkWorkspaces()
    failing = true
    listed = ['ws1', 'ws2']
    await platform.checkWorkspaces()
    expect(workers.ws1.close).not.toHaveBeenCalled()
    expect(workers.ws2.init).not.toHaveBeenCalled()
  })
})
