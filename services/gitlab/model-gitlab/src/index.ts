// SPDX-License-Identifier: EPL-2.0

import {
  ArrOf,
  Collection,
  Hidden,
  Index,
  Mixin,
  Model,
  Prop,
  ReadOnly,
  TypeBoolean,
  TypeDate,
  TypeHyperlink,
  TypeNumber,
  TypeRef,
  TypeString,
  UX,
  type Builder
} from '@hcengineering/model'
import modelContact from '@hcengineering/model-contact'
import core, { TAttachedDoc, TDoc } from '@hcengineering/model-core'
import { TPreference } from '@hcengineering/model-preference'
import tracker, { TIssue, TProject } from '@hcengineering/model-tracker'
import { DOMAIN_PREFERENCE } from '@hcengineering/preference'
import contact from '@hcengineering/contact'
import {
  IndexKind,
  SocialIdType,
  type Class,
  type Doc,
  type Domain,
  type Hyperlink,
  type PersonId,
  type Ref,
  type Timestamp
} from '@hcengineering/core'
import {
  gitlabIntegrationKind,
  type DocSyncInfo,
  type GitlabAuthentication,
  type GitlabIntegration,
  type GitlabIntegrationRepository,
  type GitlabIssue,
  type GitlabProject,
  type GitlabVisibility
} from '@hcengineering/gitlab'
import { getEmbeddedLabel } from '@hcengineering/platform'
import setting from '@hcengineering/setting'
import gitlab from './plugin'

export { gitlabId } from '@hcengineering/gitlab'
export { default } from './plugin'
export const DOMAIN_GITLAB = 'gitlab' as Domain
export const DOMAIN_GITLAB_SYNC = 'gitlab_sync' as Domain

