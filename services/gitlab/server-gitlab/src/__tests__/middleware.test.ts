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
import { isGitlabTransactionAllowed, type FindRepositoryConnector } from '../middleware'

const member = 'member-social' as PersonId
const user = new TxFactory(member)
const system = new TxFactory(core.account.System)

function account (role: AccountRole, uuid = 'member' as AccountUuid): Account {
  return { uuid, role, primarySocialId: member, socialIds: [member], fullSocialIds: [] }
}

const connector = 'connector-social' as PersonId
const integration = 'int1' as Ref<GitlabIntegration>
const repository = 'repo1' as Ref<GitlabIntegrationRepository>

// The repository's integration was connected by another member unless a test says otherwise
const findOtherConnector: FindRepositoryConnector = async () => connector

async function isAllowed (
  account: Account,
  transaction: Tx,
  findConnector: FindRepositoryConnector = findOtherConnector
): Promise<boolean> {
  return await isGitlabTransactionAllowed(account, transaction, findConnector)
}

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
  ])('refuses a member changing %s of an integration', async (_name, ops) => {
    expect(await isAllowed(account(AccountRole.Owner), updateIntegration(ops))).toBe(false)
  })

  it('refuses a member changing projectId of a repository', async () => {
    expect(await isAllowed(account(AccountRole.Owner), updateRepository({ projectId: 99 }))).toBe(false)
  })

  it('refuses a member creating or removing connection documents', async () => {
    const create = user.createTxCreateDoc(gitlab.class.GitlabIntegration, core.space.Configuration, {
      host: 'https://attacker.example'
    } as unknown as GitlabIntegration)
    const remove = user.createTxRemoveDoc(gitlab.class.GitlabIntegration, core.space.Configuration, integration)
    expect(await isAllowed(account(AccountRole.Owner), create)).toBe(false)
    expect(await isAllowed(account(AccountRole.Owner), remove)).toBe(false)
  })

  it('lets the member who connected the integration link and unlink a repository', async () => {
    const findSelf: FindRepositoryConnector = async () => member
    const link = updateRepository({ enabled: true, gitlabProject: 'prj' })
    const unlink = updateRepository({ enabled: false, gitlabProject: null })
    expect(await isAllowed(account(AccountRole.User), link, findSelf)).toBe(true)
    expect(await isAllowed(account(AccountRole.User), unlink, findSelf)).toBe(true)
  })

  it('matches the connector by primary social id, like repository-enable', async () => {
    const secondary = 'member-secondary' as PersonId
    const withSecondary = { ...account(AccountRole.User), socialIds: [member, secondary] }
    const link = updateRepository({ enabled: true, gitlabProject: 'prj' })
    expect(await isAllowed(withSecondary, link, async () => secondary)).toBe(false)
  })

  it('lets a maintainer link and unlink any repository', async () => {
    const link = updateRepository({ enabled: true, gitlabProject: 'prj' })
    const unlink = updateRepository({ enabled: false, gitlabProject: null })
    expect(await isAllowed(account(AccountRole.Maintainer), link)).toBe(true)
    expect(await isAllowed(account(AccountRole.Maintainer), unlink)).toBe(true)
  })

  it('refuses other members linking or unlinking a repository with a raw transaction', async () => {
    expect(await isAllowed(account(AccountRole.User), updateRepository({ enabled: true }))).toBe(false)
    expect(await isAllowed(account(AccountRole.User), updateRepository({ gitlabProject: 'prj' }))).toBe(false)
    expect(await isAllowed(account(AccountRole.User), updateRepository({ enabled: false, gitlabProject: null }))).toBe(
      false
    )
  })

  it('refuses linking a repository whose integration is gone', async () => {
    const link = updateRepository({ enabled: true, gitlabProject: 'prj' })
    expect(await isAllowed(account(AccountRole.User), link, async () => undefined)).toBe(false)
  })

  it('lets only an owner change the image mode', async () => {
    expect(await isAllowed(account(AccountRole.Owner), updateIntegration({ imageMode: 'proxy' }))).toBe(true)
    expect(await isAllowed(account(AccountRole.Maintainer), updateIntegration({ imageMode: 'proxy' }))).toBe(false)
  })

  it('lets the GitLab service and server-derived transactions change anything', async () => {
    const service = account(AccountRole.User, systemAccountUuid)
    expect(await isAllowed(service, updateIntegration({ host: 'https://gitlab.com' }))).toBe(true)
    expect(await isAllowed(account(AccountRole.User), updateIntegration({ $inc: { repositories: 1 } }, system))).toBe(
      true
    )
  })

  it('ignores other classes', async () => {
    const ops: Record<string, unknown> = { anything: 1 }
    const other = user.createTxUpdateDoc(core.class.Doc, core.space.Workspace, 'd' as Ref<Doc>, ops)
    expect(await isAllowed(account(AccountRole.Guest), other)).toBe(true)
  })
})
