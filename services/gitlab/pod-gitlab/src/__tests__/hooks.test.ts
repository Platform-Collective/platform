// SPDX-License-Identifier: EPL-2.0
import type { Ref, WorkspaceUuid } from '@hcengineering/core'
import type { GitlabIntegration } from '@hcengineering/gitlab'
import { hookSecret, hookTargetOf, hookUrl } from '../hooks'

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
