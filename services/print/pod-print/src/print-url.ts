// SPDX-License-Identifier: EPL-2.0

function normalizeHostname (hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '')
}

/** Checks HTTP(S) print URLs against an explicit hostname allowlist. An empty list denies all URLs. */
export function isAllowedPrintUrl (link: string, allowedHostnames: readonly string[]): boolean {
  try {
    const url = new URL(link)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      allowedHostnames.some((hostname) => normalizeHostname(hostname) === normalizeHostname(url.hostname))
    )
  } catch {
    return false
  }
}

/**
 * Hostnames allowed for printing. Without ALLOWED_HOSTNAMES only the FRONT_URL host is allowed, so a default
 * deployment keeps printing its own pages while other hosts are rejected.
 */
export function getPrintHostnames (configured: readonly string[], frontUrl: string): string[] {
  const hostnames = configured.map(normalizeHostname).filter((hostname) => hostname !== '')
  if (hostnames.length > 0) return hostnames
  try {
    return [normalizeHostname(new URL(frontUrl).hostname)]
  } catch {
    return []
  }
}
