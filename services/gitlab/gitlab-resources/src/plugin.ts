// SPDX-License-Identifier: EPL-2.0

import { type IntlString, mergeIds } from '@hcengineering/platform'
import gitlab, { gitlabId } from '@hcengineering/gitlab'
import { type Ref } from '@hcengineering/core'
import { type Handler, type IntegrationType } from '@hcengineering/setting'
import { type AnyComponent } from '@hcengineering/ui'

export default mergeIds(gitlabId, gitlab, {
  string: {
    Authorize: '' as IntlString,
    ReAuthorize: '' as IntlString,
    Authorized: '' as IntlString,
    NotAuthorized: '' as IntlString,
    Repositories: '' as IntlString,
    NoRepositories: '' as IntlString,
    RefreshRepositories: '' as IntlString,
    LinkToProject: '' as IntlString,
    Unlink: '' as IntlString,
    LinkedTo: '' as IntlString,
    Unavailable: '' as IntlString,
    Processing: '' as IntlString,
    AutoClose: '' as IntlString,
    RequestFailed: '' as IntlString,
    CloseTab: '' as IntlString,
    KeepSettingsOpen: '' as IntlString,
    Disconnect: '' as IntlString,
    Repository: '' as IntlString,
    SetupTitle: '' as IntlString,
    SetupWhere: '' as IntlString,
    SetupUserOwned: '' as IntlString,
    SetupGroupOwned: '' as IntlString,
    SetupInstanceWide: '' as IntlString,
    SetupTrustedHint: '' as IntlString,
    SetupNameAndRedirect: '' as IntlString,
    SetupConfidentialScopes: '' as IntlString,
    SetupCopyCredentials: '' as IntlString,
    GitlabUrl: '' as IntlString,
    SelfManaged: '' as IntlString,
    ApplicationId: '' as IntlString,
    ApplicationSecret: '' as IntlString,
    KeepSecretHint: '' as IntlString,
    Save: '' as IntlString,
    Change: '' as IntlString,
    Remove: '' as IntlString,
    Copy: '' as IntlString,
    Copied: '' as IntlString,
    ConfiguredApp: '' as IntlString,
    OwnerMustConfigure: '' as IntlString,
    InvalidGitlabUrl: '' as IntlString,
    SetupEnterUrlFirst: '' as IntlString,
    DisconnectEveryone: '' as IntlString,
    DisconnectEveryoneConfirm: '' as IntlString
  },
  component: {
    Connect: '' as AnyComponent,
    Configure: '' as AnyComponent,
    GitlabIcon: '' as AnyComponent,
    IntegrationState: '' as AnyComponent
  },
  handler: {
    DisconnectHandler: '' as Handler
  },
  integrationType: {
    Gitlab: '' as Ref<IntegrationType>
  }
})
