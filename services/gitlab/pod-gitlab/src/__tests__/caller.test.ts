// SPDX-License-Identifier: EPL-2.0
import { AccountRole, type PersonId, type WorkspaceUuid } from '@hcengineering/core'
import { assertOwner, assertWorkspace, requireTokenWorkspace, resolveCaller, roleInWorkspace } from '../caller'

const ws = 'ws1' as WorkspaceUuid
const decoded = { workspace: ws, account: 'acc1' }
const owned = [{ _id: 'p1' as PersonId }, { _id: 'p2' as PersonId }]

function loginInfo (role: AccountRole | undefined, workspace: string = ws): any {
  return { account: 'acc1', workspace, workspaceUrl: 'w', endpoint: 'e', token: 't', role }
}

describe('resolveCaller', () => {
  it('accepts a social id owned by the caller', async () => {
    const list = jest.fn(async () => owned)
    await expect(resolveCaller(decoded, 'p2', list)).resolves.toEqual({ workspace: 'ws1', account: 'acc1', accountId: 'p2' })
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('rejects a social id that belongs to someone else', async () => {
    const list = jest.fn(async () => owned)
    await expect(resolveCaller(decoded, 'p3', list)).rejects.toThrow('accountId does not belong to the caller')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, '', 42, null])('rejects a missing or invalid id (%p)', async (claimed) => {
    const list = jest.fn(async () => owned)
    await expect(resolveCaller(decoded, claimed, list)).rejects.toThrow('accountId is required')
    expect(list).not.toHaveBeenCalled()
  })

  it.each([undefined, '', null, 42])('rejects a token without a workspace (%p) before any lookup', async (workspace) => {
    const list = jest.fn(async () => owned)
    await expect(resolveCaller({ workspace: workspace as any, account: 'acc1' }, 'p1', list)).rejects.toThrow(
      'A workspace token is required'
    )
    expect(list).not.toHaveBeenCalled()
  })
})

describe('requireTokenWorkspace', () => {
  it('returns the token workspace', () => {
    expect(requireTokenWorkspace({ workspace: ws })).toBe(ws)
  })

  it.each([undefined, '', null, 42])('throws for %p', (workspace) => {
    expect(() => requireTokenWorkspace({ workspace: workspace as any })).toThrow('A workspace token is required')
  })
})

describe('assertWorkspace', () => {
  it.each([undefined, '', null])('throws for %p', (workspace) => {
    expect(() => { assertWorkspace(workspace as any) }).toThrow('workspace is required')
  })

  it('accepts a workspace uuid', () => {
    expect(() => { assertWorkspace(ws) }).not.toThrow()
  })
})

describe('roleInWorkspace', () => {
  it('returns the role of a login info for the same workspace', () => {
    expect(roleInWorkspace(loginInfo(AccountRole.Owner), ws)).toBe(AccountRole.Owner)
  })

  it('ignores the role of another workspace', () => {
    expect(roleInWorkspace(loginInfo(AccountRole.Owner, 'ws2'), ws)).toBeUndefined()
  })

  it('ignores a login info without a role', () => {
    expect(roleInWorkspace({ account: 'acc1' } as any, ws)).toBeUndefined()
    expect(roleInWorkspace(null, ws)).toBeUndefined()
    expect(roleInWorkspace(undefined, ws)).toBeUndefined()
  })
})

describe('assertOwner', () => {
  it('accepts owners', async () => {
    await expect(assertOwner(ws, async () => loginInfo(AccountRole.Owner))).resolves.toBeUndefined()
  })

  it('accepts admins', async () => {
    await expect(assertOwner(ws, async () => loginInfo(AccountRole.Admin))).resolves.toBeUndefined()
  })

  it.each([
    AccountRole.Maintainer,
    AccountRole.User,
    AccountRole.Guest,
    AccountRole.DocGuest,
    AccountRole.ReadOnlyGuest,
    undefined
  ])('rejects %s', async (role) => {
    await expect(assertOwner(ws, async () => loginInfo(role))).rejects.toThrow(
      'Only workspace owners can change the GitLab application'
    )
  })

  it('rejects an owner role that belongs to another workspace', async () => {
    await expect(assertOwner(ws, async () => loginInfo(AccountRole.Owner, 'ws2'))).rejects.toThrow(
      'Only workspace owners can change the GitLab application'
    )
  })

  it('rejects a login info without a workspace', async () => {
    await expect(assertOwner(ws, async () => ({ account: 'acc1' }) as any)).rejects.toThrow(
      'Only workspace owners can change the GitLab application'
    )
    await expect(assertOwner(ws, async () => null)).rejects.toThrow('Only workspace owners can change the GitLab application')
  })

  it('rejects an empty expected workspace without looking up the role', async () => {
    const info = jest.fn(async () => loginInfo(AccountRole.Owner, ''))
    await expect(assertOwner('' as WorkspaceUuid, info)).rejects.toThrow('workspace is required')
    expect(info).not.toHaveBeenCalled()
  })
})
