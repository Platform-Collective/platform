// SPDX-License-Identifier: EPL-2.0
import { type GitlabIntegrationRepository } from '@hcengineering/gitlab'
import { type Project } from '@hcengineering/tracker'
import {
  disableRepositoryHook,
  isLinkableProject,
  linkedProjectName,
  linkRepository,
  projectLinkChange,
  unlinkRepository
} from '../project-link'

describe('isLinkableProject', () => {
  const existing = new Set(['current', 'other'])

  it('accepts a project without the GitLab mixin', () => {
    expect(isLinkableProject(undefined, 'current', existing)).toBe(true)
  })

  it('accepts a project already owned by the same integration', () => {
    expect(isLinkableProject({ integration: 'current', repositories: ['r1'] }, 'current', existing)).toBe(true)
  })

  it('accepts a project pointing at a deleted integration with no repositories (live case)', () => {
    expect(isLinkableProject({ integration: 'gone', repositories: [] }, 'current', existing)).toBe(true)
  })

  it('accepts a project pointing at a deleted integration with dangling repositories', () => {
    expect(isLinkableProject({ integration: 'gone', repositories: ['r1'] }, 'current', existing)).toBe(true)
  })

  it('accepts a project of another existing integration that links no repositories', () => {
    expect(isLinkableProject({ integration: 'other', repositories: [] }, 'current', existing)).toBe(true)
    expect(isLinkableProject({ integration: 'other' }, 'current', existing)).toBe(true)
  })

  it('rejects a project actively linked to another existing integration', () => {
    expect(isLinkableProject({ integration: 'other', repositories: ['r1'] }, 'current', existing)).toBe(false)
  })
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for TxOperations
type AnyClient = any

function fakeClient (mixin: unknown, commitResult = true): { client: AnyClient, ops: Record<string, jest.Mock> } {
  const ops = {
    createMixin: jest.fn(async () => {}),
    updateMixin: jest.fn(async () => {}),
    update: jest.fn(async () => {}),
    commit: jest.fn(async () => ({ result: commitResult }))
  }
  const hierarchy = {
    asIf: () => mixin,
    hasMixin: () => mixin !== undefined,
    as: (doc: unknown) => ({ ...(doc as object), ...(mixin as object) })
  }
  return { client: { apply: () => ops, getHierarchy: () => hierarchy }, ops }
}

const project: AnyClient = { _id: 'p1', _class: 'tracker:class:Project', space: 'core:space:Space', identifier: 'P' }
const integration: AnyClient = { _id: 'i1' }
const repository: AnyClient = { _id: 'r1', pathWithNamespace: 'g/r' }

function mixinOf (integration: string, repositories: string[]): AnyClient {
  return { integration, repositories }
}

describe('projectLinkChange', () => {
  it('creates the mixin for a project that has none', () => {
    expect(projectLinkChange(undefined, 'i1' as AnyClient, 'r1' as AnyClient)).toEqual({
      create: true,
      data: { integration: 'i1', repositories: ['r1'] }
    })
  })

  it('takes over a project of another integration and drops its repository refs', () => {
    expect(projectLinkChange(mixinOf('old', ['x']), 'i1' as AnyClient, 'r1' as AnyClient)).toEqual({
      create: false,
      data: { integration: 'i1', repositories: ['r1'] }
    })
  })

  it('adds the repository to the same integration once', () => {
    expect(projectLinkChange(mixinOf('i1', ['x']), 'i1' as AnyClient, 'r1' as AnyClient)).toEqual({
      create: false,
      data: { integration: 'i1', $push: { repositories: 'r1' } }
    })
    expect(projectLinkChange(mixinOf('i1', ['r1']), 'i1' as AnyClient, 'r1' as AnyClient)).toEqual({
      create: false,
      data: { integration: 'i1' }
    })
  })
})

describe('linkRepository', () => {
  it('installs the webhook, then links project and repository in one commit', async () => {
    const { client, ops } = fakeClient(undefined)
    const send = jest.fn(async () => ({}))
    await linkRepository(client, send, project, integration, repository)
    expect(send).toHaveBeenCalledWith('repository-enable', { repositoryId: 'r1' })
    expect(ops.createMixin).toHaveBeenCalledWith('p1', 'tracker:class:Project', 'core:space:Space', expect.anything(), {
      integration: 'i1',
      repositories: ['r1']
    })
    expect(ops.update).toHaveBeenCalledWith(repository, { gitlabProject: 'p1', enabled: true })
    expect(ops.commit).toHaveBeenCalledTimes(1)
  })

  it('removes the webhook again when the commit is refused, and rethrows', async () => {
    const { client } = fakeClient(undefined, false)
    const send = jest.fn(async () => ({}))
    await expect(linkRepository(client, send, project, integration, repository)).rejects.toThrow()
    expect(send.mock.calls.map((it: unknown[]) => it[0])).toEqual(['repository-enable', 'repository-disable'])
  })

  it('links nothing and removes no webhook when GitLab refuses the webhook', async () => {
    const { client, ops } = fakeClient(undefined)
    const send = jest.fn(async () => {
      throw new Error('refused')
    })
    await expect(linkRepository(client, send, project, integration, repository)).rejects.toThrow('refused')
    expect(send).toHaveBeenCalledTimes(1)
    expect(ops.commit).not.toHaveBeenCalled()
  })
})

describe('unlinkRepository', () => {
  it('pulls the repository from the project in the same commit, then removes the webhook', async () => {
    const { client, ops } = fakeClient({ integration: 'i1', repositories: ['r1'] })
    const send = jest.fn(async () => ({}))
    await unlinkRepository(client, send, repository, project)
    expect(ops.update).toHaveBeenNthCalledWith(1, repository, { enabled: false, gitlabProject: null })
    expect(ops.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ _id: 'p1' }), {
      $pull: { repositories: 'r1' }
    })
    expect(send).toHaveBeenCalledWith('repository-disable', { repositoryId: 'r1' })
  })

  it('keeps the webhook when the commit is refused', async () => {
    const { client } = fakeClient(undefined, false)
    const send = jest.fn(async () => ({}))
    await expect(unlinkRepository(client, send, repository, undefined)).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('disableRepositoryHook', () => {
  it('reports a failure instead of throwing', async () => {
    const send = jest.fn(async () => {
      throw new Error('gone')
    })
    await expect(disableRepositoryHook(send, 'r1' as AnyClient)).resolves.toBeUndefined()
  })
})

describe('linkedProjectName', () => {
  const repository = { gitlabProject: 'p1' } as unknown as GitlabIntegrationRepository
  const project = { _id: 'p1', name: 'Test project' } as unknown as Project

  it('names the linked project once it is loaded', () => {
    expect(linkedProjectName(repository, new Map())).toBe('')
    expect(linkedProjectName(repository, new Map([[project._id, project]]))).toBe('Test project')
  })

  it('is empty for an unlinked repository', () => {
    const unlinked = { gitlabProject: null } as unknown as GitlabIntegrationRepository
    expect(linkedProjectName(unlinked, new Map([[project._id, project]]))).toBe('')
  })
})
