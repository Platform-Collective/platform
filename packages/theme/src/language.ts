// SPDX-License-Identifier: EPL-2.0

import { UI_LANGUAGES } from '@hcengineering/platform'

/** Languages with bundled UI translations. @public */
export const DEFAULT_LANGUAGES = UI_LANGUAGES

/** Inputs used to choose the UI language before mounting the application. @public */
export interface LanguageOptions {
  explicitLanguage?: string | null
  browserLanguages?: readonly string[]
  supportedLanguages: readonly string[]
  defaultLanguage?: string
}

function matchLanguage (language: string | null | undefined, supported: Map<string, string>): string | undefined {
  let candidate: string
  try {
    candidate = Intl.getCanonicalLocales(language?.trim() ?? '')[0]?.toLowerCase() ?? ''
  } catch {
    return undefined
  }
  // Match asset IDs first (e.g. pt-br), then progressively remove region/script subtags.
  while (candidate !== '') {
    const match = supported.get(candidate)
    if (match !== undefined) return match
    const separator = candidate.lastIndexOf('-')
    if (separator < 0) return undefined
    candidate = candidate.slice(0, separator)
  }
  return undefined
}

/** Resolve an explicitly selected, browser or deployment language. @public */
export function resolveLanguage (options: LanguageOptions): string {
  const supported = new Map(
    options.supportedLanguages.map((language) => {
      const normalized = language.trim().toLowerCase()
      return [normalized, normalized]
    })
  )
  supported.delete('')
  const explicit = matchLanguage(options.explicitLanguage, supported)
  if (explicit !== undefined) return explicit
  for (const language of options.browserLanguages ?? []) {
    const match = matchLanguage(language, supported)
    if (match !== undefined) return match
  }
  return matchLanguage(options.defaultLanguage, supported) ?? 'en'
}

/** Browser language preferences in order, with the legacy single-language fallback. */
export function getBrowserLanguages (browser?: Pick<Navigator, 'languages' | 'language'>): readonly string[] {
  return browser === undefined ? [] : browser.languages?.length > 0 ? browser.languages : [browser.language]
}

type LanguageStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const LANGUAGE_VERSION_KEY = 'languagePreferenceVersion'
const ANONYMOUS_LANGUAGE_KEY = 'languagePreference:anonymous:v1'
const LANGUAGE_VERSION = '1'

/** Explicit language choice. Automatic defaults are never saved. @public */
export class LanguagePreference {
  private selected: string | null | undefined
  private migrated = false

  constructor (private readonly storage: () => LanguageStorage) {}

  private migrate (): void {
    if (this.migrated) return
    try {
      const storage = this.storage()
      if (storage.getItem(LANGUAGE_VERSION_KEY) !== LANGUAGE_VERSION) {
        const legacy = storage.getItem('lang')
        if (legacy !== null) {
          storage.setItem(ANONYMOUS_LANGUAGE_KEY, legacy)
        }
        storage.setItem(LANGUAGE_VERSION_KEY, LANGUAGE_VERSION)
      }
      this.migrated = true
    } catch {
      // Retry once storage becomes available; do not trust an unmigrated legacy value.
    }
  }

  private read (key: string): string | null {
    try {
      return this.storage().getItem(key)
    } catch {
      return null
    }
  }

  private write (key: string, value: string | null): void {
    try {
      if (value === null) this.storage().removeItem(key)
      else this.storage().setItem(key, value)
    } catch {
      // Keep the accepted choice for this session if storage is unavailable.
    }
  }

  /** Explicit picker value, independent of the currently resolved browser language. */
  choice (): string | null {
    this.migrate()
    const saved = this.read(ANONYMOUS_LANGUAGE_KEY)
    const legacy = this.read('lang')
    if (legacy !== null && legacy !== saved) {
      this.selected = legacy
      this.write(ANONYMOUS_LANGUAGE_KEY, legacy)
      return legacy
    }
    if (legacy === null && saved !== null) {
      this.write('lang', saved)
    }
    return this.selected !== undefined ? this.selected : saved
  }

  get (options: Omit<LanguageOptions, 'explicitLanguage'>): string {
    return resolveLanguage({ ...options, explicitLanguage: this.choice() })
  }

  set (language: string | null): void {
    this.migrate()
    this.selected = language
    this.write('lang', language)
    this.write(ANONYMOUS_LANGUAGE_KEY, language)
  }
}
