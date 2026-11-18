//
// Copyright © 2020 Anticrm Platform Contributors.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { Analytics } from '@hcengineering/analytics'
import '@hcengineering/platform-rig/profiles/ui/svelte'
import platform, { loadPluginStrings, setMetadata } from '@hcengineering/platform'
import { derived, get, writable } from 'svelte/store'
import { ThemeVariant, type ThemeVariantType } from './variants'
import { DEFAULT_LANGUAGES, getBrowserLanguages, LanguagePreference } from './language'

export { default as Theme } from './Theme.svelte'
export { default as InvertedTheme } from './InvertedTheme.svelte'
export { ThemeVariant, type ThemeVariantType } from './variants'
export { DEFAULT_LANGUAGES } from './language'

const languagePreference = new LanguagePreference(() => localStorage)
let defaultLanguage = 'en'
let supportedLanguages: readonly string[] = DEFAULT_LANGUAGES

/** Configure language selection before mounting the application. @public */
export const setDefaultLanguage = (language: string, languages: readonly string[] = DEFAULT_LANGUAGES): void => {
  defaultLanguage = language
  supportedLanguages = languages
}

/** Explicit value in the picker: null is Browser language (automatic). @public */
export const languagePreferenceStore = writable<string | null>(null)
/** Resolved language shared with Theme. @public */
export const currentLanguageStore = writable<string>('en')

/** Set an explicit choice without reloading plugin strings. @public */
export const setLanguagePreference = (language: string | null): void => {
  languagePreference.set(language)
}

/** Save an explicit preference before displaying it. @public */
export async function selectLanguagePreference (language: string | null): Promise<void> {
  languagePreference.set(language)
  await initializeLanguage()
}

/** Load the locale before rendering login, onboarding or the workbench. @public */
export async function initializeLanguage (): Promise<void> {
  const language = getCurrentLanguage()
  setMetadata(platform.metadata.locale, language)
  document.documentElement.lang = language
  currentLanguageStore.set(language)
  languagePreferenceStore.set(languagePreference.choice())
  const theme = get(themeStore)
  if (theme !== undefined) {
    themeStore.set(new ThemeOptions(theme.fontSize, theme.dark, language, theme.emoji))
  }
  await loadPluginStrings(language)
}

function getDefaultProps (prop: string, value: string): string {
  localStorage.setItem(prop, value)
  return value
}

/**
 * @public
 */
export const isSystemThemeDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches
/**
 * @public
 */
export const isThemeDark = (theme: string): boolean =>
  theme === 'theme-dark' || (theme === 'theme-system' && isSystemThemeDark())
/**
 * @public
 */
export const getCurrentTheme = (): string => localStorage.getItem('theme') ?? getDefaultProps('theme', 'theme-system')
/**
 * @public
 */
export const getCurrentFontSize = (): string =>
  localStorage.getItem('fontsize') ?? getDefaultProps('fontsize', 'normal-font')
/**
 * @public
 */
export const getCurrentLanguage = (): string => {
  const lang = languagePreference.get({
    defaultLanguage,
    supportedLanguages,
    browserLanguages: getBrowserLanguages(typeof navigator === 'undefined' ? undefined : navigator)
  })
  Analytics.setTag('language', lang)
  return lang
}
/**
 * @public
 */
export const getCurrentEmoji = (): string => localStorage.getItem('emoji') ?? getDefaultProps('emoji', 'emoji-system')

export class ThemeOptions {
  readonly variant: ThemeVariantType
  constructor (
    readonly fontSize: number,
    readonly dark: boolean,
    readonly language: string,
    readonly emoji: string
  ) {
    this.variant = dark ? ThemeVariant.Dark : ThemeVariant.Light
  }
}
export const themeStore = writable<ThemeOptions>()

export function initThemeStore (): void {
  themeStore.set(
    new ThemeOptions(
      getCurrentFontSize() === 'normal-font' ? 16 : 14,
      isThemeDark(getCurrentTheme()),
      getCurrentLanguage(),
      getCurrentEmoji()
    )
  )
}

export const languageStore = derived(themeStore, ($theme) => $theme?.language ?? '')
