// SPDX-License-Identifier: EPL-2.0

import { type Resources } from '@hcengineering/platform'

import { canPrintWithTemplate, printWithTemplate } from './actions'
import BrandAssets from './components/BrandAssets.svelte'
import BrandingNavHeader from './components/BrandingNavHeader.svelte'
import PrintTemplatesSettings from './components/PrintTemplatesSettings.svelte'
import PrintPreview from './components/preview/PrintPreview.svelte'
import { composeDocument } from './compose'

export { composeDocument, composeWithDesign, filterTemplatesForClass } from './compose'
export { resolveFieldValues } from './fields'

export default async (): Promise<Resources> => ({
  component: {
    PrintTemplatesSettings,
    PrintPreview,
    BrandAssets,
    BrandingNavHeader
  },
  function: {
    ComposeDocument: composeDocument,
    CanPrintWithTemplate: canPrintWithTemplate
  },
  actionImpl: {
    PrintWithTemplate: printWithTemplate
  }
})
