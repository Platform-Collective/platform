//
// Copyright © 2024 Hardcore Engineering Inc.
//

import { getMetadata } from '@hcengineering/platform'

import print from './plugin'

export function getPrintBaseURL (): string {
  const endpoint = getMetadata(print.metadata.PrintURL)

  if (endpoint === undefined || endpoint === '') {
    throw new Error('Print service endpoint url is not configured')
  }

  return endpoint
}

export type PrintPageOrientation = 'portrait' | 'landscape'

export interface PrintToPDFOptions {
  orientation?: PrintPageOrientation
}

export async function printToPDF (link: string, token: string, options?: PrintToPDFOptions): Promise<string> {
  if (token === '') {
    return ''
  }

  const url: URL = new URL(`${getPrintBaseURL()}/print`)
  url.searchParams.append('link', encodeURIComponent(link))
  url.searchParams.append('kind', 'pdf')
  if (options?.orientation !== undefined) {
    url.searchParams.append('orientation', options.orientation)
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  })

  const res = await response.json()

  if (!response.ok) {
    throw new Error(res.message)
  }

  return res.id
}

export interface PrintPageMargins {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Document print with extra pages, header/footer and content stylesheet, all geometry in millimetres.
 * Pages are standalone HTML documents; their resources must be inlined (data URIs) as the renderer
 * does not load external resources for them.
 */
export interface ComposedPrintRequest {
  // Public link to the document body
  link?: string
  // Existing PDF blob used as document body
  file?: string
  // Standalone HTML document used as document body, rendered offline like the template pages
  html?: string
  page: { width: number, height: number }
  margins: PrintPageMargins
  before: string[]
  after: string[]
  headerTemplate?: string
  footerTemplate?: string
  contentCss?: string
  // Transparent page stamped over every document page (watermarks, logos, borders)
  overlay?: string
  overlayOnTemplatePages?: boolean
  // Headers, footers and overlays stamped per page following page rules; replaces the templates above
  decorations?: ComposedDecorations
}

export interface ComposedDecorations {
  // Absolutely positioned page markup with the page rules it is shown on
  layers: Array<{ html: string, match: object[], exclude: object[] }>
  numbering: { countTemplatePages: boolean, start: number }
  // Shared stylesheet, e.g. inlined fonts
  css: string
}

export async function printComposedToPDF (request: ComposedPrintRequest, token: string): Promise<string> {
  if (token === '') {
    throw new Error('Missing authentication token')
  }

  const response = await fetch(`${getPrintBaseURL()}/print/composed`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  })

  const res = await response.json().catch(() => undefined)

  if (!response.ok) {
    throw new Error(res?.message ?? `Composed print failed with status ${response.status}`)
  }
  if (typeof res?.id !== 'string' || res.id === '') {
    throw new Error('Invalid composed print response')
  }

  return res.id
}

export interface ConvertedPreview {
  id: string
  contentType: 'application/pdf' | 'text/html'
}

export async function convertForPreview (file: string, token: string, signal?: AbortSignal): Promise<ConvertedPreview> {
  if (token === '') {
    throw new Error('Missing authentication token')
  }

  const url = new URL(`${getPrintBaseURL()}/convert/${file}`)
  url.searchParams.set('format', 'preview')
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    },
    signal
  })

  if (!response.ok) {
    const error = await response.json().catch(() => undefined)
    throw new Error(`Failed to convert preview: ${error?.message ?? response.status}`)
  }

  const result = await response.json()
  if (typeof result?.id !== 'string' || result.id.trim() === '') {
    throw new Error('Invalid preview response')
  }
  const contentType = result.contentType === undefined ? 'text/html' : result.contentType
  if (contentType !== 'application/pdf' && contentType !== 'text/html') {
    throw new Error('Invalid preview response')
  }

  return { id: result.id, contentType }
}

export async function convertToHTML (file: string, token: string): Promise<string> {
  if (token === '') {
    return ''
  }

  const url: URL = new URL(`${getPrintBaseURL()}/convert/${file}`)
  url.searchParams.set('format', 'html')

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/html'
    }
  })

  const res = await response.json()

  if (!response.ok) {
    throw new Error('Failed to convert to HTML: ' + res.message)
  }

  return res.id
}
