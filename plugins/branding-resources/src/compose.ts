// SPDX-License-Identifier: EPL-2.0

import type { Class, Client, Doc, Ref } from '@hcengineering/core'
import {
  type ComposeDocumentOptions,
  type PrintTemplate,
  type RenderContext,
  type TemplateDesign,
  buildComposedRequest,
  normalizeDesign,
  renderBodyDocument
} from '@hcengineering/branding'
import { getMetadata } from '@hcengineering/platform'
import presentation, { getClient } from '@hcengineering/presentation'
import { convertForPreview, printComposedToPDF } from '@hcengineering/print'
import { ensurePublicLink } from '@hcengineering/print-resources/src/printUtils'

import { buildPrintContext, collectDesignTexts } from './assets'
import { buildContentHtml, imageBlocks, isPrintableFile, resolveDocFile } from './body'
import { resolveFieldValues } from './fields'
import branding from './plugin'

/**
 * Templates offered for a document class, default first.
 */
export function filterTemplatesForClass (
  client: Client,
  templates: PrintTemplate[],
  _class: Ref<Class<Doc>>
): PrintTemplate[] {
  const hierarchy = client.getHierarchy()
  return templates
    .filter(
      (t) =>
        t.targetClasses === undefined ||
        t.targetClasses.length === 0 ||
        t.targetClasses.some((c) => hierarchy.hasClass(c) && hierarchy.isDerived(_class, c))
    )
    .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true) || a.name.localeCompare(b.name))
}

export async function resolveDocumentValues (client: Client, doc: Doc, design: TemplateDesign): Promise<Record<string, string>> {
  return await resolveFieldValues(client, doc, collectDesignTexts(design))
}

/**
 * Produce a PDF blob of the document with the template design applied.
 */
export async function composeWithDesign (
  client: Client,
  doc: Doc,
  design: TemplateDesign,
  options: ComposeDocumentOptions = {}
): Promise<string> {
  design = normalizeDesign(design)
  const resolved = await resolveDocumentValues(client, doc, design)
  const values = { ...resolved, ...(options.values ?? {}) }
  const ctx = await buildPrintContext(client, design, values, options.overrides)

  const token = getMetadata(presentation.metadata.Token) ?? ''
  let body: { link?: string, file?: string, html?: string }
  if (options.contentHtml !== undefined) {
    body = { html: renderBodyDocument(design, options.contentHtml, ctx) }
  } else if (options.file !== undefined) {
    body = { file: await fileToPdf(options.file, options.fileContentType ?? 'application/pdf', token) }
  } else {
    body = await defaultBody(client, doc, design, ctx, token, options.usePage === true)
  }

  return await printComposedToPDF(buildComposedRequest(design, ctx, body), token)
}

/**
 * Word documents are converted to PDF by the print service; PDFs are used as they are.
 */
async function fileToPdf (file: string, contentType: string, token: string): Promise<string> {
  if (contentType === 'application/pdf') {
    return file
  }
  const converted = await convertForPreview(file, token)
  if (converted.contentType !== 'application/pdf') {
    throw new Error('Converting this file to PDF is not configured on the print service')
  }
  return converted.id
}

async function defaultBody (
  client: Client,
  doc: Doc,
  design: TemplateDesign,
  ctx: RenderContext,
  token: string,
  usePage: boolean
): Promise<{ link?: string, file?: string, html?: string }> {
  const file = usePage ? undefined : await resolveDocFile(client, doc)
  if (file !== undefined && isPrintableFile(file.contentType)) {
    if (file.contentType.startsWith('image/')) {
      const html = buildContentHtml(await imageBlocks(file), new Set())
      return { html: renderBodyDocument(design, html, ctx) }
    }
    return { file: await fileToPdf(file.file, file.contentType, token) }
  }
  const link = await ensurePublicLink(client, doc)
  if (link?.url === undefined || link.url === '') {
    throw new Error(`Could not get public link for doc ${doc._id} (${doc._class})`)
  }
  return { link: link.url }
}

export async function composeDocument (
  doc: Doc,
  template: Ref<PrintTemplate>,
  options?: ComposeDocumentOptions
): Promise<string> {
  const client = getClient()
  const value = await client.findOne(branding.class.PrintTemplate, { _id: template })
  if (value === undefined) {
    throw new Error(`Print template ${template} not found`)
  }
  return await composeWithDesign(client, doc, value.design, options)
}
