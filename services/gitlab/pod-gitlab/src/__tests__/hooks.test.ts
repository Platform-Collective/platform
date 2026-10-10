// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import type { Ref, WorkspaceUuid } from '@hcengineering/core'
import type { GitlabIntegration } from '@hcengineering/gitlab'
import { ensureRepositoryHook, hookSecret, hookTargetOf, hookUrl, removeRepositoryHook } from '../hooks'

const target = { workspace: 'ws-1' as WorkspaceUuid, integration: 'int-1' as Ref<GitlabIntegration> }

describe('hooks', () => {
  it('builds the scoped URL', () => {
    expect(hookUrl('https://hooks.example.com', target)).toBe('https://hooks.example.com/api/webhook/ws-1/int-1')
  })

  it('derives a stable secret per integration that differs from the master', () => {
    const secret = hookSecret('master', target)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(secret).toBe(hookSecret('master', target))
    expect(secret).not.toBe(hookSecret('master', { ...target, integration: 'int-2' as Ref<GitlabIntegration> }))
    expect(secret).not.toBe(hookSecret('master', { ...target, workspace: 'ws-2' as WorkspaceUuid }))
    expect(secret).not.toBe(hookSecret('other-master', target))
    expect(secret).not.toContain('master')
  })

  it('reads the target from route parameters', () => {
    expect(hookTargetOf({ workspace: 'ws-1', integration: 'int-1' })).toEqual(target)
    expect(hookTargetOf({ workspace: 'ws-1' })).toBeUndefined()
    expect(hookTargetOf({ workspace: '', integration: 'int-1' })).toBeUndefined()
  })
})

describe('repository hooks', () => {
  const hookTarget = { workspace: 'ws1' as WorkspaceUuid, integration: 'int-1' as Ref<GitlabIntegration> }
  const settings = { baseUrl: 'https://pod', master: 'm' }

  it('installs the scoped hook and stores its id only when it changed', async () => {
    const client = { update: jest.fn(async () => {}) }
    const api = { ensureProjectHook: jest.fn(async () => ({ id: 7 })) }
    const repository = { projectId: 42, hookId: 7 } as any
    expect(await ensureRepositoryHook(client as any, api as any, repository, settings, hookTarget)).toBe(7)
    expect(api.ensureProjectHook).toHaveBeenCalledWith(
      42,
      hookUrl(settings.baseUrl, hookTarget),
      hookSecret('m', hookTarget)
    )
    expect(client.update).not.toHaveBeenCalled()
    await ensureRepositoryHook(client as any, api as any, { projectId: 42, hookId: null } as any, settings, hookTarget)
    expect(client.update).toHaveBeenCalledWith(expect.anything(), { hookId: 7 })
  })

  it('removes a stored hook and clears its id; nothing to do without one', async () => {
    const client = { update: jest.fn(async () => {}) }
    const api = { deleteProjectHook: jest.fn(async () => {}) }
    await removeRepositoryHook(client as any, api as any, { projectId: 42, hookId: null } as any)
    expect(api.deleteProjectHook).not.toHaveBeenCalled()
    await removeRepositoryHook(client as any, api as any, { projectId: 42, hookId: 9 } as any)
    expect(api.deleteProjectHook).toHaveBeenCalledWith(42, 9)
    expect(client.update).toHaveBeenCalledWith(expect.anything(), { hookId: null })
  })
})
