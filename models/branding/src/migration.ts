// SPDX-License-Identifier: EPL-2.0

import core, { TxOperations } from '@hcengineering/core'
import { type TemplateType, brandingId, createDesignForType } from '@hcengineering/branding'
import {
  tryUpgrade,
  type MigrateOperation,
  type MigrationClient,
  type MigrationUpgradeClient
} from '@hcengineering/model'

import branding from './plugin'

const STARTER_TEMPLATES: Array<{ name: string, templateType: TemplateType, isDefault: boolean }> = [
  { name: 'Report', templateType: 'report', isDefault: true },
  { name: 'Letterhead', templateType: 'letterhead', isDefault: false },
  { name: 'Official notice', templateType: 'notice', isDefault: false },
  { name: 'Handbook', templateType: 'handbook', isDefault: false }
]

export const brandingOperation: MigrateOperation = {
  async migrate (client: MigrationClient): Promise<void> {},
  async upgrade (state: Map<string, Set<string>>, client: () => Promise<MigrationUpgradeClient>, mode): Promise<void> {
    await tryUpgrade(mode, state, client, brandingId, [
      {
        // Every workspace starts with ready to use templates, so "Print with template" is available right away
        state: 'create-starter-templates',
        func: async (client) => {
          const tx = new TxOperations(client, core.account.System)
          const existing = await tx.findOne(branding.class.PrintTemplate, {})
          if (existing !== undefined) return
          for (const template of STARTER_TEMPLATES) {
            await tx.createDoc(branding.class.PrintTemplate, core.space.Workspace, {
              ...template,
              design: createDesignForType(template.templateType)
            })
          }
        }
      }
    ])
  }
}
