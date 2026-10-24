// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import core from '@hcengineering/core'
import { type PrintTemplate, type TemplateType, TEMPLATE_TYPES, createDesignForType } from '@hcengineering/branding'
import { translate } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { SelectPopup, languageStore, showPopup } from '@hcengineering/ui'
import { get } from 'svelte/store'

import TemplateEditor from './components/editor/TemplateEditor.svelte'
import branding from './plugin'
import { templateTypeLabel } from './sample'

export function editTemplate (template: PrintTemplate): void {
  showPopup(TemplateEditor, { template }, 'content')
}

export async function createTemplate (templateType: TemplateType): Promise<void> {
  const client = getClient()
  const language = get(languageStore)
  const typeName = await translate(templateTypeLabel(templateType), {}, language)
  const name = await translate(branding.string.NewTemplate, {}, language)
  const hasDefault = (await client.findOne(branding.class.PrintTemplate, { isDefault: true })) !== undefined
  const _id = await client.createDoc(branding.class.PrintTemplate, core.space.Workspace, {
    name: `${typeName} — ${name}`,
    templateType,
    design: createDesignForType(templateType),
    isDefault: !hasDefault
  })
  const created = await client.findOne(branding.class.PrintTemplate, { _id })
  if (created !== undefined) editTemplate(created)
}

/**
 * Ask for the template type, then create a template from its starter design and open the designer.
 */
export function chooseTypeAndCreate (target: HTMLElement | undefined, preselected?: TemplateType): void {
  const run = (type: TemplateType): void => {
    createTemplate(type).catch((err: unknown) => {
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    })
  }
  if (preselected !== undefined) {
    run(preselected)
    return
  }
  showPopup(
    SelectPopup,
    { value: TEMPLATE_TYPES.map((t) => ({ id: t, label: templateTypeLabel(t), icon: branding.icon.Template })) },
    target ?? 'top',
    (type: TemplateType | undefined) => {
      if (type !== undefined) run(type)
    }
  )
}
