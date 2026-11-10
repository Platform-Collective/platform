// SPDX-License-Identifier: EPL-2.0

/**
 * Validation helpers for lists of e-mail domains (e.g. invite links limited to a company domain).
 * Shared by the account service and the UI so both accept exactly the same input.
 */

const MAX_DOMAIN_LENGTH = 253
const MAX_DOMAINS = 100
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * @public
 */
export interface ParsedEmailDomains {
  domains: string[]
  invalid: string[]
}

/**
 * Normalizes one domain entry: trims, lowercases, drops a leading '@' and a trailing '.'.
 * Returns undefined if the result is not a valid DNS host name with at least two labels
 * (only ASCII / punycode is accepted).
 *
 * @public
 */
export function normalizeEmailDomain (value: string): string | undefined {
  let domain = value.trim().toLowerCase()
  if (domain.startsWith('@')) {
    domain = domain.slice(1)
  }
  if (domain.endsWith('.')) {
    domain = domain.slice(0, -1)
  }
  if (domain.length === 0 || domain.length > MAX_DOMAIN_LENGTH) {
    return undefined
  }
  const labels = domain.split('.')
  if (labels.length < 2) {
    return undefined
  }
  for (const label of labels) {
    if (!LABEL_RE.test(label)) {
      return undefined
    }
  }
  // The top level domain can not be purely numeric (rejects IP addresses like 10.0.0.1)
  if (/^[0-9]+$/.test(labels[labels.length - 1])) {
    return undefined
  }
  return domain
}

/**
 * Parses a comma/semicolon/whitespace separated list (or an array) of domains.
 * Empty entries are ignored, duplicates are removed, invalid entries are reported.
 * At most 100 domains are accepted, the rest is reported as invalid.
 *
 * @public
 */
export function parseEmailDomains (input: string | string[] | null | undefined): ParsedEmailDomains {
  const raw: string[] = []
  if (typeof input === 'string') {
    raw.push(...input.split(/[\s,;]+/))
  } else if (Array.isArray(input)) {
    for (const item of input) {
      raw.push(...String(item).split(/[\s,;]+/))
    }
  } else if (input != null) {
    raw.push(String(input))
  }

  const domains: string[] = []
  const invalid: string[] = []
  for (const entry of raw) {
    if (entry.trim().length === 0) continue
    const domain = normalizeEmailDomain(entry)
    if (domain === undefined) {
      invalid.push(entry.trim())
    } else if (!domains.includes(domain)) {
      domains.push(domain)
    }
  }
  if (domains.length > MAX_DOMAINS) {
    invalid.push(...domains.splice(MAX_DOMAINS))
  }
  return { domains, invalid }
}
