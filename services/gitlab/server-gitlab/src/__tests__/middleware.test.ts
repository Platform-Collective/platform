// SPDX-License-Identifier: EPL-2.0
import core, {
  AccountRole,
  systemAccountUuid,
  TxFactory,
  type Account,
  type AccountUuid,
  type Doc,
  type PersonId,
  type Ref,
  type Tx
} from '@hcengineering/core'
import gitlab, { type GitlabIntegration, type GitlabIntegrationRepository } from '@hcengineering/gitlab'
import { isGitlabTransactionAllowed } from '../middleware'

const member = 'member-social' as PersonId
const user = new TxFactory(member)
const system = new TxFactory(core.account.System)

function account (role: AccountRole, uuid = 'member' as AccountUuid): Account {
  return { uuid, role, primarySocialId: member, socialIds: [member], fullSocialIds: [] }
}

const integration = 'int1' as Ref<GitlabIntegration>
const repository = 'repo1' as Ref<GitlabIntegrationRepository>

function updateIntegration (ops: Record<string, unknown>, factory = user): Tx {
  return factory.createTxUpdateDoc(gitlab.class.GitlabIntegration, core.space.Configuration, integration, ops)
}

function updateRepository (ops: Record<string, unknown>): Tx {
  return user.createTxUpdateDoc(gitlab.class.GitlabIntegrationRepository, core.space.Configuration, repository, ops)
}

describe('isGitlabTransactionAllowed', () => {
  it.each([
    ['host', { host: 'https://attacker.example' }],
    ['connectedBy', { connectedBy: 'victim' }],
    ['gitlabUserId', { gitlabUserId: 1 }],
    ['a member field mixed with a service field', { imageMode: 'proxy', host: 'https://attacker.example' }]
  ])('refuses a member changing %s of an integration', (_name, ops) => {
    expect(isGitlabTransactionAllowed(account(AccountRole.Owner), updateIntegration(ops))).toBe(false)
  })

  it('refuses a member changing projectId of a repository', () => {
    expect(isGitlabTransactionAllowed(account(AccountRole.Owner), updateRepository({ projectId: 99 }))).toBe(false)
  })

  it('refuses a member creating or removing connection documents', () => {
    const create = user.createTxCreateDoc(gitlab.class.GitlabIntegration, core.space.Configuration, {
      host: 'https://attacker.example'
    } as unknown as GitlabIntegration)
    const remove = user.createTxRemoveDoc(gitlab.class.GitlabIntegration, core.space.Configuration, integration)
    expect(isGitlabTransactionAllowed(account(AccountRole.Owner), create)).toBe(false)
    expect(isGitlabTransactionAllowed(account(AccountRole.Owner), remove)).toBe(false)
  })

  it('lets a member link and unlink a repository', () => {
    const link = updateRepository({ enabled: true, gitlabProject: 'prj' })
    expect(isGitlabTransactionAllowed(account(AccountRole.User), link)).toBe(true)
    expect(
      isGitlabTransactionAllowed(account(AccountRole.User), updateRepository({ enabled: false, gitlabProject: null }))
    ).toBe(true)
  })

  it('lets only an owner change the image mode', () => {
    expect(isGitlabTransactionAllowed(account(AccountRole.Owner), updateIntegration({ imageMode: 'proxy' }))).toBe(true)
    expect(isGitlabTransactionAllowed(account(AccountRole.Maintainer), updateIntegration({ imageMode: 'proxy' }))).toBe(false)
  })

  it('lets the GitLab service and server-derived transactions change anything', () => {
    const service = account(AccountRole.User, systemAccountUuid)
    expect(isGitlabTransactionAllowed(service, updateIntegration({ host: 'https://gitlab.com' }))).toBe(true)
    expect(isGitlabTransactionAllowed(account(AccountRole.User), updateIntegration({ $inc: { repositories: 1 } }, system))).toBe(
      true
    )
  })

  it('ignores other classes', () => {
    const ops: Record<string, unknown> = { anything: 1 }
    const other = user.createTxUpdateDoc(core.class.Doc, core.space.Workspace, 'd' as Ref<Doc>, ops)
    expect(isGitlabTransactionAllowed(account(AccountRole.Guest), other)).toBe(true)
  })
})
