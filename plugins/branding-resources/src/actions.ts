// SPDX-License-Identifier: EPL-2.0

import { type Blob, type Doc, type Ref } from '@hcengineering/core'
import { PDFViewer, getClient } from '@hcengineering/presentation'
import print, { getPrintBaseURL } from '@hcengineering/print'
import { showPopup } from '@hcengineering/ui'
import view from '@hcengineering/view'
import { getDocTitle } from '@hcengineering/view-resources'

import PrintPreview from './components/preview/PrintPreview.svelte'
import branding from './plugin'

/**
 * Documents whose "Print to PDF" produces signed PDFs (e.g. controlled documents) are signed here as well.
 */
function isSignedPrint (doc: Doc): boolean {
  const client = getClient()
  const hierarchy = client.getHierarchy()
  return client
    .getModel()
    .findAllSync(view.class.Action, {})
    .some(
      (action) =>
        action.label === print.string.PrintToPDF &&
        action.actionProps?.signed === true &&
        hierarchy.isDerived(doc._class, action.target)
    )
}

export async function printWithTemplate (object: Doc | Doc[]): Promise<void> {
  const doc = Array.isArray(object) ? object[0] : object
  if (doc === undefined) return
  showPopup(PrintPreview, { object: doc, signed: isSignedPrint(doc) }, 'content', (result: string | undefined) => {
    if (result === undefined) return
    void getDocTitle(getClient(), doc._id, doc._class, doc).then((title) => {
      showPopup(
        PDFViewer,
        {
          file: result as Ref<Blob>,
          name: title !== undefined && title !== '' ? `${title}.pdf` : 'document.pdf',
          contentType: 'application/pdf',
          showIcon: false
        },
        'float'
      )
    })
  })
}

export async function canPrintWithTemplate (doc?: Doc | Doc[]): Promise<boolean> {
  if (Array.isArray(doc) && doc.length !== 1) return false
  try {
    if (getPrintBaseURL() === '') return false
  } catch {
    return false
  }
  const client = getClient()
  return (await client.findOne(branding.class.PrintTemplate, {}, { projection: { _id: 1 } })) !== undefined
}