@Model(gitlab.class.DocSyncInfo, core.class.Doc, DOMAIN_GITLAB_SYNC)
export class TDocSyncInfo extends TDoc implements DocSyncInfo {
  @Prop(TypeString(), getEmbeddedLabel('Key'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    key!: string

  @Prop(TypeString(), getEmbeddedLabel('Parent'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    parent?: string

  @Prop(TypeString(), getEmbeddedLabel('Object class'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    objectClass!: Ref<Class<Doc>>

  @Prop(TypeRef(gitlab.class.GitlabIntegrationRepository), getEmbeddedLabel('Repository'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    repository!: Ref<GitlabIntegrationRepository> | null

  @Prop(TypeNumber(), getEmbeddedLabel('Issue IID'))
  @ReadOnly()
    gitlabIid!: number

  @Prop(TypeString(), getEmbeddedLabel('Sync request'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    needSync!: string

  @Prop(TypeBoolean(), getEmbeddedLabel('Deleted'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    deleted?: boolean

  @Prop(TypeRef(core.class.Doc), getEmbeddedLabel('Attached to'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    attachedTo?: Ref<Doc>

  external?: unknown
  current?: unknown
  lastModified?: Timestamp
  error?: string | null
  retryable?: boolean
  lastGitlabUser?: PersonId | null
}

@Mixin(gitlab.mixin.GitlabIssue, tracker.class.Issue)
@UX(gitlab.string.GitlabIssue, gitlab.icon.Gitlab)
export class TGitlabIssue extends TIssue implements GitlabIssue {
  @Prop(TypeHyperlink(), getEmbeddedLabel('GitLab URL'))
  @Index(IndexKind.FullText)
  @ReadOnly()
  @Hidden()
    url!: Hyperlink

  @Prop(TypeNumber(), getEmbeddedLabel('GitLab IID'))
  @ReadOnly()
  @Hidden()
    gitlabIid!: number

  @Prop(TypeRef(gitlab.class.GitlabIntegrationRepository), getEmbeddedLabel('Repository'))
  @Hidden()
    repository!: Ref<GitlabIntegrationRepository>
}

@Model(gitlab.class.GitlabIntegration, core.class.Doc, DOMAIN_GITLAB)
@UX(gitlab.string.Gitlab)
export class TGitlabIntegration extends TDoc implements GitlabIntegration {
  @Prop(TypeString(), getEmbeddedLabel('Host'))
  @ReadOnly()
    host!: string

  @Prop(TypeNumber(), getEmbeddedLabel('GitLab user id'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    gitlabUserId!: number

  @Prop(TypeString(), getEmbeddedLabel('Login'))
  @ReadOnly()
    login!: string

  @Prop(TypeString(), getEmbeddedLabel('Name'))
  @ReadOnly()
    name!: string

  @Prop(TypeString(), getEmbeddedLabel('Connected by'))
  @ReadOnly()
  @Hidden()
    connectedBy!: PersonId

  @Prop(TypeBoolean(), getEmbeddedLabel('Alive'))
  @ReadOnly()
    alive!: boolean

  error?: string | null

  @Prop(Collection(gitlab.class.GitlabIntegrationRepository), getEmbeddedLabel('Repositories'))
  @ReadOnly()
    repositories!: number
}

@Model(gitlab.class.GitlabIntegrationRepository, core.class.AttachedDoc, DOMAIN_GITLAB)
@UX(gitlab.string.Repository)
export class TGitlabIntegrationRepository extends TAttachedDoc implements GitlabIntegrationRepository {
  declare attachedTo: Ref<GitlabIntegration>

  @Prop(TypeNumber(), getEmbeddedLabel('Project ID'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    projectId!: number

  @Prop(TypeString(), getEmbeddedLabel('Name'))
  @ReadOnly()
    name!: string

  @Prop(TypeString(), getEmbeddedLabel('Path'))
  @ReadOnly()
    pathWithNamespace!: string

  @Prop(TypeString(), getEmbeddedLabel('URL'))
  @ReadOnly()
    webUrl!: string

  @Prop(TypeString(), getEmbeddedLabel('Description'))
  @ReadOnly()
    description!: string | null

  @Prop(TypeString(), getEmbeddedLabel('Visibility'))
  @ReadOnly()
    visibility!: GitlabVisibility

  @Prop(TypeBoolean(), getEmbeddedLabel('Archived'))
  @ReadOnly()
    archived!: boolean

  @Prop(TypeString(), getEmbeddedLabel('Default branch'))
  @ReadOnly()
    defaultBranch!: string | null

  @Prop(TypeNumber(), getEmbeddedLabel('Stars'))
  @ReadOnly()
    starCount!: number

  @Prop(TypeNumber(), getEmbeddedLabel('Forks'))
  @ReadOnly()
    forksCount!: number

  @Prop(TypeNumber(), getEmbeddedLabel('Open issues'))
  @ReadOnly()
    openIssuesCount!: number

  @Prop(TypeDate(), getEmbeddedLabel('Last activity'))
  @ReadOnly()
    lastActivityAt!: Timestamp

  @Prop(TypeBoolean(), getEmbeddedLabel('Enabled'))
  @ReadOnly()
    enabled!: boolean

  @Prop(TypeRef(gitlab.mixin.GitlabProject), getEmbeddedLabel('Project'))
  @ReadOnly()
    gitlabProject!: Ref<GitlabProject> | null

  hookId!: number | null

  @Prop(TypeBoolean(), getEmbeddedLabel('Deleted'))
  @ReadOnly()
    deleted!: boolean
}

@Mixin(gitlab.mixin.GitlabProject, tracker.class.Project)
@UX(gitlab.string.Repository)
export class TGitlabProject extends TProject implements GitlabProject {
  @Prop(TypeRef(gitlab.class.GitlabIntegration), getEmbeddedLabel('Integration'))
  @ReadOnly()
  @Hidden()
    integration!: Ref<GitlabIntegration>

  @Prop(ArrOf(TypeRef(gitlab.class.GitlabIntegrationRepository)), getEmbeddedLabel('Repositories'))
  @ReadOnly()
  @Hidden()
    repositories!: Array<Ref<GitlabIntegrationRepository>>
}

@Model(gitlab.class.GitlabAuthentication, core.class.Doc, DOMAIN_PREFERENCE)
export class TGitlabAuthentication extends TPreference implements GitlabAuthentication {
  @Prop(TypeString(), getEmbeddedLabel('Login'))
  @Index(IndexKind.Indexed)
    login!: string

  name?: string
  avatar?: string
  url?: string
  error?: string | null
  authRequestTime?: Timestamp
}

export function createModel (builder: Builder): void {
  builder.createModel(
    TGitlabIntegration,
    TGitlabIntegrationRepository,
    TGitlabProject,
    TGitlabAuthentication,
    TDocSyncInfo,
    TGitlabIssue
  )

  builder.createDoc(
    setting.class.IntegrationType,
    core.space.Model,
    {
      label: gitlab.string.Gitlab,
      description: gitlab.string.GitlabDesc,
      icon: gitlab.component.GitlabIcon,
      allowMultiple: false,
      createComponent: gitlab.component.Connect,
      configureComponent: gitlab.component.Configure,
      stateComponent: gitlab.component.IntegrationState,
      onDisconnect: gitlab.handler.DisconnectHandler,
      kind: gitlabIntegrationKind
    },
    gitlab.integrationType.Gitlab
  )

  builder.mixin(gitlab.class.DocSyncInfo, core.class.Class, core.mixin.IndexConfiguration, {
    indexes: [],
    searchDisabled: true
  })

  builder.createDoc(
    contact.class.SocialIdentityProvider,
    core.space.Model,
    {
      label: gitlab.string.Gitlab,
      icon: gitlab.icon.Gitlab,
      type: SocialIdType.GITLAB
    },
    gitlab.ids.GitlabSocialIdentityProvider
  )

  // Profile link in a person's social links; a full URL, since GitLab may be self-managed on any host
  builder.createDoc(
    contact.class.ChannelProvider,
    core.space.Model,
    {
      label: gitlab.string.Gitlab,
      icon: gitlab.icon.Gitlab,
      placeholder: modelContact.string.HomepagePlaceholder,
      action: modelContact.action.OpenChannel
    },
    gitlab.channelProvider.Gitlab
  )
}
