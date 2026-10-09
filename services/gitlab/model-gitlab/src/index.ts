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
  TypeAny,
  TypeMarkup,
  TypeString,
  UX,
  type Builder
} from '@hcengineering/model'
import modelContact from '@hcengineering/model-contact'
import core, { TAttachedDoc, TDoc } from '@hcengineering/model-core'
import { TPreference } from '@hcengineering/model-preference'
import tracker, { TIssue, TProject, issuesOptions } from '@hcengineering/model-tracker'
import { DOMAIN_PREFERENCE } from '@hcengineering/preference'
import contact, { type Person } from '@hcengineering/contact'
import activity, { TActivityMessage } from '@hcengineering/model-activity'
import chunter from '@hcengineering/model-chunter'
import presentation from '@hcengineering/model-presentation'
import { TToDo } from '@hcengineering/model-time'
import view from '@hcengineering/model-view'
import workbench from '@hcengineering/model-workbench'
import tags from '@hcengineering/tags'
import task from '@hcengineering/task'
import time from '@hcengineering/time'
import { type ActivityMessageControl } from '@hcengineering/activity'
import {
  DateRangeMode,
  IndexKind,
  SocialIdType,
  type Blob,
  type Class,
  type ClassCollaborators,
  type Doc,
  type Domain,
  type Hyperlink,
  type Markup,
  type PersonId,
  type Ref,
  type Timestamp
} from '@hcengineering/core'
import {
  GITLAB_IMAGE_HREF_PATTERN,
  gitlabIntegrationKind,
  type DocSyncInfo,
  type GitlabAuthentication,
  type GitlabImageMode,
  type GitlabIntegration,
  type GitlabIntegrationRepository,
  type GitlabIssue,
  type GitlabMergeRequest,
  type GitlabMergeRequestReview,
  type GitlabMergeRequestState,
  type GitlabPatch,
  type GitlabProject,
  type GitlabReview,
  type GitlabReviewComment,
  type GitlabReviewKind,
  type GitlabReviewThread,
  type GitlabTodo,
  type GitlabUpload,
  type GitlabUploadOrigin,
  type GitlabViewedFile,
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

// Bookkeeping of the GitLab service, like DocSyncInfo
@Model(gitlab.class.GitlabUpload, core.class.Doc, DOMAIN_GITLAB_SYNC)
export class TGitlabUpload extends TDoc implements GitlabUpload {
  @Prop(TypeRef(gitlab.class.GitlabIntegrationRepository), getEmbeddedLabel('Repository'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    repository!: Ref<GitlabIntegrationRepository>

  @Prop(TypeString(), getEmbeddedLabel('Path'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    path!: string

  @Prop(TypeRef(core.class.Blob), getEmbeddedLabel('File'))
  @ReadOnly()
  @Index(IndexKind.Indexed)
    file!: Ref<Blob>

  @Prop(TypeString(), getEmbeddedLabel('Origin'))
  @ReadOnly()
    origin!: GitlabUploadOrigin
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
    repository?: Ref<GitlabIntegrationRepository> | null

  @Prop(TypeString(), gitlab.string.SyncError)
  @ReadOnly()
  @Hidden()
    syncError?: string | null
}

@Model(gitlab.class.GitlabMergeRequest, tracker.class.Issue)
@UX(gitlab.string.MergeRequest, gitlab.icon.MergeRequest, undefined, undefined, undefined, gitlab.string.MergeRequests)
export class TGitlabMergeRequest extends TIssue implements GitlabMergeRequest {
  @Prop(TypeHyperlink(), getEmbeddedLabel('GitLab URL'))
  @Index(IndexKind.FullText)
  @ReadOnly()
  @Hidden()
    url!: Hyperlink

  @Prop(TypeNumber(), getEmbeddedLabel('GitLab IID'))
  @ReadOnly()
  @Hidden()
    gitlabIid!: number

  @Prop(TypeRef(gitlab.class.GitlabIntegrationRepository), gitlab.string.Repository)
  @ReadOnly()
  @Hidden()
    repository!: Ref<GitlabIntegrationRepository>

  @Prop(TypeString(), gitlab.string.SyncError)
  @ReadOnly()
  @Hidden()
    syncError?: string | null

  @Prop(TypeAny(gitlab.component.MergeRequestStateValuePresenter, gitlab.string.MergeRequestState), gitlab.string.MergeRequestState)
  @ReadOnly()
    state!: GitlabMergeRequestState

  @Prop(TypeBoolean(), gitlab.string.Draft)
  @ReadOnly()
    draft!: boolean

  @Prop(TypeString(), gitlab.string.SourceBranch)
  @ReadOnly()
    sourceBranch!: string

  @Prop(TypeString(), gitlab.string.TargetBranch)
  @ReadOnly()
    targetBranch!: string

  @Prop(TypeAny(gitlab.component.MergeStatusValuePresenter, gitlab.string.MergeStatus), gitlab.string.MergeStatus)
  @ReadOnly()
    mergeStatus!: string

  @Prop(TypeBoolean(), gitlab.string.Conflict)
  @ReadOnly()
  @Hidden()
    hasConflicts!: boolean

  @Prop(TypeDate(DateRangeMode.DATETIME), gitlab.string.MergedAt)
  @ReadOnly()
    mergedAt!: Timestamp | null

  @Prop(TypeDate(DateRangeMode.DATETIME), gitlab.string.ClosedAt)
  @ReadOnly()
    closedAt!: Timestamp | null

  @Prop(TypeNumber(), gitlab.string.Commits)
  @ReadOnly()
    commits!: number

  @Prop(TypeNumber(), gitlab.string.Files)
  @ReadOnly()
  @Hidden()
    files!: number

  @Prop(TypeNumber(), getEmbeddedLabel('Additions'))
  @ReadOnly()
  @Hidden()
    additions!: number

  @Prop(TypeNumber(), getEmbeddedLabel('Deletions'))
  @ReadOnly()
  @Hidden()
    deletions!: number

  @Prop(ArrOf(TypeRef(contact.class.Person)), gitlab.string.Reviewers)
    reviewers!: Array<Ref<Person>> | null

  @Prop(ArrOf(TypeRef(contact.class.Person)), gitlab.string.ApprovedBy)
  @ReadOnly()
    approvedBy!: Array<Ref<Person>> | null

  @Prop(Collection(gitlab.class.GitlabReviewComment), gitlab.string.ReviewComments)
  @Hidden()
    reviewComments!: number
}

// The stored diff of a merge request; not an attachment
@Model(gitlab.class.GitlabPatch, core.class.AttachedDoc, DOMAIN_GITLAB)
export class TGitlabPatch extends TAttachedDoc implements GitlabPatch {
  declare attachedTo: Ref<GitlabMergeRequest>
  file!: Ref<Blob>
  size!: number
  lastModified!: Timestamp
}

@Mixin(gitlab.mixin.GitlabTodo, time.class.ToDo)
export class TGitlabTodo extends TToDo implements GitlabTodo {
  purpose!: 'review' | 'fix'
}

@Model(gitlab.class.GitlabReview, activity.class.ActivityMessage)
@UX(gitlab.string.Review, gitlab.icon.MergeRequest)
export class TGitlabReview extends TActivityMessage implements GitlabReview {
  @Prop(TypeString(), gitlab.string.Review)
  @ReadOnly()
    state!: GitlabReviewKind

  @Prop(TypeString(), gitlab.string.SyncError)
  @ReadOnly()
  @Hidden()
    syncError?: string | null
}

@Model(gitlab.class.GitlabReviewThread, activity.class.ActivityMessage)
@UX(gitlab.string.ReviewThread, gitlab.icon.MergeRequest)
export class TGitlabReviewThread extends TActivityMessage implements GitlabReviewThread {
  discussionId!: string
  path!: string
  oldPath!: string
  line!: number | null
  oldLine!: number | null
  isResolved!: boolean
  resolvedBy!: PersonId | null
  isOutdated!: boolean
}

@Model(gitlab.class.GitlabReviewComment, core.class.AttachedDoc, DOMAIN_GITLAB)
@UX(gitlab.string.ReviewComment)
export class TGitlabReviewComment extends TAttachedDoc implements GitlabReviewComment {
  declare attachedTo: Ref<GitlabMergeRequest>

  @Prop(TypeString(), getEmbeddedLabel('Discussion'))
  @Index(IndexKind.Indexed)
    discussionId!: string

  @Prop(TypeMarkup(), gitlab.string.ReviewComment)
    body!: Markup
}

// Huly only: which diff files a person marked as viewed
@Model(gitlab.class.GitlabMergeRequestReview, core.class.AttachedDoc, DOMAIN_GITLAB)
export class TGitlabMergeRequestReview extends TAttachedDoc implements GitlabMergeRequestReview {
  declare attachedTo: Ref<GitlabMergeRequest>

  @Prop(TypeRef(contact.class.Person), getEmbeddedLabel('Author'))
  @Index(IndexKind.Indexed)
    author!: Ref<Person>

  files!: GitlabViewedFile[]
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

  @Prop(TypeString(), getEmbeddedLabel('Image mode'))
    imageMode?: GitlabImageMode
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
    TGitlabUpload,
    TGitlabIssue,
    TGitlabMergeRequest,
    TGitlabPatch,
    TGitlabTodo,
    TGitlabReview,
    TGitlabReviewThread,
    TGitlabReviewComment,
    TGitlabMergeRequestReview
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

  builder.mixin(gitlab.class.GitlabUpload, core.class.Class, core.mixin.IndexConfiguration, {
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

  builder.mixin(gitlab.class.GitlabMergeRequest, core.class.Class, view.mixin.ObjectPresenter, {
    presenter: gitlab.component.MergeRequestPresenter
  })
  builder.mixin(gitlab.class.GitlabMergeRequest, core.class.Class, activity.mixin.ActivityDoc, {})
  builder.mixin(gitlab.class.GitlabMergeRequest, core.class.Class, view.mixin.ObjectEditorFooter, {
    editor: gitlab.component.EditMergeRequest
  })
  // Merge requests come from GitLab only
  builder.mixin(gitlab.class.GitlabMergeRequest, core.class.Class, view.mixin.IgnoreActions, {
    actions: [view.action.Delete, task.action.Move, tracker.action.MoveToProject]
  })
  builder.mixin(gitlab.mixin.GitlabIssue, core.class.Class, view.mixin.ObjectPresenter, {
    presenter: gitlab.component.GitlabIssuePresenter
  })
  // Reviews and threads render in the merge request's activity
  builder.mixin(gitlab.class.GitlabReview, core.class.Class, view.mixin.ObjectPresenter, {
    presenter: gitlab.component.GitlabReviewPresenter
  })
  builder.mixin(gitlab.class.GitlabReviewThread, core.class.Class, view.mixin.ObjectPresenter, {
    presenter: gitlab.component.GitlabReviewThreadPresenter
  })
  // Comments show inside their thread; viewed marks are private bookkeeping
  builder.mixin(gitlab.class.GitlabReviewComment, core.class.Class, activity.mixin.IgnoreActivity, {})
  builder.mixin(gitlab.class.GitlabMergeRequestReview, core.class.Class, activity.mixin.IgnoreActivity, {})
  // The stored diff is bookkeeping for review-thread snippets
  builder.mixin(gitlab.class.GitlabPatch, core.class.Class, activity.mixin.IgnoreActivity, {})

  builder.createDoc<ClassCollaborators<GitlabMergeRequest>>(core.class.ClassCollaborators, core.space.Model, {
    attachedTo: gitlab.class.GitlabMergeRequest,
    fields: ['createdBy', 'assignee', 'reviewers']
  })

  // Repository picker in the issue create dialog ('pool', not 'createButton')
  builder.createDoc(presentation.class.DocCreateExtension, core.space.Model, {
    ofClass: tracker.class.Issue,
    apply: gitlab.function.UpdateIssue,
    components: {
      pool: gitlab.component.GitlabRepositoryPool
    }
  })

  builder.createDoc(presentation.class.ComponentPointExtension, core.space.Model, {
    extension: tracker.extensions.EditIssueTitle,
    component: gitlab.component.MergeRequestState,
    props: { kind: 'ghost' }
  })
  builder.createDoc(presentation.class.ComponentPointExtension, core.space.Model, {
    extension: tracker.extensions.EditIssueTitle,
    component: gitlab.component.GitlabIssueHeader,
    props: { kind: 'ghost' }
  })
  // Links to GitLab images open a viewer that loads them as the viewer
  builder.createDoc(presentation.class.ComponentPointExtension, core.space.Model, {
    extension: presentation.extension.LinkMark,
    component: gitlab.component.GitlabImageLink,
    props: { hrefPattern: GITLAB_IMAGE_HREF_PATTERN }
  })

  builder.createDoc(
    view.class.Viewlet,
    core.space.Model,
    {
      // Extends tracker.class.Issue, so this configuration is merged with the issue one
      attachTo: gitlab.class.GitlabMergeRequest,
      descriptor: view.viewlet.List,
      viewOptions: issuesOptions(false),
      configOptions: {
        strict: true,
        hiddenKeys: [
          'title', 'blockedBy', 'relations', 'description', 'number', 'reportedTime', 'reports', 'priority',
          'component', 'milestone', 'estimation', 'remainingTime', 'status', 'dueDate', 'attachedTo', 'createdBy',
          'modifiedBy'
        ]
      },
      config: [
        {
          key: '',
          label: tracker.string.Identifier,
          presenter: tracker.component.IssuePresenter,
          displayProps: { key: 'issue', fixed: 'left' }
        },
        {
          key: '',
          label: tracker.string.Status,
          presenter: tracker.component.StatusEditor,
          props: { kind: 'list', size: 'small', justify: 'center' },
          displayProps: { key: 'status' }
        },
        {
          key: '',
          label: gitlab.string.MergeStatus,
          presenter: gitlab.component.MergeRequestState,
          props: { small: true },
          displayProps: { key: 'merge_state' }
        },
        {
          key: '',
          label: tracker.string.Title,
          presenter: gitlab.component.TitlePresenter,
          props: { shouldUseMargin: true, showParent: false },
          displayProps: { key: 'title' }
        },
        { key: 'comments', displayProps: { key: 'comments', suffix: true } },
        { key: 'attachments', displayProps: { key: 'attachments', suffix: true } },
        { key: '', displayProps: { grow: true } },
        {
          key: 'labels',
          presenter: tags.component.LabelsPresenter,
          displayProps: { compression: true },
          props: { kind: 'list', full: false }
        },
        {
          key: 'modifiedOn',
          presenter: tracker.component.ModificationDatePresenter,
          displayProps: { key: 'submodified', fixed: 'left', dividerBefore: true }
        },
        {
          key: '',
          presenter: tracker.component.AssigneeEditor,
          displayProps: { key: 'assignee', fixed: 'right' },
          props: { kind: 'list', shouldShowName: false, avatarSize: 'x-small' }
        }
      ],
      options: {
        lookup: {
          space: tracker.class.Project
        }
      }
    },
    gitlab.viewlet.MergeRequests
  )

  builder.createDoc(workbench.class.ApplicationNavModel, core.space.Model, {
    extends: tracker.app.Tracker,
    spaces: [
      {
        id: 'projects',
        spaceClass: tracker.class.Project,
        specials: [
          {
            id: 'gitlab-merge-requests',
            label: gitlab.string.MergeRequests,
            icon: gitlab.icon.MergeRequest,
            visibleIf: gitlab.function.ShowForRepositoryOnly,
            component: gitlab.component.MergeRequests,
            componentProps: {
              title: gitlab.string.MergeRequests,
              config: [
                ['all', gitlab.string.All, {}],
                ['active', gitlab.string.Active, {}],
                ['closed', gitlab.string.Closed, {}]
              ]
            }
          }
        ]
      }
    ]
  })

  builder.createDoc(
    task.class.TaskTypeDescriptor,
    core.space.Model,
    {
      baseClass: gitlab.class.GitlabMergeRequest,
      allowCreate: false,
      description: gitlab.string.MergeRequest,
      icon: gitlab.icon.MergeRequest,
      name: gitlab.string.MergeRequest
    },
    gitlab.descriptors.MergeRequest
  )

  builder.createDoc(
    chunter.class.ChatMessageViewlet,
    core.space.Model,
    {
      messageClass: chunter.class.ChatMessage,
      objectClass: gitlab.class.GitlabMergeRequest,
      label: chunter.string.LeftComment
    },
    gitlab.ids.GitlabMergeRequestChatMessageViewlet
  )
  builder.createDoc(activity.class.ActivityExtension, core.space.Model, {
    ofClass: gitlab.class.GitlabMergeRequest,
    components: {
      input: { component: chunter.component.ChatMessageInput }
    }
  })

  // Linking bookkeeping and mirrored GitLab fields are not activity
  builder.createDoc(activity.class.ActivityMessageControl, core.space.Model, {
    objectClass: tracker.class.Issue,
    skip: [{ _class: core.class.TxMixin, mixin: gitlab.mixin.GitlabIssue }]
  })
  builder.createDoc<ActivityMessageControl<GitlabMergeRequest>>(activity.class.ActivityMessageControl, core.space.Model, {
    objectClass: gitlab.class.GitlabMergeRequest,
    skip: [],
    skipFields: [
      'url', 'gitlabIid', 'repository', 'state', 'draft', 'sourceBranch', 'targetBranch', 'mergeStatus',
      'hasConflicts', 'mergedAt', 'closedAt', 'commits', 'files', 'additions', 'deletions', 'approvedBy', 'reviewComments',
      // Collection of GitlabMergeRequestReview (viewed files); a counter, not a declared attribute
      'viewedFiles' as keyof GitlabMergeRequest,
      // Counter of the hidden GitlabPatch collection; not a declared attribute
      'patch' as keyof GitlabMergeRequest
    ]
  })
  builder.createDoc(activity.class.DocUpdateMessageViewlet, core.space.Model, {
    objectClass: gitlab.class.GitlabMergeRequest,
    action: 'update',
    icon: gitlab.icon.MergeRequest,
    config: {
      status: { iconPresenter: tracker.component.IssueStatusIcon },
      priority: { iconPresenter: tracker.component.PriorityIconPresenter }
    }
  })
}
