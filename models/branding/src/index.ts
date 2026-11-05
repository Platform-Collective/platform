// SPDX-License-Identifier: EPL-2.0

import { AccountRole, type Blob, type Class, type Doc, type Domain, IndexKind, type Ref } from '@hcengineering/core'
import type { BrandAsset, BrandAssetKind, PrintTemplate, TemplateDesign, TemplateType } from '@hcengineering/branding'
import {
  ArrOf,
  type Builder,
  Hidden,
  Index,
  Model,
  Prop,
  TypeBlob,
  TypeBoolean,
  TypeFileSize,
  TypeRecord,
  TypeRef,
  TypeString,
  UX
} from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import view, { createAction } from '@hcengineering/model-view'
import setting from '@hcengineering/setting'
import workbench from '@hcengineering/model-workbench'
import { TEMPLATE_TYPES, brandingId } from '@hcengineering/branding'

import branding from './plugin'

export { brandingId } from '@hcengineering/branding'
export { brandingOperation } from './migration'
export default branding

export const DOMAIN_BRANDING = 'branding' as Domain

@Model(branding.class.PrintTemplate, core.class.Doc, DOMAIN_BRANDING)
@UX(branding.string.PrintTemplate, branding.icon.Template)
export class TPrintTemplate extends TDoc implements PrintTemplate {
  @Prop(TypeString(), branding.string.Name)
  @Index(IndexKind.FullText)
    name!: string

  @Prop(TypeString(), branding.string.Description)
    description?: string

  @Prop(TypeString(), branding.string.TemplateType)
  @Hidden()
    templateType?: TemplateType

  @Prop(TypeRecord(), branding.string.PrintTemplate)
  @Hidden()
    design!: TemplateDesign

  @Prop(TypeBoolean(), branding.string.Default)
    isDefault?: boolean

  @Prop(ArrOf(TypeRef(core.class.Class)), core.string.Class)
  @Hidden()
    targetClasses?: Array<Ref<Class<Doc>>>
}

@Model(branding.class.BrandAsset, core.class.Doc, DOMAIN_BRANDING)
@UX(branding.string.BrandAsset, branding.icon.Image)
export class TBrandAsset extends TDoc implements BrandAsset {
  @Prop(TypeString(), branding.string.Name)
  @Index(IndexKind.FullText)
    name!: string

  @Prop(TypeString(), branding.string.Assets)
  @Hidden()
    kind!: BrandAssetKind

  @Prop(TypeBlob(), branding.string.Image)
  @Hidden()
    file!: Ref<Blob>

  @Prop(TypeString(), branding.string.ContentType)
  @Hidden()
    contentType!: string

  @Prop(TypeFileSize(), core.string.Size)
  @Hidden()
    size!: number

  @Prop(TypeString(), branding.string.FontFamily)
    fontFamily?: string
}

const TYPE_LABELS = {
  letterhead: branding.string.TypeLetterhead,
  notice: branding.string.TypeNotice,
  handbook: branding.string.TypeHandbook,
  report: branding.string.TypeReport,
  proposal: branding.string.TypeProposal,
  memo: branding.string.TypeMemo,
  presentation: branding.string.TypePresentation,
  other: branding.string.TypeOther
}

export function createModel (builder: Builder): void {
  builder.createModel(TPrintTemplate, TBrandAsset)

  // Sidebar application: saved templates by type, and the image and font library
  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: branding.string.Branding,
      icon: branding.icon.Branding,
      alias: brandingId,
      hidden: false,
      // Listed with the other main apps instead of at the end of the sidebar
      order: 450,
      accessLevel: AccountRole.User,
      navigatorModel: {
        specials: [
          {
            id: 'all',
            label: branding.string.AllTemplates,
            icon: branding.icon.Template,
            component: branding.component.PrintTemplatesSettings,
            position: 'top'
          },
          ...TEMPLATE_TYPES.map((type) => ({
            id: `type-${type}`,
            label: TYPE_LABELS[type],
            icon: branding.icon.Page,
            component: branding.component.PrintTemplatesSettings,
            componentProps: { templateType: type },
            position: 'top'
          })),
          {
            id: 'assets',
            label: branding.string.ImagesAndFonts,
            icon: branding.icon.Image,
            component: branding.component.BrandAssets,
            position: 'bottom'
          }
        ],
        spaces: []
      },
      navHeaderComponent: branding.component.BrandingNavHeader
    },
    branding.app.Branding
  )

  builder.createDoc(
    setting.class.WorkspaceSettingCategory,
    core.space.Model,
    {
      name: 'print-templates',
      label: branding.string.PrintTemplates,
      icon: branding.icon.Template,
      component: branding.component.PrintTemplatesSettings,
      group: 'settings-editor',
      role: AccountRole.Maintainer,
      order: 3600
    },
    branding.ids.PrintTemplatesSettings
  )

  // Listed after "Print to PDF" as the branding model is registered right after the print model
  createAction(
    builder,
    {
      action: branding.actionImpl.PrintWithTemplate,
      label: branding.string.PrintWithTemplateAction,
      icon: branding.icon.Template,
      category: view.category.General,
      input: 'focus',
      target: core.class.Doc,
      context: { mode: ['context', 'browser'], group: 'tools' },
      visibilityTester: branding.function.CanPrintWithTemplate
    },
    branding.action.PrintWithTemplate
  )

  builder.mixin(branding.class.PrintTemplate, core.class.Class, view.mixin.IgnoreActions, {
    actions: [view.action.Open, view.action.OpenInNewTab, branding.action.PrintWithTemplate]
  })

  builder.mixin(branding.class.BrandAsset, core.class.Class, view.mixin.IgnoreActions, {
    actions: [branding.action.PrintWithTemplate]
  })

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_BRANDING,
    disabled: [{ space: 1 }, { modifiedBy: 1 }, { createdBy: 1 }, { createdOn: -1 }]
  })
}
