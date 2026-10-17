// SPDX-License-Identifier: EPL-2.0

import { type MixinData, type MixinUpdate, type Ref, type TxOperations } from '@hcengineering/core'
import { type GitlabIntegration, type GitlabIntegrationRepository, type GitlabProject } from '@hcengineering/gitlab'
import { type Project } from '@hcengineering/tracker'
import { GitlabError, reportError } from './errors'
import gitlab from './plugin'

/** A GitLab service request (sendGLServiceRequest), passed in so this module needs no session. */
export type ServiceRequest = (path: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>

/** A project can be linked to `integrationId` unless it actively belongs to another existing GitLab integration. */
export function isLinkableProject (
  mixin: { integration?: string, repositories?: string[] } | undefined,
  integrationId: string,
  existingIntegrationIds: ReadonlySet<string>
): boolean {
  if (mixin?.integration === undefined || mixin.integration === integrationId) return true
  // A dangling owner (deleted integration) or an owner that links no repositories does not block linking.
  return !existingIntegrationIds.has(mixin.integration) || (mixin.repositories ?? []).length === 0
}

/**
 * The name of the project `repository` is linked to, or '' while it is unlinked or not loaded yet.
 * Markup passes `linkedProjects` in, so the name re-renders once the projects arrive.
 */
export function linkedProjectName (
  repository: Pick<GitlabIntegrationRepository, 'gitlabProject'>,
  linkedProjects: ReadonlyMap<Ref<Project>, Pick<Project, 'name'>>
): string {
  const projectId = repository.gitlabProject as Ref<Project> | null
  return projectId === null ? '' : (linkedProjects.get(projectId)?.name ?? '')
}

export type ProjectLinkChange =
  | { create: true, data: MixinData<Project, GitlabProject> }
  | { create: false, data: MixinUpdate<Project, GitlabProject> }

/** The GitlabProject mixin change that links `repositoryId`: create it, take it over, add the repository, or keep it. */
export function projectLinkChange (
  mixin: Pick<GitlabProject, 'integration' | 'repositories'> | undefined,
  integrationId: Ref<GitlabIntegration>,
  repositoryId: Ref<GitlabIntegrationRepository>
): ProjectLinkChange {
  if (mixin === undefined) return { create: true, data: { integration: integrationId, repositories: [repositoryId] } }
  // Taken over from another (deleted or idle) integration: drop its possibly dangling repository refs
  if (mixin.integration !== integrationId) {
    return { create: false, data: { integration: integrationId, repositories: [repositoryId] } }
  }
  if (!(mixin.repositories ?? []).includes(repositoryId)) {
    return { create: false, data: { integration: integrationId, $push: { repositories: repositoryId } } }
  }
  return { create: false, data: { integration: integrationId } }
}

/** Removes the repository's webhook, best effort: a failure is reported, not thrown. */
export async function disableRepositoryHook (
  send: ServiceRequest,
  repositoryId: Ref<GitlabIntegrationRepository>
): Promise<void> {
  try {
    await send('repository-disable', { repositoryId })
  } catch (err: unknown) {
    reportError(err)
  }
}

/**
 * Installs the repository's webhook, then links project and repository in one transaction. When the link fails,
 * the webhook is removed again so no stray hook remains.
 */
export async function linkRepository (
  client: TxOperations,
  send: ServiceRequest,
  project: Project,
  integration: GitlabIntegration,
  repository: GitlabIntegrationRepository
): Promise<void> {
  // Link only when GitLab accepted the webhook
  await send('repository-enable', { repositoryId: repository._id })
  try {
    const change = projectLinkChange(
      client.getHierarchy().asIf(project, gitlab.mixin.GitlabProject),
      integration._id,
      repository._id
    )
    const ops = client.apply()
    if (change.create) {
      await ops.createMixin(project._id, project._class, project.space, gitlab.mixin.GitlabProject, change.data)
    } else {
      await ops.updateMixin(project._id, project._class, project.space, gitlab.mixin.GitlabProject, change.data)
    }
    await ops.update(repository, { gitlabProject: project._id as Ref<GitlabProject>, enabled: true })
    const { result } = await ops.commit()
    if (!result) throw new GitlabError(gitlab.string.LinkFailed)
  } catch (err: unknown) {
    await disableRepositoryHook(send, repository._id)
    throw err
  }
}

/** Unlinks the repository and pulls it from its project in one transaction, then removes the webhook. */
export async function unlinkRepository (
  client: TxOperations,
  send: ServiceRequest,
  repository: GitlabIntegrationRepository,
  project: Project | undefined
): Promise<void> {
  const ops = client.apply()
  await ops.update(repository, { enabled: false, gitlabProject: null })
  const hierarchy = client.getHierarchy()
  if (project !== undefined && hierarchy.hasMixin(project, gitlab.mixin.GitlabProject)) {
    await ops.update(hierarchy.as(project, gitlab.mixin.GitlabProject), { $pull: { repositories: repository._id } })
  }
  const { result } = await ops.commit()
  if (!result) throw new GitlabError(gitlab.string.UnlinkFailed)
  // The link is already removed in Huly
  await disableRepositoryHook(send, repository._id)
}
