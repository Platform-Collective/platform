// SPDX-License-Identifier: EPL-2.0

import { GITLAB_IMAGE_FRAGMENT } from '@hcengineering/gitlab'

/** Where one GitLab project's uploads live. */
export interface UploadTarget {
  host: string
  webUrl: string
  projectId: number
}

/** A Huly image in serialized markdown. */
export interface HulyImage {
  file: string
  alt: string
}

// Fenced code blocks and code spans stay as written
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g

// ![alt](url "title"){attributes} or [text](url "title"); GitLab writes an image's size in the braces
const LINK = /(!?)\[((?:[^\][\\]|\\.)*)\]\(\s*(<[^>\n]*>|[^)\s]+)(\s+"[^"\n]*")?\s*\)(\{[^}\n]*\})?/g

// The img tag Huly's serializer writes for a sized image that is not a Huly file
const IMG = /<img(?: width="([^"<>]*)")?(?: height="([^"<>]*)")? src="([^"<>]*)"(?: alt="([^"<>]*)")?>/g

// GitLab upload secrets are 32 hex characters
const UPLOAD_PATH = /^\/uploads\/[0-9a-f]{32}\/[^/?#]+$/

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp'
}

function outsideCode (markdown: string, fn: (text: string) => string): string {
  // split keeps the captured code parts at the odd indexes
  return markdown
    .split(CODE)
    .map((part, index) => (index % 2 === 1 ? part : fn(part)))
    .join('')
}

function unwrap (url: string): string {
  return url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url
}

/** A URL as written in a link: in angle brackets when it holds characters that would end it. */
export function linkTarget (url: string): string {
  return /[\s<>()]/.test(url) ? `<${url}>` : url
}

function projectPrefix (target: UploadTarget): string {
  return `/-/project/${target.projectId}`
}

/** The canonical '/uploads/<secret>/<name>' of a link to this project's uploads; undefined for anything else. */
export function uploadPathOf (url: string, target: UploadTarget): string | undefined {
  const prefix = projectPrefix(target)
  let path: string | undefined
  if (url.startsWith('/uploads/')) path = url
  else if (url.startsWith(`${target.webUrl}/uploads/`)) path = url.slice(target.webUrl.length)
  else if (url.startsWith(`${prefix}/uploads/`)) path = url.slice(prefix.length)
  else if (url.startsWith(`${target.host}${prefix}/uploads/`)) path = url.slice(target.host.length + prefix.length)
  return path !== undefined && UPLOAD_PATH.test(path) && !isDotSegment(path.slice(path.lastIndexOf('/') + 1))
    ? path
    : undefined
}

// '.' or '..', as written or percent-encoded: such a name would address another GitLab endpoint
function isDotSegment (name: string): boolean {
  let decoded = name
  try {
    decoded = decodeURIComponent(name)
  } catch {}
  return name === '.' || name === '..' || decoded === '.' || decoded === '..'
}

// A relative upload link made absolute, keeping its form
function absoluteUrl (url: string, target: UploadTarget): string {
  // By project id: GitLab.com answers 404 for <project path>/uploads/…
  if (url.startsWith('/uploads/')) return `${target.host}${projectPrefix(target)}${url}`
  if (url.startsWith('/-/project/')) return `${target.host}${url}`
  return url
}

// The relative form of an absolute link to this project's uploads; undefined for anything else
function relativeUrl (url: string, target: UploadTarget): string | undefined {
  // The project path form, as a link copied from GitLab's web UI may use
  if (url.startsWith(`${target.webUrl}/uploads/`)) return url.slice(target.webUrl.length)
  // GitLab's own markdown writes uploads as /uploads/…, so the project id form returns to it
  const prefix = `${target.host}${projectPrefix(target)}`
  if (url.startsWith(`${prefix}/uploads/`)) return url.slice(prefix.length)
  return undefined
}

/** The upload path of an absolute link to this project's uploads; undefined for relative links and anything else. */
export function absoluteUploadPathOf (url: string, target: UploadTarget): string | undefined {
  const relative = relativeUrl(url, target)
  return relative === undefined ? undefined : uploadPathOf(relative, target)
}

function sizeOf (attributes: string): { width?: string, height?: string } {
  const size: { width?: string, height?: string } = {}
  for (const match of attributes.matchAll(/(width|height)\s*=\s*"?([0-9.]+(?:px|%)?)"?/g)) {
    size[match[1] as 'width' | 'height'] = match[2]
  }
  return size
}

// ' width=W height=H' style attribute list without the braces, empty when there is no size
function sizeAttributes (width: string | undefined, height: string | undefined): string {
  return [width !== undefined ? `width=${width}` : '', height !== undefined ? `height=${height}` : '']
    .filter((it) => it !== '')
    .join(' ')
}

// A GitLab image as a link marked by its fragment: the size travels in the fragment, so the image comes
// back to GitLab byte for byte. Undefined when a link cannot hold the image: a title, no label, or inside another link.
function imageLink (
  label: string,
  url: string,
  title: string | undefined,
  attributes: string | undefined,
  insideLink: boolean
): string | undefined {
  if (title !== undefined || label === '' || insideLink) return undefined
  const fragment =
    attributes === undefined
      ? GITLAB_IMAGE_FRAGMENT
      : `${GITLAB_IMAGE_FRAGMENT}=${encodeURIComponent(attributes.slice(1, -1))}`
  return `[${label}](${linkTarget(`${url}#${fragment}`)})`
}

// The GitLab image markdown of a link to this project's uploads marked as an image, its fragment holding the encoded
// braces; undefined for any other link.
function imageOfLink (label: string, raw: string, target: UploadTarget): string | undefined {
  const url = unwrap(raw)
  const hash = url.indexOf('#')
  const relative = relativeUrl(hash < 0 ? url : url.slice(0, hash), target)
  if (relative === undefined || uploadPathOf(relative, target) === undefined) return undefined
  let encoded: string | undefined = hash < 0 ? undefined : url.slice(hash + 1)
  if (encoded === GITLAB_IMAGE_FRAGMENT) encoded = undefined
  else if (encoded?.startsWith(`${GITLAB_IMAGE_FRAGMENT}=`) === true) {
    encoded = encoded.slice(GITLAB_IMAGE_FRAGMENT.length + 1)
  } else return undefined
  let attributes = ''
  if (encoded !== undefined) {
    try {
      attributes = `{${decodeURIComponent(encoded)}}`
    } catch {
      return undefined
    }
  }
  return `![${label}](${linkTarget(relative)})${attributes}`
}

function hulyImageOf (url: string, imageUrl: string): { file: string, width?: string, height?: string } {
  const [file, ...params] = url.slice(imageUrl.length).split(/[?&]/)
  const result: { file: string, width?: string, height?: string } = { file }
  for (const param of params) {
    const [key, value] = param.split('=')
    if (key === 'width' || key === 'height') result[key] = value
  }
  return result
}

/** The distinct upload paths of this project's images in GitLab markdown. */
export function inboundImagePaths (markdown: string, target: UploadTarget): string[] {
  const paths = new Set<string>()
  outsideCode(markdown, (text) => {
    for (const match of text.matchAll(LINK)) {
      if (match[1] !== '!') continue
      const path = uploadPathOf(unwrap(match[3]), target)
      if (path !== undefined) paths.add(path)
    }
    return text
  })
  return [...paths]
}

/** Copied images point at their Huly file; other images of this project become links marked as GitLab images, other links absolute. */
export function rewriteInbound (
  markdown: string,
  target: UploadTarget,
  files: ReadonlyMap<string, string>,
  imageUrl: string
): string {
  return outsideCode(markdown, (text) =>
    text.replace(
      LINK,
      (
        whole: string,
        bang: string,
        label: string,
        raw: string,
        title: string | undefined,
        attributes: string | undefined,
        offset: number,
        all: string
      ) => {
        const url = unwrap(raw)
        const path = uploadPathOf(url, target)
        if (path === undefined) return whole
        const file = bang === '!' ? files.get(path) : undefined
        if (file !== undefined) {
          const { width, height } = sizeOf(attributes ?? '')
          const params =
            (width !== undefined ? `&width=${width}` : '') + (height !== undefined ? `&height=${height}` : '')
          return `![${label}](${imageUrl}${file}${params}${title ?? ''})`
        }
        const absolute = absoluteUrl(url, target)
        // A link right after '[' or '!' would be read as part of a link or as an image
        const link =
          bang === '!'
            ? imageLink(label, absolute, title, attributes, all[offset - 1] === '[' || all[offset - 1] === '!')
            : undefined
        return link ?? `${bang}[${label}](${linkTarget(absolute)}${title ?? ''})${attributes ?? ''}`
      }
    )
  )
}

/** The Huly images of serialized Huly markdown. */
export function outboundImages (markdown: string, imageUrl: string): HulyImage[] {
  const images: HulyImage[] = []
  outsideCode(markdown, (text) => {
    for (const match of text.matchAll(LINK)) {
      const url = unwrap(match[3])
      if (match[1] === '!' && url.startsWith(imageUrl)) {
        images.push({ file: hulyImageOf(url, imageUrl).file, alt: match[2] })
      }
    }
    return text
  })
  return images
}

/** Huly images with a GitLab copy point at the upload; marked links become images again, absolute upload links relative. */
export function rewriteOutbound (
  markdown: string,
  target: UploadTarget,
  paths: ReadonlyMap<string, string>,
  imageUrl: string
): string {
  return outsideCode(markdown, (text) =>
    text
      .replace(LINK, (whole: string, bang: string, label: string, raw: string, title?: string, attributes?: string) => {
        const url = unwrap(raw)
        if (bang === '!' && url.startsWith(imageUrl)) {
          const { file, width, height } = hulyImageOf(url, imageUrl)
          const path = paths.get(file)
          if (path === undefined) return whole
          const size = sizeAttributes(width, height)
          return `![${label}](${linkTarget(path)}${title ?? ''})${size !== '' ? `{${size}}` : ''}`
        }
        if (bang === '' && title === undefined && attributes === undefined) {
          const image = imageOfLink(label, raw, target)
          if (image !== undefined) return image
        }
        const relative = relativeUrl(url, target)
        return relative === undefined
          ? whole
          : `${bang}[${label}](${linkTarget(relative)}${title ?? ''})${attributes ?? ''}`
      })
      .replace(IMG, (whole: string, width?: string, height?: string, src?: string, alt?: string) => {
        const relative = relativeUrl(src ?? '', target)
        if (relative === undefined) return whole
        const size = sizeAttributes(width, height)
        return `![${alt ?? ''}](${linkTarget(relative)})${size !== '' ? `{${size}}` : ''}`
      })
  )
}

/** GitLab text that still shows Huly image links. */
export function hasHulyImages (markdown: string | null | undefined, imageUrl: string): boolean {
  return markdown != null && outboundImages(markdown, imageUrl).length > 0
}

/** A file name for an upload: the image's alt text, with an extension from its type when it has none. */
export function uploadName (alt: string | undefined, contentType: string): string {
  const base = (alt ?? '').replace(/\\(.)/g, '$1').replace(/[/\\]/g, '_').trim()
  const extension = EXTENSIONS[contentType]
  if (base === '') return extension !== undefined ? `image.${extension}` : 'image'
  return extension === undefined || /\.[A-Za-z0-9]{1,5}$/.test(base) ? base : `${base}.${extension}`
}
