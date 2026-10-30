// SPDX-License-Identifier: EPL-2.0

import core, { type Blob, type Client, type Ref, type TxOperations } from '@hcengineering/core'
import type { BrandAsset, BrandAssetKind, FieldValues, FontSource, RenderContext, TemplateDesign } from '@hcengineering/branding'
import { getFileUrl, uploadFile } from '@hcengineering/presentation'

import branding from './plugin'

const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2']
const FONT_CONTENT_TYPES: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2'
}

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif'
export const FONT_ACCEPT = FONT_EXTENSIONS.map((e) => `.${e}`).join(',')

function getExtension (name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function getAssetKind (file: { name: string, type: string }): BrandAssetKind | undefined {
  if (FONT_EXTENSIONS.includes(getExtension(file.name)) || file.type.startsWith('font/')) {
    return 'font'
  }
  if (file.type.startsWith('image/')) {
    return 'image'
  }
  return undefined
}

/**
 * A file already stored in the workspace (e.g. a Drive file) registered as brand asset; the blob is shared, not copied.
 */
export async function importStoredAsset (
  client: TxOperations,
  file: { name: string, file: Ref<Blob>, type: string, size: number }
): Promise<Ref<BrandAsset> | undefined> {
  const kind = getAssetKind(file)
  if (kind === undefined) {
    throw new Error(`Unsupported asset type: ${file.type !== '' ? file.type : file.name}`)
  }
  const existing = await client.findOne(branding.class.BrandAsset, { file: file.file })
  if (existing !== undefined) return existing._id
  const contentType = kind === 'font' && !file.type.startsWith('font/')
    ? FONT_CONTENT_TYPES[getExtension(file.name)] ?? 'font/ttf'
    : file.type
  return await client.createDoc(branding.class.BrandAsset, core.space.Workspace, {
    name: file.name,
    kind,
    file: file.file,
    contentType,
    size: file.size,
    fontFamily: kind === 'font' ? fontFamilyFromName(file.name) : undefined
  })
}

function fontFamilyFromName (name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_](regular|bold|italic|light|medium|semibold|black|thin)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
}

export async function uploadBrandAsset (client: TxOperations, file: File): Promise<Ref<BrandAsset>> {
  const kind = getAssetKind(file)
  if (kind === undefined) {
    throw new Error(`Unsupported asset type: ${file.type !== '' ? file.type : file.name}`)
  }
  let upload = file
  if (kind === 'font' && !file.type.startsWith('font/')) {
    upload = new File([file], file.name, { type: FONT_CONTENT_TYPES[getExtension(file.name)] ?? 'font/ttf' })
  }
  const { uuid } = await uploadFile(upload)
  return await client.createDoc(branding.class.BrandAsset, core.space.Workspace, {
    name: file.name,
    kind,
    file: uuid,
    contentType: upload.type,
    size: upload.size,
    fontFamily: kind === 'font' ? fontFamilyFromName(file.name) : undefined
  })
}

const dataUrlCache = new Map<string, Promise<string>>()

/**
 * Inline a blob as data URI; the print renderer does not load external resources.
 */
export async function loadAsDataUrl (file: Ref<Blob> | string): Promise<string> {
  let result = dataUrlCache.get(file)
  if (result === undefined) {
    result = (async () => {
      const response = await fetch(getFileUrl(file))
      if (!response.ok) {
        throw new Error(`Failed to load asset ${file}: ${response.status}`)
      }
      const blob = await response.blob()
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          resolve(reader.result as string)
        }
        reader.onerror = () => {
          reject(reader.error ?? new Error('Failed to read asset'))
        }
        reader.readAsDataURL(blob)
      })
    })()
    dataUrlCache.set(file, result)
    result.catch(() => dataUrlCache.delete(file))
  }
  return await result
}

export function collectDesignFiles (design: TemplateDesign): string[] {
  const files = new Set<string>()
  const surfaces = [...design.pages.filter((p) => p.enabled), design.header, design.footer]
  for (const page of design.pages) {
    if (page.enabled && page.background.file !== undefined) files.add(page.background.file)
  }
  for (const surface of surfaces) {
    for (const el of surface.elements) {
      if (el.kind === 'image' && el.file !== undefined && el.hidden !== true) files.add(el.file)
    }
  }
  return Array.from(files)
}

export function collectDesignTexts (design: TemplateDesign): string[] {
  return [...design.pages.filter((p) => p.enabled), design.header, design.footer].flatMap((s) =>
    s.elements.flatMap((el) => (el.kind === 'text' ? [el.text] : []))
  )
}

function collectFontFamilies (design: TemplateDesign): Set<string> {
  const families = new Set<string>()
  const add = (family: string): void => {
    for (const f of family.split(',')) families.add(f.replace(/["']/g, '').trim().toLowerCase())
  }
  for (const surface of [...design.pages, design.header, design.footer]) {
    for (const el of surface.elements) {
      if (el.kind === 'text') add(el.style.fontFamily)
    }
  }
  add(design.typography.body.fontFamily)
  for (const h of Object.values(design.typography.headings)) add(h.fontFamily)
  return families
}

export function getPreviewFonts (assets: BrandAsset[]): FontSource[] {
  return assets
    .filter((a) => a.kind === 'font' && a.fontFamily !== undefined)
    .map((a) => ({ family: a.fontFamily ?? a.name, url: getFileUrl(a.file) }))
}

/**
 * Prepare a render context with every referenced asset inlined.
 */
export async function buildPrintContext (
  client: Client,
  design: TemplateDesign,
  values: FieldValues,
  overrides?: Record<string, string>
): Promise<RenderContext> {
  const families = collectFontFamilies(design)
  const fontAssets = (await client.findAll(branding.class.BrandAsset, { kind: 'font' })).filter(
    (a) => a.fontFamily !== undefined && families.has(a.fontFamily.toLowerCase())
  )
  const files = collectDesignFiles(design)
  const [fileUrls, fonts] = await Promise.all([
    Promise.all(files.map(async (f) => [f, await loadAsDataUrl(f)] as const)),
    Promise.all(fontAssets.map(async (a) => ({ family: a.fontFamily ?? a.name, url: await loadAsDataUrl(a.file) })))
  ])
  const urlMap = new Map<string, string>(fileUrls)
  return {
    values,
    overrides,
    fonts,
    mode: 'print',
    resolveFile: (file) => urlMap.get(file)
  }
}
