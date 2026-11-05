// SPDX-License-Identifier: EPL-2.0

import {
  isAllowlistedHost,
  normalizeHostname,
  resolveAndCheck,
  validateOptions,
  validateUrl
} from '@hcengineering/safe-fetch'

interface PrintHost {
  hostname: string
  port: string
  protocol?: string
}

function parsePrintHost (entry: string): PrintHost {
  const value = entry.trim()
  const origin = value.includes('://')
  const authority = !origin && !value.startsWith('[') && value.split(':').length > 2 ? `[${value}]` : value
  const url = new URL(origin ? value : `https://${authority}`)
  const hostname = normalizeHostname(url.hostname)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    hostname === '' ||
    (hostname.includes('*') && (!hostname.startsWith('*.') || hostname.slice(2).includes('*')))
  ) {
    throw new Error('Invalid print host configuration')
  }
  // A bare host allows only default HTTP/HTTPS ports. An explicit port applies to either scheme.
  const port = origin
    ? url.port || (url.protocol === 'https:' ? '443' : '80')
    : authority.endsWith(':443')
      ? '443'
      : url.port
  return { hostname, port, protocol: origin ? url.protocol : undefined }
}

/** Checks HTTP(S) URLs against configured hosts/ports or exact front-end origins. */
export function isAllowedPrintUrl (link: string, allowedHostnames: readonly string[]): boolean {
  try {
    const url = new URL(link)
    if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') return false
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    return allowedHostnames.some((entry) => {
      if (entry.trim() === '') return false
      const allowed = parsePrintHost(entry)
      return (
        isAllowlistedHost(url.hostname, [allowed.hostname]) &&
        (allowed.protocol === undefined || allowed.protocol === url.protocol) &&
        (allowed.port === '' ? url.port === '' : allowed.port === port)
      )
    })
  } catch {
    return false
  }
}

/** Always include FRONT_URL's exact origin, even when additional hosts are configured. */
export function getPrintHostnames (configured: readonly string[], frontUrl: string): string[] {
  const hostnames = configured
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const host = parsePrintHost(entry)
      validateOptions({ allowlist: [host.hostname] })
      const hostname = host.hostname.includes(':') ? `[${host.hostname}]` : host.hostname
      return host.protocol !== undefined
        ? `${host.protocol}//${hostname}:${host.port}`
        : `${hostname}${host.port === '' ? '' : `:${host.port}`}`
    })
  try {
    const front = new URL(frontUrl)
    if (!['http:', 'https:'].includes(front.protocol) || front.username !== '' || front.password !== '')
      {return hostnames}
    front.hostname = normalizeHostname(front.hostname).includes(':')
      ? `[${normalizeHostname(front.hostname)}]`
      : normalizeHostname(front.hostname)
    hostnames.push(front.origin)
  } catch {
    // An invalid front URL contributes no permission.
  }
  return [...new Set(hostnames)]
}

/** Per-render DNS cache; private addresses are trusted only on an explicitly allowed host and port. */
export function createPrintRequestChecker (allowedHostnames: readonly string[]): (raw: string) => Promise<boolean> {
  const checked = new Map<string, Promise<boolean>>()
  return async (raw) => {
    try {
      const url = new URL(raw)
      if (url.protocol === 'data:' || url.protocol === 'blob:') return true
      if (isAllowedPrintUrl(raw, allowedHostnames)) return true
      validateUrl(url, { allowHttp: true })
      const hostname = normalizeHostname(url.hostname)
      let result = checked.get(hostname)
      if (result === undefined) {
        result = resolveAndCheck(hostname, { allowHttp: true }).then(
          () => true,
          () => false
        )
        checked.set(hostname, result)
      }
      return await result
    } catch {
      return false
    }
  }
}
