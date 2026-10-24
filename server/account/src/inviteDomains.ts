// SPDX-License-Identifier: EPL-2.0

/**
 * Helpers for restricting workspace invites to a list of e-mail domains.
 *
 * Matching rules (security boundary, keep them strict):
 * - The e-mail must be exactly ONE syntactically valid address (see isStrictSingleEmail):
 *   no display names, quotes, angle brackets, commas, semicolons, whitespace or extra '@'.
 *   This prevents inputs like "attacker@evil.test,employee@example.com", which a mailer
 *   would treat as two recipients, from passing the domain check.
 * - The domain of an e-mail address is the part after the '@'.
 * - Comparison is case-insensitive and EXACT: "example.com" allows
 *   "a@example.com" but neither "a@sub.example.com" nor "a@evilexample.com".
 *   Subdomains have to be listed explicitly.
 * - A single trailing dot (FQDN form) is ignored on both sides.
 * - An empty/missing restriction means "no domain restriction".
 */

const MAX_DOMAIN_LENGTH = 253
const MAX_DOMAINS = 100
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const MAX_EMAIL_LENGTH = 254
const MAX_LOCAL_PART_LENGTH = 64
// RFC 5322 dot-atom local part, without quoted strings
const LOCAL_PART_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i

export interface ParsedAllowedDomains {
  domains: string[]
  invalid: string[]
}

/**
 * Normalizes one domain entry: trims, lowercases, drops a leading '@' and a trailing '.'.
 * Returns undefined if the result is not a valid DNS host name with at least two labels
 * (only ASCII / punycode is accepted).
 */
export function normalizeDomain (value: string): string | undefined {
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
 */
export function parseAllowedDomains (input: string | string[] | null | undefined): ParsedAllowedDomains {
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
    const domain = normalizeDomain(entry)
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

/**
 * Serializes normalized domains for storage in the invite record.
 * Returns undefined when there is no restriction.
 */
export function serializeAllowedDomains (domains: string[]): string | undefined {
  return domains.length > 0 ? domains.join(',') : undefined
}

/**
 * Strictly checks that the value is exactly one plain e-mail address "local@domain":
 * a dot-atom local part (no quotes) and a valid DNS host name as domain.
 * Display names, angle brackets, quotes, whitespace, commas, semicolons, several '@',
 * IP literals and other address list syntax are rejected.
 * The value is checked as is (callers should pass the trimmed/lowercased address they use).
 */
export function isStrictSingleEmail (email: string | null | undefined): boolean {
  if (typeof email !== 'string' || email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false
  const parts = email.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (local.length === 0 || local.length > MAX_LOCAL_PART_LENGTH || !LOCAL_PART_RE.test(local)) return false
  // The domain has to be valid as is: no leading '@', no trailing dot, no surrounding whitespace
  const normalized = normalizeDomain(domain)
  return normalized !== undefined && normalized === domain.toLowerCase()
}

/**
 * Returns the normalized domain of an e-mail address, or undefined if the value
 * (after trimming) is not exactly one strictly valid e-mail address.
 */
export function getEmailDomain (email: string | null | undefined): string | undefined {
  if (typeof email !== 'string') return undefined
  const value = email.trim().toLowerCase()
  if (!isStrictSingleEmail(value)) return undefined
  return value.slice(value.indexOf('@') + 1)
}

/**
 * Returns true if the invite has a domain restriction.
 */
export function hasDomainRestriction (allowedDomains: string | null | undefined): boolean {
  return typeof allowedDomains === 'string' && allowedDomains.trim().length > 0
}

/**
 * Checks an e-mail address against the stored domain restriction of an invite.
 * Without a restriction every address is allowed. With a restriction an address
 * is allowed only if it is exactly one strictly valid address (isStrictSingleEmail)
 * and its domain exactly matches one of the listed domains.
 * The stored value is re-parsed, so malformed entries can never widen the match.
 */
export function isEmailAllowedByDomains (
  email: string | null | undefined,
  allowedDomains: string | null | undefined
): boolean {
  if (!hasDomainRestriction(allowedDomains)) {
    return true
  }
  const emailDomain = getEmailDomain(email)
  if (emailDomain === undefined) {
    return false
  }
  const { domains } = parseAllowedDomains(allowedDomains)
  return domains.includes(emailDomain)
}
